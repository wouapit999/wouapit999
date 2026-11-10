import { describe, expect, it } from 'vitest';

import {
  CURRENCY_CODES,
  RATE_SCALE,
  applyMargin,
  bpsOf,
  convertAmount,
  currencyExponent,
  divRound,
  formatMoney,
  formatRate,
  invertRate,
  parseMinor,
  parseMoney,
  parseRate,
  rateToDecimalString,
  serialize,
  toBigInt,
  toMajorString,
} from '@/server/money';

describe('currency exponents', () => {
  it('match the specification', () => {
    const expected: Record<string, number> = {
      XAF: 0,
      XOF: 0,
      AOA: 2,
      MZN: 2,
      CVE: 2,
      STN: 2,
      NGN: 2,
      GHS: 2,
      KES: 2,
      UGX: 0,
      TZS: 2,
      RWF: 0,
      ZAR: 2,
      USD: 2,
      EUR: 2,
    };
    expect([...CURRENCY_CODES].sort()).toEqual(Object.keys(expected).sort());
    for (const [code, exponent] of Object.entries(expected))
      expect(currencyExponent(code)).toBe(exponent);
    expect(() => currencyExponent('BTC')).toThrow(/Unsupported currency/);
  });
});

describe('formatting', () => {
  it('prints major units without floats', () => {
    expect(toMajorString(123_456n, 'AOA')).toBe('1234.56');
    expect(toMajorString(5n, 'AOA')).toBe('0.05');
    expect(toMajorString(1_500n, 'XAF')).toBe('1500');
    expect(toMajorString(-250n, 'USD')).toBe('-2.50');
    expect(toMajorString(9_007_199_254_740_993_00n, 'USD')).toBe('9007199254740993.00');
  });

  it('groups thousands and appends the code', () => {
    expect(formatMoney(1_250_000n, 'XAF')).toBe('1\u202f250\u202f000 XAF');
    expect(formatMoney(1_234_560n, 'AOA')).toBe('12\u202f345.60 AOA');
    expect(formatMoney(0n, 'MZN')).toBe('0.00 MZN');
    expect(formatMoney(-999n, 'XOF')).toBe('-999 XOF');
    expect(formatMoney(500n, 'XAF', { signed: true })).toBe('+500 XAF');
    expect(formatMoney(1_000_00n, 'USD', { withCode: false })).toBe('1\u202f000.00');
  });
});

describe('parseMoney', () => {
  it('accepts the usual ways people type amounts', () => {
    expect(parseMoney('1500', 'XAF')).toBe(1_500n);
    expect(parseMoney(' 1 250 000 ', 'XAF')).toBe(1_250_000n);
    expect(parseMoney('1,250,000', 'XAF')).toBe(1_250_000n);
    expect(parseMoney('1234.5', 'AOA')).toBe(123_450n);
    expect(parseMoney('1234,56', 'AOA')).toBe(123_456n);
    expect(parseMoney('1.234,56', 'AOA')).toBe(123_456n);
    expect(parseMoney('1,234.56', 'AOA')).toBe(123_456n);
    expect(parseMoney('0.07', 'USD')).toBe(7n);
    expect(parseMoney('1,000', 'USD')).toBe(100_000n);
  });

  it('rejects anything ambiguous, negative or too precise', () => {
    for (const bad of ['', '  ', 'abc', '-5', '1e3', '12.345', '1..2', '0x10', '+5']) {
      expect(() => parseMoney(bad, 'AOA'), bad).toThrow();
    }
    expect(() => parseMoney('10.5', 'XAF')).toThrow(/no decimals/);
    expect(() => parseMoney('9999999999999999', 'XAF')).toThrow(/too large/);
  });

  it('parseMinor only takes plain integers', () => {
    expect(parseMinor('12345')).toBe(12_345n);
    for (const bad of ['', '-1', '1.5', '1e3', ' 12 34 '])
      expect(() => parseMinor(bad), bad).toThrow();
  });
});

describe('integer arithmetic', () => {
  it('divRound implements each rounding mode', () => {
    expect(divRound(7n, 2n, 'floor')).toBe(3n);
    expect(divRound(7n, 2n, 'ceil')).toBe(4n);
    expect(divRound(7n, 2n, 'half_up')).toBe(4n);
    expect(divRound(5n, 4n, 'half_up')).toBe(1n);
    expect(divRound(6n, 4n, 'half_up')).toBe(2n);
    expect(divRound(8n, 4n, 'ceil')).toBe(2n);
    expect(() => divRound(1n, 0n, 'floor')).toThrow();
    expect(() => divRound(-1n, 2n, 'floor')).toThrow();
  });

  it('bpsOf computes basis points exactly', () => {
    expect(bpsOf(250_000n, 150)).toBe(3_750n);
    expect(bpsOf(250_000n, 175)).toBe(4_375n);
    expect(bpsOf(333n, 50)).toBe(2n); // 1.665 → 2
    expect(bpsOf(333n, 50, 'floor')).toBe(1n);
    expect(bpsOf(1n, 1)).toBe(0n);
    expect(() => bpsOf(1n, -1)).toThrow();
    expect(() => bpsOf(1n, 1.5)).toThrow();
  });
});

