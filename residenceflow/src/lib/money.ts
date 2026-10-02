import Decimal from "decimal.js";

// All money arithmetic goes through decimal.js; values are rounded to 2 dp
// (ROUND_HALF_UP) and converted to strings before reaching Prisma.
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = Decimal.Value | { toString(): string };

export function money(v: MoneyInput | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  return new Decimal(typeof v === "object" && !(v instanceof Decimal) ? v.toString() : (v as Decimal.Value));
}

export function round2(v: MoneyInput): Decimal {
  return money(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function sum(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

export function toDb(v: MoneyInput): string {
  return round2(v).toFixed(2);
}

export function max0(v: MoneyInput): Decimal {
  const d = money(v);
  return d.isNegative() ? new Decimal(0) : d;
}

export { Decimal };
