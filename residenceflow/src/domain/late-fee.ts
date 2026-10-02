import { money, round2, type Decimal, type MoneyInput } from "@/lib/money";
import { daysOverdue } from "./aging";

export type LateFeeType = "NONE" | "FIXED" | "PERCENT";

/**
 * Returns the late fee to assess for an invoice, or null when none is due.
 * Idempotency is enforced by the caller through a unique invoice idempotency key
 * (`latefee:<invoiceId>`), so a fee is never charged twice for the same invoice.
 */
export function computeLateFee(opts: {
  type: LateFeeType | string;
  value: MoneyInput;
  outstanding: MoneyInput;
  dueDate: Date;
  graceDays: number;
  today: Date;
}): Decimal | null {
  if (opts.type === "NONE") return null;
  const outstanding = money(opts.outstanding);
  if (outstanding.lte(0)) return null;
  if (daysOverdue(opts.dueDate, opts.today) <= opts.graceDays) return null;
  const value = money(opts.value);
  if (value.lte(0)) return null;
  if (opts.type === "FIXED") return round2(value);
  if (opts.type === "PERCENT") return round2(outstanding.mul(value).div(100));
  return null;
}
