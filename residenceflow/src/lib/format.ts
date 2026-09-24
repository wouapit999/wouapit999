import { formatInTimeZone } from "date-fns-tz";
import { money, type MoneyInput } from "./money";

export interface FormatPrefs {
  locale: string;
  currency: string;
  timezone: string;
  dateFormat?: string;
}

export function formatMoney(v: MoneyInput | null | undefined, prefs: Pick<FormatPrefs, "locale" | "currency">) {
  const n = money(v).toNumber(); // display only
  const zeroDecimals = ["XAF", "XOF", "JPY"].includes(prefs.currency);
  return new Intl.NumberFormat(prefs.locale === "fr" ? "fr-CM" : "en-CM", {
    style: "currency",
    currency: prefs.currency,
    maximumFractionDigits: zeroDecimals ? 0 : 2,
    minimumFractionDigits: zeroDecimals ? 0 : 2,
  }).format(n);
}

export function formatNumber(v: number, locale: string) {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US").format(v);
}

/** Dates are stored in UTC and displayed in the organization's timezone. */
export function formatDate(d: Date | string | null | undefined, prefs: Pick<FormatPrefs, "timezone" | "dateFormat">) {
  if (!d) return "—";
  return formatInTimeZone(new Date(d), prefs.timezone, prefs.dateFormat ?? "dd/MM/yyyy");
}

/** For @db.Date columns (calendar dates) — display without timezone shifting. */
export function formatDay(d: Date | string | null | undefined, prefs: Pick<FormatPrefs, "dateFormat">) {
  if (!d) return "—";
  return formatInTimeZone(new Date(d), "UTC", prefs.dateFormat ?? "dd/MM/yyyy");
}

export function formatDateTime(d: Date | string | null | undefined, prefs: Pick<FormatPrefs, "timezone" | "dateFormat">) {
  if (!d) return "—";
  return formatInTimeZone(new Date(d), prefs.timezone, `${prefs.dateFormat ?? "dd/MM/yyyy"} HH:mm`);
}

export function maskId(value: string) {
  if (!value) return "";
  const tail = value.slice(-3);
  return `${"•".repeat(Math.max(3, value.length - 3))}${tail}`;
}
