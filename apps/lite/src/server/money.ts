import { AppError } from './errors';

/**
 * Money helpers. Amounts are `bigint` minor units + an ISO-4217 code, end to end. FX rates are
 * fixed-point `bigint`s scaled by 10^10 (the database stores them as Decimal(24,10)).
 * No floats anywhere: every conversion is integer arithmetic with an explicit rounding mode.
 */

export interface CurrencyInfo {
  readonly code: string;
  readonly name: string;
  /** Number of decimal places of the minor unit. */
  readonly exponent: 0 | 2;
  readonly symbol: string;
}

export const CURRENCIES = {
  XAF: { code: 'XAF', name: 'Central African CFA franc', exponent: 0, symbol: 'FCFA' },
  XOF: { code: 'XOF', name: 'West African CFA franc', exponent: 0, symbol: 'CFA' },
  AOA: { code: 'AOA', name: 'Angolan kwanza', exponent: 2, symbol: 'Kz' },
  MZN: { code: 'MZN', name: 'Mozambican metical', exponent: 2, symbol: 'MT' },
  CVE: { code: 'CVE', name: 'Cape Verdean escudo', exponent: 2, symbol: 'Esc' },
  STN: { code: 'STN', name: 'São Tomé and Príncipe dobra', exponent: 2, symbol: 'Db' },
  NGN: { code: 'NGN', name: 'Nigerian naira', exponent: 2, symbol: '₦' },
  GHS: { code: 'GHS', name: 'Ghanaian cedi', exponent: 2, symbol: 'GH₵' },
  KES: { code: 'KES', name: 'Kenyan shilling', exponent: 2, symbol: 'KSh' },
  UGX: { code: 'UGX', name: 'Ugandan shilling', exponent: 0, symbol: 'USh' },
  TZS: { code: 'TZS', name: 'Tanzanian shilling', exponent: 2, symbol: 'TSh' },
  RWF: { code: 'RWF', name: 'Rwandan franc', exponent: 0, symbol: 'FRw' },
  ZAR: { code: 'ZAR', name: 'South African rand', exponent: 2, symbol: 'R' },
  USD: { code: 'USD', name: 'US dollar', exponent: 2, symbol: '$' },
  EUR: { code: 'EUR', name: 'Euro', exponent: 2, symbol: '€' },
} as const satisfies Record<string, CurrencyInfo>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(CURRENCIES, value);
}

export function currencyInfo(currency: string): CurrencyInfo {
  if (!isCurrencyCode(currency)) {
    throw new AppError('VALIDATION', `Unsupported currency ${currency}`);
  }
  return CURRENCIES[currency];
}

export const currencyExponent = (currency: string): number => currencyInfo(currency).exponent;

const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);

