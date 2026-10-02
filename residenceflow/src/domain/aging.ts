import { money, type Decimal, type MoneyInput } from "@/lib/money";

export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

const DAY = 86_400_000;

export function daysOverdue(dueDate: Date, today: Date) {
  const a = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((b - a) / DAY);
}

export function bucketFor(dueDate: Date, today: Date): AgingBucket {
  const d = daysOverdue(dueDate, today);
  if (d <= 0) return "current";
  if (d <= 30) return "d1_30";
  if (d <= 60) return "d31_60";
  if (d <= 90) return "d61_90";
  return "d90_plus";
}

export function ageBalances(
  items: { dueDate: Date; balance: MoneyInput }[],
  today: Date,
): Record<AgingBucket, Decimal> & { total: Decimal } {
  const out = {
    current: money(0),
    d1_30: money(0),
    d31_60: money(0),
    d61_90: money(0),
    d90_plus: money(0),
    total: money(0),
  };
  for (const it of items) {
    const bal = money(it.balance);
    if (bal.lte(0)) continue;
    const b = bucketFor(it.dueDate, today);
    out[b] = out[b].plus(bal);
    out.total = out.total.plus(bal);
  }
  return out;
}
