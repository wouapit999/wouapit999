import { money, round2, sum, type Decimal, type MoneyInput } from "@/lib/money";

// Pure payment-plan arithmetic (no I/O): instalment generation and sequential
// application of received payments. All money goes through decimal.js.

export type PlanFrequency = "MONTHLY" | "WEEKLY";
export type InstallmentStatus = "PENDING" | "PAID" | "OVERDUE" | "MISSED";
export const PLAN_FREQUENCIES: readonly PlanFrequency[] = ["MONTHLY", "WEEKLY"];

export interface BuiltInstallment {
  sequence: number;
  dueDate: Date; // UTC midnight
  amount: Decimal;
}

export interface InstallmentInput {
  sequence: number;
  dueDate: Date;
  amount: MoneyInput;
}

export interface AppliedInstallment {
  sequence: number;
  paidAmount: Decimal;
  status: InstallmentStatus;
}

const DAY = 86_400_000;

function utcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Adds `n` months keeping the day of month (clamped to the target month's length). */
export function addMonthsClamped(d: Date, n: number) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}

/** Due date of the instalment at index `i` (0-based) starting from `firstDue`. */
export function installmentDueDate(firstDue: Date, i: number, frequency: PlanFrequency) {
  const start = utcDay(firstDue);
  return frequency === "WEEKLY" ? new Date(start.getTime() + i * 7 * DAY) : addMonthsClamped(start, i);
}

/**
 * Splits `total` into `count` equal instalments (2 dp). Rounding is absorbed by the last
 * instalment so that the sum of instalments is exactly `total`.
 */
export function buildInstallments(total: MoneyInput, count: number, firstDue: Date, frequency: PlanFrequency): BuiltInstallment[] {
  const t = round2(total);
  if (!Number.isInteger(count) || count < 1) throw new Error("count must be a positive integer");
  if (t.lte(0)) throw new Error("total must be positive");
  const each = round2(t.div(count));
  const out: BuiltInstallment[] = [];
  for (let i = 0; i < count; i++) {
    const amount = i === count - 1 ? t.minus(each.mul(count - 1)) : each;
    out.push({ sequence: i + 1, dueDate: installmentDueDate(firstDue, i, frequency), amount });
  }
  return out;
}

/**
 * Applies a total of received money to instalments in sequence order (oldest first).
 * Statuses: PAID when fully covered; otherwise OVERDUE when the due date is before `today`
 * (this also covers the "later instalment paid but this one not" case, which sequential
 * application makes impossible and is therefore reported as OVERDUE); PENDING otherwise.
 */
export function applyPaymentsToInstallments(installments: InstallmentInput[], paidTotal: MoneyInput, today = new Date()): AppliedInstallment[] {
  const t = utcDay(today);
  let remaining = money(paidTotal);
  if (remaining.isNegative()) remaining = money(0);
  return [...installments]
    .sort((a, b) => a.sequence - b.sequence)
    .map((inst) => {
      const amount = round2(inst.amount);
      const paid = remaining.gte(amount) ? amount : round2(remaining);
      remaining = remaining.minus(paid);
      const status: InstallmentStatus = paid.gte(amount) ? "PAID" : utcDay(inst.dueDate) < t ? "OVERDUE" : "PENDING";
      return { sequence: inst.sequence, paidAmount: paid, status };
    });
}

export function planProgress(installments: { amount: MoneyInput; paidAmount: MoneyInput }[]) {
  const total = sum(installments.map((i) => i.amount));
  const paid = sum(installments.map((i) => i.paidAmount));
  const percent = total.gt(0) ? Math.min(100, Math.floor(paid.div(total).mul(100).toNumber())) : 0;
  return { total, paid, remaining: total.minus(paid), percent, complete: total.gt(0) && paid.gte(total) };
}
