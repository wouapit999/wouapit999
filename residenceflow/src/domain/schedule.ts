import { money, round2, type Decimal, type MoneyInput } from "@/lib/money";

export type Frequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL";

export const FREQUENCY_MONTHS: Record<Exclude<Frequency, "WEEKLY">, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

export interface SchedulePeriod {
  periodStart: Date; // UTC midnight, inclusive
  periodEnd: Date; // UTC midnight, inclusive
  dueDate: Date;
  amount: Decimal;
  prorated: boolean;
}

export interface ScheduleInput {
  startDate: Date;
  endDate: Date;
  frequency: Frequency;
  amount: MoneyInput; // amount per full period
  dueDay: number; // day of month the charge is due (clamped to month length); ignored for WEEKLY
  prorate: boolean;
}

const DAY = 86_400_000;

export function utcDate(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d));
}

export function toUtcDay(d: Date) {
  return utcDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * DAY);
}

export function daysBetweenInclusive(a: Date, b: Date) {
  return Math.round((toUtcDay(b).getTime() - toUtcDay(a).getTime()) / DAY) + 1;
}

function daysInMonth(y: number, m: number) {
  return utcDate(y, m + 1, 0).getUTCDate();
}

/**
 * Generates the billing periods of a lease. Monthly-based frequencies are anchored to calendar
 * periods starting on the 1st (e.g. months, calendar quarters from the lease start month);
 * partial first/last periods are prorated by day count when `prorate` is true.
 */
export function generateSchedule(input: ScheduleInput): SchedulePeriod[] {
  const start = toUtcDay(input.startDate);
  const end = toUtcDay(input.endDate);
  if (end < start) return [];
  const full = money(input.amount);
  const periods: SchedulePeriod[] = [];

  if (input.frequency === "WEEKLY") {
    let cursor = start;
    while (cursor <= end) {
      const nominalEnd = addDays(cursor, 6);
      const pEnd = nominalEnd > end ? end : nominalEnd;
      const days = daysBetweenInclusive(cursor, pEnd);
      const prorated = days < 7 && input.prorate;
      periods.push({
        periodStart: cursor,
        periodEnd: pEnd,
        dueDate: cursor,
        amount: prorated ? round2(full.mul(days).div(7)) : round2(full),
        prorated,
      });
      cursor = addDays(pEnd, 1);
    }
    return periods;
  }

  const months = FREQUENCY_MONTHS[input.frequency];
  // Nominal period containing the start date begins on the 1st of the start month.
  let nominalStart = utcDate(start.getUTCFullYear(), start.getUTCMonth(), 1);
  while (nominalStart <= end) {
    const nominalEnd = addDays(
      utcDate(nominalStart.getUTCFullYear(), nominalStart.getUTCMonth() + months, 1),
      -1,
    );
    const pStart = nominalStart < start ? start : nominalStart;
    const pEnd = nominalEnd > end ? end : nominalEnd;
    const nominalDays = daysBetweenInclusive(nominalStart, nominalEnd);
    const actualDays = daysBetweenInclusive(pStart, pEnd);
    const partial = actualDays < nominalDays;
    const amount =
      partial && input.prorate ? round2(full.mul(actualDays).div(nominalDays)) : round2(full);

    const y = nominalStart.getUTCFullYear();
    const m = nominalStart.getUTCMonth();
    const dueDay = Math.min(Math.max(1, input.dueDay), daysInMonth(y, m));
    let due = utcDate(y, m, dueDay);
    if (due < pStart) due = pStart; // first partial period is due on move-in
    periods.push({ periodStart: pStart, periodEnd: pEnd, dueDate: due, amount, prorated: partial && input.prorate });
    nominalStart = addDays(nominalEnd, 1);
  }
  return periods;
}
