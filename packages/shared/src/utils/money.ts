import { CURRENCIES, type CurrencyCode } from '../constants/currencies.js';

/**
 * Money helpers. Amounts are `bigint` minor units (cents, or whole francs for exponent-0
 * currencies) paired with an ISO-4217 code, exactly as stored in Postgres (`BIGINT` + `currency`).
 * Decimal strings such as `"1250.75"` are the only human-facing representation; JavaScript
 * `number` is never used for arithmetic.
 */

export interface Money {
  readonly amount: bigint;
  readonly currency: CurrencyCode;
}

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP';

export class MoneyError extends Error {
  override readonly name = 'MoneyError';

  constructor(
    message: string,
    readonly code:
      | 'INVALID_DECIMAL'
      | 'TOO_MANY_DECIMALS'
      | 'INVALID_MINOR_UNITS'
      | 'CURRENCY_MISMATCH'
      | 'INVALID_RATIOS'
      | 'UNSAFE_NUMBER',
  ) {
    super(message);
  }
}

const DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d*))?$|^([+-])?\.(\d+)$/;
const INTEGER_PATTERN = /^[+-]?\d+$/;

export function getCurrencyExponent(currency: CurrencyCode): number {
  return CURRENCIES[currency].exponent;
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/**
 * Parses a decimal string (`"12"`, `"12.50"`, `"-0.05"`, `".5"`) into minor units for the
 * given currency. Rejects anything with more fractional digits than the currency allows;
 * callers that need rounding must do it explicitly via {@link roundDecimal}.
 */
export function toMinorUnits(decimal: string, currency: CurrencyCode): bigint {
  const normalized = decimal.trim().replace(/[\s_]/g, '');
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) {
    throw new MoneyError(`"${decimal}" is not a valid decimal amount`, 'INVALID_DECIMAL');
  }

  const sign = match[1] ?? match[4] ?? '+';
  const integerPart = match[2] ?? '0';
  const fractionPart = match[3] ?? match[5] ?? '';
  const exponent = getCurrencyExponent(currency);

  if (fractionPart.replace(/0+$/, '').length > exponent) {
    throw new MoneyError(
      `${currency} supports at most ${exponent} decimal place(s); got "${decimal}"`,
      'TOO_MANY_DECIMALS',
    );
  }

  const paddedFraction = fractionPart.slice(0, exponent).padEnd(exponent, '0');
  const magnitude = BigInt(integerPart) * pow10(exponent) + BigInt(paddedFraction || '0');
  return sign === '-' ? -magnitude : magnitude;
}

/** Validates and coerces an integer-like value (bigint, safe integer or digit string) to bigint. */
export function assertMinorUnits(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new MoneyError(`${value} is not a safe integer amount of minor units`, 'UNSAFE_NUMBER');
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    throw new MoneyError(
      `"${value}" is not an integer amount of minor units`,
      'INVALID_MINOR_UNITS',
    );
  }
  return BigInt(trimmed);
}

/** Formats minor units as a plain decimal string with exactly `exponent` fraction digits. */
export function fromMinorUnits(minor: bigint | number | string, currency: CurrencyCode): string {
  const amount = assertMinorUnits(minor);
  const exponent = getCurrencyExponent(currency);
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString();

  if (exponent === 0) {
    return `${negative ? '-' : ''}${digits}`;
  }

  const padded = digits.padStart(exponent + 1, '0');
  const integerPart = padded.slice(0, -exponent);
  const fractionPart = padded.slice(-exponent);
  return `${negative ? '-' : ''}${integerPart}.${fractionPart}`;
}

/** Serialises a bigint amount for JSON transport (BIGINT ⟷ string, never number). */
export function serializeMoney(money: Money): { amount: string; currency: CurrencyCode } {
  return { amount: money.amount.toString(), currency: money.currency };
}

export function deserializeMoney(input: {
  amount: string | number | bigint;
  currency: CurrencyCode;
}): Money {
  return { amount: assertMinorUnits(input.amount), currency: input.currency };
}

