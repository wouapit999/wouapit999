/**
 * Locale-stable formatting helpers (UTC, English) usable on the server and the client. Keeping
 * the output independent of the runtime's locale/time zone avoids hydration mismatches.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toDate = (value: Date | string): Date =>
  typeof value === 'string' ? new Date(value) : value;
const pad = (value: number): string => value.toString().padStart(2, '0');

/** `10 Nov 2026`. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** `10 Nov 2026, 14:05 UTC`. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(date)}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** `just now`, `5 min ago`, `3 h ago`, `2 d ago`, else the date. */
export function formatRelative(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return '—';
  const date = toDate(value);
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return formatDate(date);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)} d ago`;
  return formatDate(date);
}

/** Basis points → percentage text: `175` → `1.75%`. */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = Math.abs(bps % 100);
  return `${whole}.${pad(fraction)}%`;
}

/** `SOME_ENUM_VALUE` → `Some enum value`. */
export function humanize(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Compact integer: `1234567` → `1.2M` (display only — never for money that must be exact). */
export function formatCompact(value: number | bigint): string {
  const number = typeof value === 'bigint' ? Number(value) : value;
  const abs = Math.abs(number);
  if (abs >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(number / 1_000).toFixed(1)}k`;
  return number.toLocaleString('en-US');
}
