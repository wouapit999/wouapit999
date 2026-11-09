export class DateError extends Error {
  override readonly name = 'DateError';

  constructor(
    message: string,
    readonly code: 'INVALID_DATE' | 'INVALID_DURATION' | 'INVALID_RANGE',
  ) {
    super(message);
  }
}

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export interface Duration {
  readonly days?: number;
  readonly hours?: number;
  readonly minutes?: number;
  readonly seconds?: number;
  readonly milliseconds?: number;
}

/** Compact duration syntax used in env vars such as `JWT_ACCESS_TTL=15m` or `30d`. */
const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/;

const DURATION_UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: MS_PER_SECOND,
  m: MS_PER_MINUTE,
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Parses an ISO-8601 string (or epoch milliseconds) into a `Date`, rejecting invalid input. */
export function parseDate(value: string | number | Date): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!isValidDate(date)) {
    throw new DateError(`"${String(value)}" is not a valid date`, 'INVALID_DATE');
  }
  return date;
}

/** Converts `15m`, `12h`, `30d`, `45s`, `250ms` to milliseconds. */
export function parseDurationMs(input: string): number {
  const match = DURATION_PATTERN.exec(input.trim());
  const unitMs = match ? DURATION_UNIT_MS[match[2] ?? ''] : undefined;
  if (!match || unitMs === undefined) {
    throw new DateError(
      `"${input}" is not a duration (expected e.g. 15m, 12h, 30d)`,
      'INVALID_DURATION',
    );
  }
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount * unitMs)) {
    throw new DateError(`"${input}" is too large`, 'INVALID_DURATION');
  }
  return amount * unitMs;
}

export function durationToMs(duration: Duration): number {
  return (
    (duration.days ?? 0) * MS_PER_DAY +
    (duration.hours ?? 0) * MS_PER_HOUR +
    (duration.minutes ?? 0) * MS_PER_MINUTE +
    (duration.seconds ?? 0) * MS_PER_SECOND +
    (duration.milliseconds ?? 0)
  );
}

export function addDuration(date: Date, duration: Duration | string): Date {
  const ms = typeof duration === 'string' ? parseDurationMs(duration) : durationToMs(duration);
  return new Date(parseDate(date).getTime() + ms);
}

export function isExpired(expiresAt: Date | string, now: Date = new Date()): boolean {
  return parseDate(expiresAt).getTime() <= now.getTime();
}

export function startOfUtcDay(date: Date): Date {
  const d = parseDate(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function endOfUtcDay(date: Date): Date {
  return new Date(startOfUtcDay(date).getTime() + MS_PER_DAY - 1);
}

/** Whole UTC days between two dates (`to - from`), negative when `to` is earlier. */
export function differenceInUtcDays(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / MS_PER_DAY);
}

export interface DateRange {
  readonly from: Date;
  readonly to: Date;
}

/** Validates `from <= to` and an optional maximum span (in days) for query filters. */
export function assertDateRange(
  from: Date | string,
  to: Date | string,
  maxDays?: number,
): DateRange {
  const range = { from: parseDate(from), to: parseDate(to) };
  if (range.from.getTime() > range.to.getTime()) {
    throw new DateError('Range start must not be after range end', 'INVALID_RANGE');
  }
  if (maxDays !== undefined && range.to.getTime() - range.from.getTime() > maxDays * MS_PER_DAY) {
    throw new DateError(`Range must not exceed ${maxDays} days`, 'INVALID_RANGE');
  }
  return range;
}

/** Locale-aware display formatting (defaults to a medium date + short time in UTC). */
export function formatDateTime(
  date: Date | string,
  locale = 'en',
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  },
): string {
  return new Intl.DateTimeFormat(locale, options).format(parseDate(date));
}