/** Builds a {@link Money} from a decimal string. */
export function money(decimal: string, currency: CurrencyCode): Money {
  return { amount: toMinorUnits(decimal, currency), currency };
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`, 'CURRENCY_MISMATCH');
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount === b.amount) return 0;
  return a.amount < b.amount ? -1 : 1;
}

export function isZero(value: Money): boolean {
  return value.amount === 0n;
}

export function isNegative(value: Money): boolean {
  return value.amount < 0n;
}

/**
 * Divides `numerator / denominator` with explicit rounding; both operands are integers so the
 * result stays exact up to the rounding rule.
 */
export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) {
    throw new MoneyError('Division by zero', 'INVALID_RATIOS');
  }
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  let quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;

  if (remainder !== 0n) {
    const twiceRemainder = remainder * 2n;
    switch (mode) {
      case 'DOWN':
        break;
      case 'UP':
        quotient += 1n;
        break;
      case 'HALF_UP':
        if (twiceRemainder >= absDenominator) quotient += 1n;
        break;
      case 'HALF_EVEN':
        if (
          twiceRemainder > absDenominator ||
          (twiceRemainder === absDenominator && quotient % 2n === 1n)
        ) {
          quotient += 1n;
        }
        break;
    }
  }
  return negative ? -quotient : quotient;
}

/**
 * Applies a fee or FX margin expressed in basis points (1 bp = 0.01 %).
 * `applyBasisPoints(10_000n, 150n)` → `150n` (1.5 % of 10 000 minor units).
 */
export function applyBasisPoints(
  minor: bigint,
  basisPoints: bigint,
  mode: RoundingMode = 'HALF_UP',
): bigint {
  return divideRounded(minor * basisPoints, 10_000n, mode);
}

/**
 * Splits an amount across `ratios` without losing or creating minor units (largest-remainder
 * method). Useful for fee sharing between partners.
 */
export function allocate(minor: bigint, ratios: readonly bigint[]): bigint[] {
  if (ratios.length === 0 || ratios.some((r) => r < 0n)) {
    throw new MoneyError(
      'Ratios must be a non-empty list of non-negative integers',
      'INVALID_RATIOS',
    );
  }
  const total = ratios.reduce((sum, r) => sum + r, 0n);
  if (total === 0n) {
    throw new MoneyError('Ratios must not all be zero', 'INVALID_RATIOS');
  }

  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const shares = ratios.map((r) => (absolute * r) / total);
  let remainder = absolute - shares.reduce((sum, s) => sum + s, 0n);

  // Hand out leftover units one at a time, preferring the largest fractional remainders.
  const order = ratios
    .map((r, index) => ({ index, fraction: (absolute * r) % total }))
    .sort((a, b) =>
      a.fraction === b.fraction ? a.index - b.index : a.fraction > b.fraction ? -1 : 1,
    );
  for (const { index } of order) {
    if (remainder === 0n) break;
    shares[index] = (shares[index] ?? 0n) + 1n;
    remainder -= 1n;
  }

  return negative ? shares.map((s) => -s) : shares;
}

/**
 * Rounds a decimal string to the currency exponent (for display or user-input clean-up) and
 * returns minor units. Unlike {@link toMinorUnits} this never throws for extra digits.
 */
export function roundDecimal(
  decimal: string,
  currency: CurrencyCode,
  mode: RoundingMode = 'HALF_UP',
): bigint {
  const normalized = decimal.trim();
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) {
    throw new MoneyError(`"${decimal}" is not a valid decimal amount`, 'INVALID_DECIMAL');
  }
  const sign = (match[1] ?? match[4]) === '-' ? -1n : 1n;
  const integerPart = match[2] ?? '0';
  const fractionPart = match[3] ?? match[5] ?? '';
  const exponent = getCurrencyExponent(currency);
  const scale = fractionPart.length;
  const scaled = BigInt(integerPart + fractionPart); // amount × 10^scale
  if (scale <= exponent) {
    return sign * scaled * pow10(exponent - scale);
  }
  return sign * divideRounded(scaled, pow10(scale - exponent), mode);
}

/** Locale-aware currency formatting via `Intl` (display only). */
export function formatMoney(
  value: Money,
  locale = 'en',
  options: Pick<Intl.NumberFormatOptions, 'currencyDisplay' | 'signDisplay'> = {},
): string {
  const exponent = getCurrencyExponent(value.currency);
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
    ...options,
  });
  // Intl accepts decimal strings, so amounts beyond Number.MAX_SAFE_INTEGER stay exact.
  return formatter.format(fromMinorUnits(value.amount, value.currency) as unknown as number);
}
