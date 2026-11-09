import { describe, expect, it } from 'vitest';

import {
  DateError,
  MS_PER_DAY,
  addDuration,
  assertDateRange,
  differenceInUtcDays,
  endOfUtcDay,
  formatDateTime,
  isExpired,
  parseDate,
  parseDurationMs,
  startOfUtcDay,
} from '../dates.js';
import {
  generateCorrelationId,
  generateHumanReference,
  generateId,
  generateOpaqueToken,
  isUuid,
  resolveCorrelationId,
} from '../ids.js';

describe('ids', () => {
  it('generates RFC 4122 UUIDs', () => {
    const id = generateId();
    expect(isUuid(id)).toBe(true);
    expect(isUuid(generateCorrelationId())).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(new Set(Array.from({ length: 50 }, generateId)).size).toBe(50);
  });

  it('resolveCorrelationId keeps well-formed inbound ids and replaces bad ones', () => {
    expect(resolveCorrelationId('req-123456789')).toBe('req-123456789');
    expect(resolveCorrelationId(['abc.def:0123', 'other'])).toBe('abc.def:0123');
    expect(isUuid(resolveCorrelationId(undefined))).toBe(true);
    expect(isUuid(resolveCorrelationId('short'))).toBe(true);
    expect(isUuid(resolveCorrelationId('has spaces in it'))).toBe(true);
    expect(isUuid(resolveCorrelationId('x'.repeat(129)))).toBe(true);
    expect(isUuid(resolveCorrelationId([]))).toBe(true);
  });

  it('generateOpaqueToken yields URL-safe base64 of the requested entropy', () => {
    const token = generateOpaqueToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateOpaqueToken(48)).toHaveLength(64);
    expect(() => generateOpaqueToken(8)).toThrow(RangeError);
  });

  it('generateHumanReference avoids ambiguous characters', () => {
    const reference = generateHumanReference('TRX', 10);
    expect(reference).toMatch(/^TRX-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$/);
    expect(() => generateHumanReference('trx')).toThrow(RangeError);
    expect(() => generateHumanReference('TRX', 3)).toThrow(RangeError);
  });
});

describe('dates', () => {
  it('parses durations used by env vars', () => {
    expect(parseDurationMs('15m')).toBe(15 * 60_000);
    expect(parseDurationMs('30d')).toBe(30 * MS_PER_DAY);
    expect(parseDurationMs('2h')).toBe(7_200_000);
    expect(parseDurationMs('45s')).toBe(45_000);
    expect(parseDurationMs('250ms')).toBe(250);
    for (const bad of ['', '15', 'm15', '1.5h', '15 m', '15w']) {
      expect(() => parseDurationMs(bad), bad).toThrowError(DateError);
    }
  });

  it('adds durations and detects expiry', () => {
    const base = new Date('2026-01-01T00:00:00.000Z');
    expect(addDuration(base, '15m').toISOString()).toBe('2026-01-01T00:15:00.000Z');
    expect(addDuration(base, { days: 1, hours: 2 }).toISOString()).toBe('2026-01-02T02:00:00.000Z');
    expect(isExpired(addDuration(base, '1h'), base)).toBe(false);
    expect(isExpired(base, base)).toBe(true);
    expect(isExpired('2020-01-01T00:00:00Z', base)).toBe(true);
  });

  it('parseDate rejects invalid values and copies Date instances', () => {
    const original = new Date('2026-05-05T10:00:00Z');
    const copy = parseDate(original);
    expect(copy).not.toBe(original);
    expect(copy.getTime()).toBe(original.getTime());
    expect(() => parseDate('not a date')).toThrowError(DateError);
    expect(() => parseDate(Number.NaN)).toThrowError(DateError);
  });

  it('computes UTC day boundaries and differences', () => {
    const d = new Date('2026-03-15T13:45:12.345Z');
    expect(startOfUtcDay(d).toISOString()).toBe('2026-03-15T00:00:00.000Z');
    expect(endOfUtcDay(d).toISOString()).toBe('2026-03-15T23:59:59.999Z');
    expect(
      differenceInUtcDays(new Date('2026-03-01T23:00:00Z'), new Date('2026-03-02T01:00:00Z')),
    ).toBe(1);
    expect(
      differenceInUtcDays(new Date('2026-03-10T00:00:00Z'), new Date('2026-03-01T00:00:00Z')),
    ).toBe(-9);
  });

  it('validates date ranges', () => {
    const range = assertDateRange('2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z', 31);
    expect(range.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(() => assertDateRange('2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z')).toThrow(
      /not be after/,
    );
    expect(() => assertDateRange('2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z', 30)).toThrow(
      /exceed 30 days/,
    );
  });

  it('formats for display', () => {
    expect(formatDateTime('2026-03-15T13:45:00Z', 'en')).toMatch(/Mar 15, 2026/);
    expect(
      formatDateTime('2026-03-15T13:45:00Z', 'fr', { dateStyle: 'long', timeZone: 'UTC' }),
    ).toBe('15 mars 2026');
  });
});
