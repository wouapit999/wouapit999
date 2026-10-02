import { z } from "zod";

// Form-field schemas shared by the units, tenants and leases modules (server-side validation).

export const FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"] as const;
export const LATE_FEE_TYPES = ["NONE", "FIXED", "PERCENT"] as const;

/** Record IDs from the client are only used to re-load records with scoped where clauses. */
export const idField = z.string().trim().min(1).max(64);

/** Money as a decimal string (max 2 dp) — never parsed to a float. */
export const moneyField = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Invalid amount");

export const optMoneyField = z
  .union([z.literal(""), moneyField])
  .optional()
  .transform((v) => (v ? v : "0"));

/** "yyyy-mm-dd" → UTC midnight (for @db.Date columns). Returns null for invalid dates. */
export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export const dayField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
  .transform((s, c) => {
    const d = parseDay(s);
    if (!d) {
      c.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

export const optDayField = z
  .union([z.literal(""), dayField])
  .optional()
  .transform((v) => (v instanceof Date ? v : null));

export const boolField = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const emailField = z
  .string()
  .trim()
  .max(200)
  .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Invalid email");

/** Checkbox groups arrive as a string, an array of strings, or nothing. */
export function stringList<T extends string>(allowed: readonly T[]) {
  return z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]),
    z.array(z.enum(allowed as unknown as [T, ...T[]])),
  );
}

/** Date → "yyyy-mm-dd" for <input type="date"> default values. */
export function dayInput(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

export function todayUtcDay() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
