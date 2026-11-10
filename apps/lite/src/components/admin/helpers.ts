import { z } from 'zod';

import { formatMoney } from '@/server/money';

/**
 * Small pure helpers shared by the back-office pages: search-param parsing, URL building and
 * display of USD cents. Safe on the server and the client.
 */

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** First value of every search param, trimmed; empty values are dropped. */
export function flattenParams(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, raw] of Object.entries(params)) {
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value) flat[key] = value.slice(0, 200);
  }
  return flat;
}

/** `base?key=value…`, skipping empty values. */
export function hrefWith(
  base: string,
  params: Record<string, string | number | undefined | null>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

/** USD cents → `1 234.56 USD`. */
export const usd = (cents: bigint): string => formatMoney(cents, 'USD');

/** Basis points → `12.34%`. */
export function percentBps(bps: number): string {
  const sign = bps < 0 ? '-' : '';
  const abs = Math.abs(bps);
  return `${sign}${Math.trunc(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}%`;
}

/** Seconds → `45 s`, `12 min`, `1 h 48 min`, `2 d 3 h`. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`;
}

/**
 * A treasury position is "in use" when its currency belongs to a live country or the ledger
 * already holds something in it. Planned currencies with an empty float are not an alert.
 */
export function positionInUse(
  position: { currency: string; float: bigint; walletLiabilities: bigint; suspense: bigint },
  liveCurrencies: ReadonlySet<string>,
): boolean {
  return (
    liveCurrencies.has(position.currency) ||
    position.float !== 0n ||
    position.walletLiabilities !== 0n ||
    position.suspense !== 0n
  );
}

/** Options for a `<Select>` from a list of enum values. */
export function enumOptions(
  values: readonly string[],
  label: (value: string) => string = (value) => value,
): Array<{ value: string; label: string }> {
  return values.map((value) => ({ value, label: label(value) }));
}

// ---- Zod fragments for search params (invalid input falls back to "no filter") -------------

export const pageParam = z.coerce.number().int().min(1).max(100_000).catch(1);
export const textParam = z.string().trim().min(1).max(120).optional().catch(undefined);
export const uuidParam = z.uuid().optional().catch(undefined);
export const countryParam = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/)
  .optional()
  .catch(undefined);
export const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

/** Optional enum filter that ignores unknown values. */
export const enumParam = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().catch(undefined);

/** `YYYY-MM-DD` → start / end of that UTC day. */
export const dayStart = (date: string | undefined): Date | undefined =>
  date ? new Date(`${date}T00:00:00.000Z`) : undefined;
export const dayEnd = (date: string | undefined): Date | undefined =>
  date ? new Date(`${date}T23:59:59.999Z`) : undefined;

// ---- Zod fragments for forms ----------------------------------------------------------------

/** A checkbox: present (`on`) when ticked, absent otherwise. */
export const checkbox = z.preprocess(
  (value) => value === 'on' || value === 'true' || value === true,
  z.boolean(),
);

export const reasonField = (label = 'Give a reason') =>
  z.string().trim().min(5, `${label} (at least 5 characters)`).max(500);
