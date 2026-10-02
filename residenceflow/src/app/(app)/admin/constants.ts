import { z } from "zod";

export const TIMEZONES = [
  "Africa/Douala", "Africa/Lagos", "Africa/Abidjan", "Africa/Dakar", "Africa/Accra", "Africa/Kinshasa",
  "Africa/Libreville", "Africa/Brazzaville", "Africa/Ndjamena", "Africa/Bangui", "Africa/Malabo", "Africa/Casablanca",
  "Africa/Algiers", "Africa/Tunis", "Africa/Cairo", "Africa/Nairobi", "Africa/Johannesburg", "Europe/Paris",
  "Europe/London", "Europe/Brussels", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "America/Montreal", "Asia/Dubai", "UTC",
] as const;

export const DATE_FORMATS = ["dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd"] as const;
export const LANGUAGES = ["en", "fr"] as const;
export const CURRENCIES = ["XAF", "XOF", "EUR", "USD", "NGN", "GHS", "GBP", "KES", "ZAR", "MAD", "CAD"] as const;
export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "MOBILE_MONEY", "CHEQUE", "GATEWAY", "OTHER"] as const;
export const LATE_FEE_TYPES = ["NONE", "FIXED", "PERCENT"] as const;
export const FEATURE_FLAGS = ["applications", "utilities", "inspections"] as const;
export const ORG_ROLE_SCOPES = ["ORGANIZATION", "ASSIGNED_BUILDINGS", "ASSIGNED_UNITS", "OWN"] as const;
export const USER_STATUSES = ["INVITED", "ACTIVE", "SUSPENDED", "ARCHIVED"] as const;

/** HTML checkbox → boolean ("on" when checked, absent otherwise). */
export const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

/** Single value or repeated form field → string[]. */
export const stringList = z.preprocess(
  (v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]),
  z.array(z.string().max(100)).max(500),
);

export const optionalText = (max: number) => z.string().trim().max(max).default("");
