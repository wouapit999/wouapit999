import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { BusinessError } from "@/lib/errors";
import { round2, toDb } from "@/lib/money";
import type { AuthContext } from "@/lib/auth/context";

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "CARD", "GATEWAY", "OTHER"] as const;
export const CHARGE_TYPES = ["RENT", "SERVICE_CHARGE", "UTILITIES", "PARKING", "INTERNET", "WASTE", "SECURITY", "LATE_FEE", "OTHER"] as const;
export const OPEN_INVOICE_STATUSES = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] as const;
export const COLLECTION_NOTE_KINDS = ["NOTE", "PROMISE_TO_PAY", "ESCALATION"] as const;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" → UTC midnight Date (for @db.Date columns). Returns null when invalid. */
export function parseDay(v: string | null | undefined): Date | null {
  if (!v || !DAY_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → "YYYY-MM-DD" (UTC) for date inputs. */
export function dayString(d: Date) {
  return d.toISOString().slice(0, 10);
}

export interface CollectionNoteInput {
  tenantId: string;
  kind: (typeof COLLECTION_NOTE_KINDS)[number];
  note: string;
  promisedAmount?: string | null;
  promisedDate?: Date | null;
  escalation?: string | null;
}

/** Adds a collection note / promise to pay / escalation. Caller must have verified tenant scope. */
export async function addCollectionNote(ctx: AuthContext, input: CollectionNoteInput) {
  if (input.kind === "PROMISE_TO_PAY") {
    if (!input.promisedAmount || round2(input.promisedAmount).lte(0)) throw new BusinessError("A promised amount is required.");
    if (!input.promisedDate) throw new BusinessError("A promised date is required.");
  }
  if (input.kind === "ESCALATION" && !input.escalation?.trim()) throw new BusinessError("An escalation level is required.");
  return db.$transaction(async (tx) => {
    const tenant = await tx.tenant.findFirst({ where: { id: input.tenantId, organizationId: ctx.organizationId }, select: { id: true } });
    if (!tenant) throw new BusinessError("Tenant not found.");
    const note = await tx.collectionNote.create({
      data: {
        organizationId: ctx.organizationId,
        tenantId: tenant.id,
        kind: input.kind,
        note: input.note,
        promisedAmount: input.kind === "PROMISE_TO_PAY" && input.promisedAmount ? toDb(input.promisedAmount) : null,
        promisedDate: input.kind === "PROMISE_TO_PAY" ? input.promisedDate ?? null : null,
        escalation: input.kind === "ESCALATION" ? input.escalation?.trim() ?? null : null,
        createdById: ctx.user.id,
      },
    });
    await audit(ctx, {
      action: "arrears.note_added",
      module: "arrears",
      entityType: "CollectionNote",
      entityId: note.id,
      after: { tenantId: tenant.id, kind: note.kind, promisedAmount: note.promisedAmount, promisedDate: note.promisedDate, escalation: note.escalation },
    }, tx);
    return note;
  });
}