describe('FX rates', () => {
  it('parses and formats fixed-point rates', () => {
    expect(parseRate('655.957')).toBe(6_559_570_000_000n);
    expect(parseRate('0.0015244901')).toBe(15_244_901n);
    expect(parseRate({ toFixed: () => '1.5016228198' })).toBe(15_016_228_198n);
    expect(formatRate(6_559_570_000_000n)).toBe('655.957');
    expect(formatRate(RATE_SCALE)).toBe('1.00');
    expect(formatRate(15_244_901n)).toBe('0.0015244901');
    expect(rateToDecimalString(15_244_901n)).toBe('0.0015244901');
    for (const bad of ['', '-1', 'abc', '1.12345678901', '1e5'])
      expect(() => parseRate(bad), bad).toThrow();
  });

  it('converts across exponents exactly', () => {
    const xafToAoa = parseRate('1.4753444204');
    expect(convertAmount(250_000n, xafToAoa, 'XAF', 'AOA')).toBe(36_883_610n);
    const aoaToXaf = parseRate('0.6542921345');
    expect(convertAmount(1_234_567n, aoaToXaf, 'AOA', 'XAF')).toBe(8_077n);
    expect(convertAmount(1_234_567n, aoaToXaf, 'AOA', 'XAF', 'ceil')).toBe(8_078n);
    // 1 XAF = 1 XOF.
    expect(convertAmount(123_457n, RATE_SCALE, 'XAF', 'XOF')).toBe(123_457n);
    // USD cents → UGX (0 decimals).
    expect(convertAmount(10_050n, parseRate('3700'), 'USD', 'UGX')).toBe(371_850n);
    expect(convertAmount(0n, xafToAoa, 'XAF', 'AOA')).toBe(0n);
  });

  it('applies margins in the platform favour and inverts rates', () => {
    expect(applyMargin(parseRate('1.5016228198'), 175)).toBe(parseRate('1.4753444204'));
    expect(applyMargin(RATE_SCALE, 0)).toBe(RATE_SCALE);
    expect(() => applyMargin(RATE_SCALE, 10_000)).toThrow();
    expect(invertRate(parseRate('655.957'))).toBe(parseRate('0.0015244902'));
    expect(invertRate(parseRate('0.5'))).toBe(parseRate('2'));
  });

  it('never loses money in a round trip (customer cannot profit from rounding)', () => {
    const forward = parseRate('1.4753444204');
    const back = applyMargin(invertRate(parseRate('1.5016228198')), 175);
    for (const amount of [1n, 7n, 99n, 1_000n, 123_457n, 9_999_999n]) {
      const there = convertAmount(amount, forward, 'XAF', 'AOA');
      const again = convertAmount(there, back, 'AOA', 'XAF');
      expect(again <= amount, `${amount} → ${there} → ${again}`).toBe(true);
    }
  });
});

describe('serialisation helpers', () => {
  it('serialize converts bigint, Date and Decimal and drops binary', () => {
    const decimal = { toFixed: () => '1.50', toNumber: () => 1.5 };
    const result = serialize({
      amount: 12n,
      at: new Date('2026-11-10T10:00:00.000Z'),
      rate: decimal,
      nested: [{ value: 1n, blob: new Uint8Array([1]) }],
      plain: 'x',
      nothing: null,
    });
    expect(result).toEqual({
      amount: '12',
      at: '2026-11-10T10:00:00.000Z',
      rate: '1.50',
      nested: [{ value: '1', blob: undefined }],
      plain: 'x',
      nothing: null,
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('toBigInt normalises SQL aggregates', () => {
    expect(toBigInt(5n)).toBe(5n);
    expect(toBigInt(null)).toBe(0n);
    expect(toBigInt(undefined)).toBe(0n);
    expect(toBigInt(42)).toBe(42n);
    expect(toBigInt('1234567890123456789')).toBe(1_234_567_890_123_456_789n);
    expect(toBigInt({ toFixed: () => '987654321098765432109' })).toBe(987_654_321_098_765_432_109n);
    expect(toBigInt('12.99')).toBe(12n);
  });
});
