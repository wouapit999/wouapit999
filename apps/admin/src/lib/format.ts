import { COUNTRIES, type CountryCode } from '@bi-rem/shared/constants';
import { formatDateTime } from '@bi-rem/shared/utils';

const LOCALE = 'en-GB';

/** Medium date + short time in the viewer's time zone; `—` for null. */
export function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return formatDateTime(value, LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return value;
  }
}

/** Relative time such as `3 min ago`, falling back to the absolute date beyond a week. */
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  const diffSeconds = Math.round((time - now) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  if (abs < 60) return rtf.format(diffSeconds, 'second');
  if (abs < 3_600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSeconds / 3_600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(diffSeconds / 86_400), 'day');
  return formatWhen(value);
}

/** Country name for an ISO-3166 code; unknown codes (not yet in the shared list) show as-is. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '—';
  const known = (COUNTRIES as Partial<Record<string, { name: string }>>)[code];
  return known?.name ?? code;
}

export function isKnownCountryCode(code: string): code is CountryCode {
  return Object.hasOwn(COUNTRIES, code);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value);
}

/** `SUSPENDED` → `Suspended`, `PENDING_VERIFICATION` → `Pending verification`. */
export function humanizeEnum(value: string): string {
  const spaced = value.toLowerCase().replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function fullName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

export function initials(user: { firstName: string; lastName: string; email: string }): string {
  const letters = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  return letters || user.email.charAt(0).toUpperCase();
}

/** Converts a `datetime-local` input value to an ISO string with offset (or undefined). */
export function localInputToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
