import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toDb } from "@/lib/money";

export const EXPENSE_RECURRENCES = ["NONE", "MONTHLY", "QUARTERLY", "ANNUAL"] as const;
export type ExpenseRecurrence = (typeof EXPENSE_RECURRENCES)[number];

const MONTHS: Record<Exclude<ExpenseRecurrence, "NONE">, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

/** Adds the recurrence interval to a UTC calendar date (clamped to month end). Returns null for NONE. */
export function nextOccurrenceFor(date: Date, recurrence: string): Date | null {
  if (!(recurrence in MONTHS)) return null;
  const months = MONTHS[recurrence as keyof typeof MONTHS];
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const d = date.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastDay)));
}

function periodLabel(date: Date, recurrence: string) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  if (recurrence === "MONTHLY") return `${y}-${String(m).padStart(2, "0")}`;
  if (recurrence === "QUARTERLY") return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  return String(y);
}

/**
 * Creates the next copy of every recurring APPROVED/PAID expense whose nextOccurrence is due.
 * Each source row is locked (SELECT ... FOR UPDATE) and its nextOccurrence advanced inside the same
 * transaction, so concurrent job runs cannot create duplicates.
 */
export async function processRecurringExpenses(organizationId: string, today: Date) {
  const due = await db.expense.findMany({
    where: { organizationId, status: { in: ["APPROVED", "PAID"] }, recurrence: { not: "NONE" }, nextOccurrence: { lte: today } },
    select: { id: true },
  });
  let created = 0;
  for (const { id } of due) {
    // Bounded loop: an expense far behind schedule catches up one period per iteration.
    for (let guard = 0; guard < 36; guard++) {
      const madeOne = await db.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "Expense" WHERE id = ${id} AND "organizationId" = ${organizationId} AND "nextOccurrence" <= ${today}::date AND status IN ('APPROVED','PAID') FOR UPDATE`);
        if (!row) return false;
        const src = await tx.expense.findUniqueOrThrow({ where: { id } });
        const occurrence = src.nextOccurrence!;
        const next = nextOccurrenceFor(occurrence, src.recurrence);
        if (!next) return false;
        const copy = await tx.expense.create({
          data: {
            organizationId,
            propertyId: src.propertyId,
            unitId: src.unitId,
            vendorId: src.vendorId,
            workOrderId: null,
            purchaseOrderId: src.purchaseOrderId,
            category: src.category,
            description: `${src.description} (${periodLabel(occurrence, src.recurrence)})`,
            amount: toDb(src.amount),
            currency: src.currency,
            expenseDate: occurrence,
            billReference: src.billReference,
            status: "PENDING_APPROVAL",
            recurrence: "NONE",
            nextOccurrence: null,
            createdById: src.createdById,
          },
        });
        await tx.expense.update({ where: { id }, data: { nextOccurrence: next } });
        await tx.auditLog.create({
          data: {
            organizationId,
            action: "expense.recurring_generated",
            module: "expenses",
            entityType: "Expense",
            entityId: copy.id,
            propertyId: src.propertyId ?? undefined,
            actorName: "system",
            metadata: { sourceExpenseId: id, occurrence: occurrence.toISOString().slice(0, 10), nextOccurrence: next.toISOString().slice(0, 10) },
          },
        });
        return true;
      });
      if (!madeOne) break;
      created++;
    }
  }
  return created;
}