/** `123456n, 'AOA'` → `"1234.56"`; `1500n, 'XAF'` → `"1500"`. Plain, locale-free. */
export function toMajorString(minor: bigint, currency: string): string {
  const exponent = currencyExponent(currency);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  if (exponent === 0) return `${negative ? '-' : ''}${absolute}`;
  const divisor = pow10(exponent);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(exponent, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function groupThousands(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

export interface FormatMoneyOptions {
  /** Append the ISO code (default true). */
  readonly withCode?: boolean;
  /** Prefix `+` for positive amounts (statements). */
  readonly signed?: boolean;
}

/** Human format with thin thousands grouping: `1 250 000 XAF`, `12 345.60 AOA`. */
export function formatMoney(
  minor: bigint,
  currency: string,
  options: FormatMoneyOptions = {},
): string {
  const { withCode = true, signed = false } = options;
  const plain = toMajorString(minor < 0n ? -minor : minor, currency);
  const [whole = '0', fraction] = plain.split('.');
  const grouped = groupThousands(whole, '\u202f');
  const sign = minor < 0n ? '-' : signed && minor > 0n ? '+' : '';
  const body = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  return withCode ? `${sign}${body} ${currency}` : `${sign}${body}`;
}

/**
 * Parses user input (`"1 250,50"`, `"1250.5"`, `"1,250.50"`) into minor units. Rejects negative
 * amounts, more decimals than the currency allows and anything that is not a plain number.
 */
export function parseMoney(input: string, currency: string): bigint {
  const exponent = currencyExponent(currency);
  const compact = input.trim().replace(/[\s\u00a0\u202f']/g, '');
  if (compact === '') throw new AppError('VALIDATION', 'Enter an amount');
  let normalised = compact;
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the last one is the decimal separator, the other groups thousands.
    normalised =
      lastComma > lastDot
        ? compact.replace(/\./g, '').replace(',', '.')
        : compact.replace(/,/g, '');
  } else if (lastComma !== -1) {
    // Only commas: a single comma followed by 1–2 digits is a decimal separator.
    const decimals = compact.length - lastComma - 1;
    normalised =
      compact.indexOf(',') === lastComma && decimals > 0 && decimals <= 2
        ? compact.replace(',', '.')
        : compact.replace(/,/g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(normalised)) {
    throw new AppError('VALIDATION', 'Enter a valid positive amount');
  }
  const [whole = '0', fraction = ''] = normalised.split('.');
  if (fraction.length > exponent) {
    throw new AppError(
      'VALIDATION',
      exponent === 0
        ? `${currency} has no decimals`
        : `${currency} allows at most ${exponent} decimals`,
    );
  }
  if (whole.length > 15) throw new AppError('VALIDATION', 'Amount is too large');
  return BigInt(whole) * pow10(exponent) + BigInt(fraction.padEnd(exponent, '0') || '0');
}

/** Parses a minor-unit integer string (hidden form fields, API payloads). */
export function parseMinor(input: string): bigint {
  if (!/^\d{1,18}$/.test(input.trim())) {
    throw new AppError('VALIDATION', 'Amount must be a non-negative integer in minor units');
  }
  return BigInt(input.trim());
}

export type Rounding = 'floor' | 'ceil' | 'half_up';

/** Integer division with an explicit rounding mode (operands must be non-negative). */
export function divRound(numerator: bigint, denominator: bigint, rounding: Rounding): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  if (numerator < 0n) throw new RangeError('numerator must be non-negative');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  switch (rounding) {
    case 'floor':
      return quotient;
    case 'ceil':
      return quotient + 1n;
    case 'half_up':
      return remainder * 2n >= denominator ? quotient + 1n : quotient;
  }
}

/** `amount × bps / 10 000` in minor units. */
export function bpsOf(amount: bigint, bps: number, rounding: Rounding = 'half_up'): bigint {
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError('bps must be a non-negative integer');
  return divRound(amount * BigInt(bps), 10_000n, rounding);
}

// ---------------------------------------------------------------------------
// FX rates — fixed point, 10 decimal places
// ---------------------------------------------------------------------------

export const RATE_DECIMALS = 10;
export const RATE_SCALE = pow10(RATE_DECIMALS);

/** Parses `"655.957"` / a Prisma Decimal into a scaled bigint (rate × 10^10). */
export function parseRate(value: string | { toFixed(decimals: number): string }): bigint {
  const text = typeof value === 'string' ? value.trim() : value.toFixed(RATE_DECIMALS);
  if (!/^\d+(\.\d+)?$/.test(text)) throw new AppError('VALIDATION', 'Enter a valid positive rate');
  const [whole = '0', fraction = ''] = text.split('.');
  if (fraction.length > RATE_DECIMALS) {
    throw new AppError('VALIDATION', `Rates support at most ${RATE_DECIMALS} decimals`);
  }
  if (whole.length > 12) throw new AppError('VALIDATION', 'Rate is too large');
  return BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(RATE_DECIMALS, '0'));
}

/** Scaled bigint → decimal string, trailing zeros trimmed (`"655.957"`). */
export function formatRate(scaled: bigint, minDecimals = 2): string {
  const whole = scaled / RATE_SCALE;
  let fraction = (scaled % RATE_SCALE).toString().padStart(RATE_DECIMALS, '0');
  fraction = fraction.replace(/0+$/, '');
  if (fraction.length < minDecimals) fraction = fraction.padEnd(minDecimals, '0');
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}

/** Full-precision string for storing in a Decimal(24,10) column. */
export function rateToDecimalString(scaled: bigint): string {
  const whole = scaled / RATE_SCALE;
  const fraction = (scaled % RATE_SCALE).toString().padStart(RATE_DECIMALS, '0');
  return `${whole}.${fraction}`;
}

/** Customer rate = mid × (1 − margin). Rounded down (in the platform's favour). */
export function applyMargin(midRate: bigint, marginBps: number): bigint {
  if (!Number.isInteger(marginBps) || marginBps < 0 || marginBps >= 10_000) {
    throw new RangeError('marginBps must be an integer in [0, 10000)');
  }
  return (midRate * BigInt(10_000 - marginBps)) / 10_000n;
}

/**
 * Converts minor units of `from` into minor units of `to` at `rate` (units of `to` per 1 major
 * unit of `from`, scaled by 10^10), honouring both currency exponents.
 */
export function convertAmount(
  amount: bigint,
  rate: bigint,
  from: string,
  to: string,
  rounding: Rounding = 'floor',
): bigint {
  if (amount < 0n) throw new RangeError('amount must be non-negative');
  const numerator = amount * rate * pow10(currencyExponent(to));
  const denominator = RATE_SCALE * pow10(currencyExponent(from));
  return divRound(numerator, denominator, rounding);
}

/** Inverse of a rate (for derived pairs), rounded half up. */
export function invertRate(rate: bigint): bigint {
  if (rate <= 0n) throw new RangeError('rate must be positive');
  return divRound(RATE_SCALE * RATE_SCALE, rate, 'half_up');
}

// ---------------------------------------------------------------------------
// Serialisation across the server → client boundary
// ---------------------------------------------------------------------------

export type Serialized<T> = T extends bigint
  ? string
  : T extends Date
    ? string
    : T extends Uint8Array
      ? never
      : T extends { toFixed(decimals: number): string; toNumber(): number }
        ? string
        : T extends Array<infer U>
          ? Array<Serialized<U>>
          : T extends object
            ? { [K in keyof T]: Serialized<T[K]> }
            : T;

function isDecimalLike(value: object): value is { toFixed(decimals?: number): string } {
  return (
    typeof (value as { toFixed?: unknown }).toFixed === 'function' &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  );
}

/**
 * Deep-converts `bigint` → string, `Date` → ISO string and Prisma `Decimal` → string so a value
 * can be passed to Client Components or `JSON.stringify`. Binary fields are dropped.
 */
export function serialize<T>(value: T): Serialized<T> {
  const walk = (input: unknown): unknown => {
    if (typeof input === 'bigint') return input.toString();
    if (input instanceof Date) return input.toISOString();
    if (input instanceof Uint8Array) return undefined;
    if (Array.isArray(input)) return input.map(walk);
    if (typeof input === 'object' && input !== null) {
      if (isDecimalLike(input)) return input.toFixed();
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, entry]) => [key, walk(entry)]),
      );
    }
    return input;
  };
  return walk(value) as Serialized<T>;
}

/**
 * Normalises an aggregate from raw SQL to `bigint`. Postgres returns `SUM(bigint)` as `numeric`
 * (a Prisma Decimal), `COUNT(*)` as `bigint` and nothing at all (`null`) for empty sets.
 */
export function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  const text =
    typeof value === 'string' ? value : (value as { toFixed(decimals: number): string }).toFixed(0);
  return BigInt(text.split('.')[0] ?? '0');
}
