import { money, round2, type Decimal, type MoneyInput } from "@/lib/money";

export interface OpenInvoice {
  id: string;
  dueDate: Date;
  issueDate?: Date;
  balance: MoneyInput; // total - paid - credited
}

export interface AllocationLine {
  invoiceId: string;
  amount: Decimal;
}

export type AllocationStrategy = "OLDEST_FIRST" | "NEWEST_FIRST";

/**
 * Allocates a payment across open invoices. Never allocates more than the payment amount
 * nor more than an invoice balance. Any remainder is returned as unapplied credit.
 */
export function allocatePayment(
  amount: MoneyInput,
  invoices: OpenInvoice[],
  strategy: AllocationStrategy = "OLDEST_FIRST",
): { lines: AllocationLine[]; unapplied: Decimal } {
  let remaining = round2(amount);
  if (remaining.isNegative()) throw new Error("Payment amount cannot be negative");
  const sorted = [...invoices].sort((a, b) => {
    const diff = a.dueDate.getTime() - b.dueDate.getTime();
    return strategy === "OLDEST_FIRST" ? diff : -diff;
  });
  const lines: AllocationLine[] = [];
  for (const inv of sorted) {
    if (remaining.lte(0)) break;
    const bal = round2(inv.balance);
    if (bal.lte(0)) continue;
    const take = bal.lt(remaining) ? bal : remaining;
    lines.push({ invoiceId: inv.id, amount: take });
    remaining = remaining.minus(take);
  }
  return { lines, unapplied: remaining };
}

/** Validates manual allocations supplied by a user. Returns an error message or null. */
export function validateManualAllocation(
  paymentAmount: MoneyInput,
  lines: { invoiceId: string; amount: MoneyInput }[],
  balances: Record<string, MoneyInput>,
): string | null {
  let total = money(0);
  for (const l of lines) {
    const a = money(l.amount);
    if (a.lte(0)) return "Allocation amounts must be positive.";
    const bal = balances[l.invoiceId];
    if (bal === undefined) return "Invoice not found for this tenant.";
    if (a.gt(money(bal))) return "Allocation exceeds the invoice balance.";
    total = total.plus(a);
  }
  if (total.gt(money(paymentAmount))) return "Allocations exceed the payment amount.";
  return null;
}

export type InvoiceStatusValue = "ISSUED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";

/** Derives the settlement status of an issued invoice from its amounts. */
export function deriveInvoiceStatus(
  total: MoneyInput,
  paid: MoneyInput,
  credited: MoneyInput,
  dueDate: Date,
  today: Date,
): InvoiceStatusValue {
  const outstanding = money(total).minus(money(paid)).minus(money(credited));
  if (outstanding.lte(0)) return "PAID";
  if (dueDate < today) return "OVERDUE";
  if (money(paid).gt(0)) return "PARTIALLY_PAID";
  return "ISSUED";
}
