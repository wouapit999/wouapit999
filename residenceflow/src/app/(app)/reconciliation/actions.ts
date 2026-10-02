"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, paymentWhere, type AuthContext } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { getT } from "@/i18n";
import { autoMatch, coerceLines, parseStatementCsv, type StatementLine } from "@/domain/reconciliation";
import { MATCH_WINDOW_DAYS, candidatePayments } from "./queries";
import { reconciliationMessages } from "./messages";

const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const toDay = (s: string) => new Date(`${s}T00:00:00Z`);
const sessionSchema = z.object({
  account: z.string().trim().min(2).max(120),
  periodStart: dayStr,
  periodEnd: dayStr,
  csv: z.string().min(1).max(500_000),
  notes: z.string().trim().max(2000).default(""),
});

export async function createSessionAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(reconciliationMessages);
  let sessionId = "";
  const r = await runAction(async () => {
    const ctx = await authorize("payment.approve");
    const d = sessionSchema.parse(formToObject(fd));
    const start = toDay(d.periodStart);
    const end = toDay(d.periodEnd);
    if (end < start) throw new BusinessError(t("rec.periodInvalid"));
    const { lines, errors } = parseStatementCsv(d.csv);
    if (lines.length === 0) throw new BusinessError(`${t("rec.noLines")}${errors.length ? ` (${t("rec.line")} ${errors[0].line}: ${errors[0].error})` : ""}`);
    const payments = await candidatePayments(ctx, start, end);
    const matched = autoMatch(lines, payments, MATCH_WINDOW_DAYS);
    await db.$transaction(async (tx) => {
      const s = await tx.reconciliationSession.create({
        data: {
          organizationId: ctx.organizationId,
          account: d.account,
          periodStart: start,
          periodEnd: end,
          statementLines: matched.lines as unknown as Prisma.InputJsonValue,
          matchedCount: matched.matchedCount,
          unmatchedCount: matched.unmatchedCount,
          notes: [d.notes, errors.length ? `${t("rec.parseErrors")}: ${errors.map((e) => `${t("rec.line")} ${e.line} – ${e.error}`).join("; ")}` : ""].filter(Boolean).join("\n"),
          createdById: ctx.user.id,
        },
      });
      sessionId = s.id;
      await audit(ctx, { action: "reconciliation.created", module: "reconciliation", entityType: "ReconciliationSession", entityId: s.id, after: { account: d.account, periodStart: d.periodStart, periodEnd: d.periodEnd, lines: lines.length, matched: matched.matchedCount, unmatched: matched.unmatchedCount, parseErrors: errors.length } }, tx);
    });
  });
  if (!r.ok) return r;
  revalidatePath("/reconciliation");
  redirect(`/reconciliation/${sessionId}`);
}

/** Locks and loads an OPEN session in scope inside a transaction. */
async function lockSession(ctx: AuthContext, tx: Tx, id: string, t: (k: string) => string) {
  const [row] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "ReconciliationSession" WHERE id = ${id} AND "organizationId" = ${ctx.organizationId} FOR UPDATE`);
  if (!row) throw new BusinessError(t("rec.sessionNotFound"));
  const s = await tx.reconciliationSession.findUniqueOrThrow({ where: { id } });
  if (s.status !== "OPEN") throw new BusinessError(t("rec.sessionClosed"));
  return { session: s, lines: coerceLines(s.statementLines) };
}

async function saveLines(tx: Tx, id: string, lines: StatementLine[]) {
  const matchedCount = lines.filter((l) => l.matched).length;
  await tx.reconciliationSession.update({ where: { id }, data: { statementLines: lines as unknown as Prisma.InputJsonValue, matchedCount, unmatchedCount: lines.length - matchedCount } });
}

const matchSchema = z.object({ sessionId: z.string().uuid(), line: z.coerce.number().int().min(0), paymentId: z.string().uuid() });

export async function matchLineAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(reconciliationMessages);
  const r = await runAction(async () => {
    const ctx = await authorize("payment.approve");
    const d = matchSchema.parse(formToObject(fd));
    const payment = await db.payment.findFirst({ where: { AND: [paymentWhere(ctx), { id: d.paymentId }] }, select: { id: true, reference: true } });
    if (!payment) throw new BusinessError(t("rec.paymentNotFound"));
    await db.$transaction(async (tx) => {
      const { lines } = await lockSession(ctx, tx, d.sessionId, t);
      const line = lines[d.line];
      if (!line) throw new BusinessError(t("rec.lineNotFound"));
      if (lines.some((l, i) => i !== d.line && l.paymentId === payment.id)) throw new BusinessError(t("rec.paymentUsed"));
      lines[d.line] = { ...line, paymentId: payment.id, matched: true, matchType: "manual" };
      await saveLines(tx, d.sessionId, lines);
      await audit(ctx, { action: "reconciliation.line_matched", module: "reconciliation", entityType: "ReconciliationSession", entityId: d.sessionId, metadata: { line: d.line, paymentId: payment.id, reference: payment.reference } }, tx);
    });
    revalidatePath(`/reconciliation/${d.sessionId}`);
  });
  return r.ok ? { ...r, message: t("rec.lineMatched") } : r;
}

const unmatchSchema = z.object({ sessionId: z.string().uuid(), line: z.coerce.number().int().min(0) });

export async function unmatchLineAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(reconciliationMessages);
  const r = await runAction(async () => {
    const ctx = await authorize("payment.approve");
    const d = unmatchSchema.parse(formToObject(fd));
    await db.$transaction(async (tx) => {
      const { lines } = await lockSession(ctx, tx, d.sessionId, t);
      const line = lines[d.line];
      if (!line) throw new BusinessError(t("rec.lineNotFound"));
      const before = line.paymentId;
      lines[d.line] = { ...line, paymentId: null, matched: false, matchType: null };
      await saveLines(tx, d.sessionId, lines);
      await audit(ctx, { action: "reconciliation.line_unmatched", module: "reconciliation", entityType: "ReconciliationSession", entityId: d.sessionId, metadata: { line: d.line, paymentId: before } }, tx);
    });
    revalidatePath(`/reconciliation/${d.sessionId}`);
  });
  return r.ok ? { ...r, message: t("rec.lineUnmatched") } : r;
}

export async function completeSessionAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(reconciliationMessages);
  const r = await runAction(async () => {
    const ctx = await authorize("payment.approve");
    const id = z.string().uuid().parse(fd.get("sessionId"));
    await db.$transaction(async (tx) => {
      const { session, lines } = await lockSession(ctx, tx, id, t);
      await tx.reconciliationSession.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
      await audit(ctx, { action: "reconciliation.completed", module: "reconciliation", entityType: "ReconciliationSession", entityId: id, before: { status: session.status }, after: { status: "COMPLETED", matched: lines.filter((l) => l.matched).length, unmatched: lines.filter((l) => !l.matched).length } }, tx);
    });
    revalidatePath("/reconciliation");
    revalidatePath(`/reconciliation/${id}`);
  });
  return r.ok ? { ...r, message: t("rec.completed") } : r;
}
