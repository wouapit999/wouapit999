import { describe, expect, it } from 'vitest';

import {
  MoneyError,
  addMoney,
  allocate,
  applyBasisPoints,
  compareMoney,
  deserializeMoney,
  divideRounded,
  formatMoney,
  fromMinorUnits,
  money,
  roundDecimal,
  serializeMoney,
  subtractMoney,
  toMinorUnits,
} from '../money.js';

describe('toMinorUnits', () => {
  it('converts decimal strings using the currency exponent', () => {
    expect(toMinorUnits('1250.75', 'USD')).toBe(125075n);
    expect(toMinorUnits('1250.7', 'EUR')).toBe(125070n);
    expect(toMinorUnits('1250', 'NGN')).toBe(125000n);
    expect(toMinorUnits('15000', 'XAF')).toBe(15000n);
    expect(toMinorUnits('0.05', 'ZAR')).toBe(5n);
    expect(toMinorUnits('.5', 'USD')).toBe(50n);
    expect(toMinorUnits('-12.34', 'USD')).toBe(-1234n);
    expect(toMinorUnits(' +7 ', 'USD')).toBe(700n);
  });

  it('is exact far beyond Number.MAX_SAFE_INTEGER', () => {
    expect(toMinorUnits('123456789012345678901234.56', 'USD')).toBe(12345678901234567890123456n);
  });

  it('tolerates trailing zeros beyond the exponent but rejects real extra precision', () => {
    expect(toMinorUnits('10.500', 'USD')).toBe(1050n);
    expect(toMinorUnits('10.00', 'XAF')).toBe(10n);
    expect(() => toMinorUnits('10.5', 'XAF')).toThrowError(MoneyError);
    expect(() => toMinorUnits('10.555', 'USD')).toThrow(/at most 2 decimal/);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'abc', '1,000.00', '1e5', '--1', '1.2.3', 'NaN', 'Infinity']) {
      expect(() => toMinorUnits(bad, 'USD'), bad).toThrowError(MoneyError);
    }
  });
});

describe('fromMinorUnits', () => {
  it('renders fixed-point strings with exponent digits', () => {
    expect(fromMinorUnits(125075n, 'USD')).toBe('1250.75');
    expect(fromMinorUnits(5n, 'USD')).toBe('0.05');
    expect(fromMinorUnits(0n, 'EUR')).toBe('0.00');
    expect(fromMinorUnits(-1234n, 'USD')).toBe('-12.34');
    expect(fromMinorUnits(15000n, 'XAF')).toBe('15000');
    expect(fromMinorUnits(-7n, 'RWF')).toBe('-7');
  });

  it('accepts safe integers and digit strings', () => {
    expect(fromMinorUnits(199, 'USD')).toBe('1.99');
    expect(fromMinorUnits('199', 'USD')).toBe('1.99');
    expect(() => fromMinorUnits(1.5, 'USD')).toThrowError(MoneyError);
    expect(() => fromMinorUnits(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrowError(MoneyError);
    expect(() => fromMinorUnits('12.5', 'USD')).toThrowError(MoneyError);
  });

  it('round-trips with toMinorUnits', () => {
    for (const sample of ['0.01', '99.99', '1000000.00', '-0.10']) {
      expect(fromMinorUnits(toMinorUnits(sample, 'USD'), 'USD')).toBe(sample);
    }
  });
});

describe('Money arithmetic', () => {
  it('adds, subtracts and compares same-currency amounts', () => {
    const a = money('10.00', 'USD');
    const b = money('2.50', 'USD');
    expect(addMoney(a, b)).toEqual({ amount: 1250n, currency: 'USD' });
    expect(subtractMoney(a, b)).toEqual({ amount: 750n, currency: 'USD' });
    expect(compareMoney(a, b)).toBe(1);
    expect(compareMoney(b, a)).toBe(-1);
    expect(compareMoney(a, money('10', 'USD'))).toBe(0);
  });

  it('refuses mixed currencies', () => {
    expect(() => addMoney(money('1', 'USD'), money('1', 'EUR'))).toThrow(/Currency mismatch/);
  });

  it('serialises bigint as string for JSON', () => {
    const serialized = serializeMoney(money('1.23', 'USD'));
    expect(serialized).toEqual({ amount: '123', currency: 'USD' });
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
    expect(deserializeMoney(serialized)).toEqual({ amount: 123n, currency: 'USD' });
  });
});

describe('rounding helpers', () => {
  it('divideRounded honours each rounding mode', () => {
    expect(divideRounded(7n, 2n, 'HALF_UP')).toBe(4n);
    expect(divideRounded(7n, 2n, 'HALF_EVEN')).toBe(4n);
    expect(divideRounded(5n, 2n, 'HALF_EVEN')).toBe(2n);
    expect(divideRounded(7n, 2n, 'DOWN')).toBe(3n);
    expect(divideRounded(7n, 2n, 'UP')).toBe(4n);
    expect(divideRounded(-7n, 2n, 'HALF_UP')).toBe(-4n);
    expect(divideRounded(-7n, 2n, 'DOWN')).toBe(-3n);
    expect(() => divideRounded(1n, 0n, 'DOWN')).toThrowError(MoneyError);
  });

  it('applyBasisPoints computes fees without floats', () => {
    expect(applyBasisPoints(10_000n, 150n)).toBe(150n);
    expect(applyBasisPoints(333n, 150n)).toBe(5n); // 4.995 → 5
    expect(applyBasisPoints(333n, 150n, 'DOWN')).toBe(4n);
  });

  it('allocate preserves the total and distributes remainders by largest fraction', () => {
    expect(allocate(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocate(1000n, [70n, 30n])).toEqual([700n, 300n]);
    expect(allocate(5n, [1n, 1n, 1n, 1n])).toEqual([2n, 1n, 1n, 1n]);
    expect(allocate(-100n, [1n, 1n, 1n])).toEqual([-34n, -33n, -33n]);
    expect(() => allocate(1n, [])).toThrowError(MoneyError);
    expect(() => allocate(1n, [0n, 0n])).toThrowError(MoneyError);
    expect(() => allocate(1n, [-1n, 2n])).toThrowError(MoneyError);
  });

  it('roundDecimal rounds user input to the currency exponent', () => {
    expect(roundDecimal('10.555', 'USD')).toBe(1056n);
    expect(roundDecimal('10.554', 'USD')).toBe(1055n);
    expect(roundDecimal('10.5', 'XAF')).toBe(11n);
    expect(roundDecimal('10.5', 'XAF', 'HALF_EVEN')).toBe(10n);
    expect(roundDecimal('10.5', 'XAF', 'DOWN')).toBe(10n);
    expect(roundDecimal('-10.555', 'USD')).toBe(-1056n);
    expect(roundDecimal('7', 'USD')).toBe(700n);
  });
});

describe('formatMoney', () => {
  it('formats with Intl using the currency exponent', () => {
    expect(formatMoney(money('1250.75', 'USD'), 'en')).toBe('$1,250.75');
    expect(formatMoney({ amount: 15000n, currency: 'XAF' }, 'en')).toMatch(/^FCFA\s?15,000$/);
    expect(formatMoney({ amount: -5n, currency: 'EUR' }, 'en')).toBe('-€0.05');
  });

  it('keeps precision for amounts above Number.MAX_SAFE_INTEGER', () => {
    expect(formatMoney({ amount: 12345678901234567890123456n, currency: 'USD' }, 'en')).toBe(
      '$123,456,789,012,345,678,901,234.56',
    );
  });
});
