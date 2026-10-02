import Decimal from "decimal.js";
import { isValidDay } from "./reconciliation";

export const UTILITY_TYPES = ["ELECTRICITY", "WATER", "GAS", "OTHER"] as const;
export type UtilityType = (typeof UTILITY_TYPES)[number];

type Num = Decimal.Value | { toString(): string };
const dec = (v: Num | null | undefined) => new Decimal(v === null || v === undefined || v === "" ? 0 : typeof v === "object" && !(v instanceof Decimal) ? v.toString() : (v as Decimal.Value));

/** Consumption between two readings (3 dp). Throws when the current reading is below the previous one. */
export function computeConsumption(prev: Num | null | undefined, curr: Num): Decimal {
  const p = prev === null || prev === undefined ? new Decimal(0) : dec(prev);
  const c = dec(curr);
  if (c.lt(p)) throw new Error("Current reading must be greater than or equal to the previous reading.");
  return c.minus(p).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

/** Amount to bill = consumption × tariff + fixed fee, rounded to 2 dp (never negative). */
export function computeUtilityAmount(consumption: Num, tariff: Num, fixedFee: Num = 0): Decimal {
  const amount = dec(consumption).mul(dec(tariff)).plus(dec(fixedFee)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return amount.isNegative() ? new Decimal(0) : amount;
}

export interface ImportRow {
  line: number;
  serial: string;
  date: string;
  value: string;
}
export interface ImportRowError {
  line: number;
  error: string;
}

/** Parses a `serial,date,value` CSV (header optional, `;` accepted). Row-level validation only. */
export function parseReadingCsv(text: string): { rows: ImportRow[]; errors: ImportRowError[] } {
  const rows: ImportRow[] = [];
  const errors: ImportRowError[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/[,;]/).map((p) => p.trim().replace(/^"|"$/g, ""));
    if (i === 0 && /^serial$/i.test(parts[0] ?? "")) return; // header
    if (parts.length < 3) return void errors.push({ line, error: "Expected 3 columns: serial,date,value" });
    const [serial, date, value] = parts;
    if (!serial) return void errors.push({ line, error: "Missing serial" });
    if (!isValidDay(date)) return void errors.push({ line, error: "Invalid date (yyyy-mm-dd)" });
    if (!/^\d+(\.\d{1,3})?$/.test(value)) return void errors.push({ line, error: "Invalid value (number, up to 3 decimals)" });
    rows.push({ line, serial, date, value });
  });
  return { rows, errors };
}
