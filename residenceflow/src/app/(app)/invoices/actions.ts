"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, can, invoiceWhere, leaseWhere, tenantWhere } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/action";
import { BusinessError, ForbiddenError } from "@/lib/errors";
import { getOrgSettings } from "@/lib/settings";
import { getT } from "@/i18n";
import { createInvoice, creditInvoice, issueDraftInvoice, voidInvoice } from "@/services/billing";
import { CHARGE_TYPES, parseDay } from "@/services/finance-extra";
import { financeMessages, invoiceMessages, translateResult } from "./messages";

const LINE_ROWS = 5;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amountStr = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/);

const lineSchema = z.object({
  chargeType: z.enum(CHARGE_TYPES),
  description: z.string().trim().min(1).max(300),
  quantity: z.string().trim().regex(/^\d{1,6}(\.\d{1,2})?$/),
  unitPrice: amountStr,
});

const invoiceSchema = z.object({
  tenantId: z.string().uuid(),
  leaseId: z.union([z.literal(""), z.string().uuid()]),
  issueDate: day,
  dueDate: day,
  notes: z.string().trim().max(2000),
  issueNow: z.boolean(),
  lines: z.array(lineSchema).min(1).max(LINE_ROWS),
});

function readLines(fd: FormData) {
  const lines: Record<string, string>[] = [];
  for (let i = 0; i < LINE_ROWS; i++) {
    const get = (k: string) => String(fd.get(`line_${i}_${k}`) ?? "").trim();
    const description = get("description");
    const unitPrice = get("unitPrice");
    if (!description && !unitPrice) continue; // blank row
    lines.push({ chargeType: get("chargeType") || "OTHER", description, quantity: get("quantity") || "1", unitPrice });
  }
  return lines;
}

async function tr<R>(r: ActionResult<R>) {
  const { t } = await getT(financeMessages, invoiceMessages);
  return translateResult(r, t);
}

async function loadScopedInvoice(ctx: Awaited<ReturnType<typeof authorize>>, id: string) {
  const inv = await db.invoice.findFirst({ where: { AND: [invoiceWhere(ctx), { id }] }, select: { id: true } });
  if (!inv) throw new BusinessError("Invoice not found.");
  return inv;
}

export async function createInvoiceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    const ctx = await authorize("invoice.create");
    const data = invoiceSchema.parse({
      tenantId: fd.get("tenantId"),
      leaseId: String(fd.get("leaseId") ?? ""),
      issueDate: fd.get("issueDate"),
      dueDate: fd.get("dueDate"),
      notes: String(fd.get("notes") ?? ""),
      issueNow: fd.get("issueNow") === "on",
      lines: readLines(fd),
    });
    if (data.issueNow && !can(ctx, "invoice.issue")) throw new ForbiddenError();
    const tenant = await db.tenant.findFirst({ where: { AND: [tenantWhere(ctx), { id: data.tenantId }] }, select: { id: true } });
    if (!tenant) throw new BusinessError("Tenant not found.");
    if (!data.leaseId && ctx.propertyIds !== "ALL") throw new BusinessError("fin.leaseRequiredScoped");
    if (data.leaseId) {
      const lease = await db.lease.findFirst({ where: { AND: [leaseWhere(ctx), { id: data.leaseId, tenantId: tenant.id }] }, select: { id: true } });
      if (!lease) throw new BusinessError("Lease not found.");
    }
    const issueDate = parseDay(data.issueDate)!;
    const dueDate = parseDay(data.dueDate)!;
    if (dueDate < issueDate) throw new BusinessError("The due date cannot be before the issue date.");
    const settings = await getOrgSettings(ctx.organizationId);
    const { invoice } = await db.$transaction((tx) =>
      createInvoice(tx, ctx, {
        organizationId: ctx.organizationId,
        tenantId: tenant.id,
        leaseId: data.leaseId || null,
        issueDate,
        dueDate,
        lines: data.lines,
        notes: data.notes,
        issue: data.issueNow,
        currency: settings?.currency ?? "XAF",
        taxRatePercent: settings?.taxRatePercent.toString() ?? 0,
      }),
    );
    id = invoice.id;
  });
  if (!r.ok) return tr(r);
  revalidatePath("/invoices");
  redirect(`/invoices/${id}`);
}

export async function issueInvoiceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("invoice.issue");
    const inv = await loadScopedInvoice(ctx, z.string().uuid().parse(fd.get("id")));
    await issueDraftInvoice(ctx, inv.id);
    revalidatePath(`/invoices/${inv.id}`);
  });
  return tr(r.ok ? { ...r, message: "inv.issued" } : r);
}

const reasonSchema = z.string().trim().min(3).max(500);

export async function voidInvoiceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("invoice.void");
    const inv = await loadScopedInvoice(ctx, z.string().uuid().parse(fd.get("id")));
    await voidInvoice(ctx, inv.id, reasonSchema.parse(fd.get("reason")));
    revalidatePath(`/invoices/${inv.id}`);
  });
  return tr(r.ok ? { ...r, message: "inv.voided" } : r);
}

export async function creditInvoiceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("invoice.void");
    const inv = await loadScopedInvoice(ctx, z.string().uuid().parse(fd.get("id")));
    const amount = amountStr.parse(String(fd.get("amount") ?? ""));
    await creditInvoice(ctx, inv.id, amount, reasonSchema.parse(fd.get("reason")));
    revalidatePath(`/invoices/${inv.id}`);
  });
  return tr(r.ok ? { ...r, message: "inv.credited" } : r);
}
