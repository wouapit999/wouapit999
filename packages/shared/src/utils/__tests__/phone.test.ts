import { describe, expect, it } from 'vitest';

import {
  PhoneNumberError,
  findCountryByCallingCode,
  isE164,
  maskPhone,
  normalizePhone,
  tryNormalizePhone,
} from '../phone.js';

describe('normalizePhone', () => {
  it('normalises international input for every live country', () => {
    const samples: Array<[string, string, string]> = [
      ['+237 6 55 12 34 56', '+237655123456', 'CM'],
      ['00237655123456', '+237655123456', 'CM'],
      ['+236 72 12 34 56', '+23672123456', 'CF'],
      ['+235 66 12 34 56', '+23566123456', 'TD'],
      ['+242 06 123 4567', '+242061234567', 'CG'],
      ['+240 222 123 456', '+240222123456', 'GQ'],
      ['+241 06 12 34 56', '+24106123456', 'GA'],
      ['+244 923 123 456', '+244923123456', 'AO'],
      ['+258 84 123 4567', '+258841234567', 'MZ'],
      ['+238 991 12 34', '+2389911234', 'CV'],
      ['+245 955 123 456', '+245955123456', 'GW'],
      ['+239 981 2345', '+2399812345', 'ST'],
    ];
    for (const [input, e164, countryCode] of samples) {
      const result = normalizePhone(input);
      expect(result.e164, input).toBe(e164);
      expect(result.countryCode, input).toBe(countryCode);
    }
  });

  it('strips the trunk prefix for national input and when typed after the country code', () => {
    expect(normalizePhone('0803 123 4567', 'NG').e164).toBe('+2348031234567');
    expect(normalizePhone('+234 0803 123 4567').e164).toBe('+2348031234567');
    expect(normalizePhone('(0)712 345 678', 'KE').e164).toBe('+254712345678');
    expect(normalizePhone('082 123 4567', 'ZA').e164).toBe('+27821234567');
  });

  it('accepts national input with a default country', () => {
    const result = normalizePhone('655-123-456', 'CM');
    expect(result).toEqual({
      e164: '+237655123456',
      countryCode: 'CM',
      callingCode: '237',
      nationalNumber: '655123456',
    });
  });

  it('accepts the calling code typed without a plus when the default country matches', () => {
    expect(normalizePhone('237655123456', 'CM').e164).toBe('+237655123456');
  });

  it('rejects wrong lengths', () => {
    expect(() => normalizePhone('+237 65512345')).toThrow(/9 digits/);
    expect(() => normalizePhone('+245 12345678')).toThrow(/7 or 9 digits/);
    expect(() => normalizePhone('12345', 'AO')).toThrowError(PhoneNumberError);
  });

  it('rejects national numbers that start with 0 unless the plan allows it', () => {
    expect(() => normalizePhone('+244 012345678')).toThrow(/cannot start with 0/);
    expect(normalizePhone('+242 061234567').nationalNumber).toBe('061234567');
  });

  it('requires a country for national input and rejects unknown calling codes', () => {
    expect(() => normalizePhone('655123456')).toThrow(/default country/);
    expect(() => normalizePhone('+1 555 123 4567')).toThrow(/supported country/);
    expect(() => normalizePhone('+33 6 12 34 56 78')).toThrowError(PhoneNumberError);
  });

  it('rejects empty and garbage input', () => {
    expect(() => normalizePhone('   ')).toThrow(/empty/);
    expect(() => normalizePhone('+237 65A123456')).toThrow(/invalid characters/);
    expect(() => normalizePhone('call me', 'CM')).toThrowError(PhoneNumberError);
  });

  it('exposes error codes for API mapping', () => {
    try {
      normalizePhone('+999 123456789');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PhoneNumberError);
      expect((error as PhoneNumberError).code).toBe('UNKNOWN_COUNTRY');
    }
  });
});

describe('tryNormalizePhone', () => {
  it('returns null instead of throwing', () => {
    expect(tryNormalizePhone('nope', 'CM')).toBeNull();
    expect(tryNormalizePhone('+237655123456')?.countryCode).toBe('CM');
  });
});

describe('helpers', () => {
  it('isE164 validates the strict format', () => {
    expect(isE164('+237655123456')).toBe(true);
    expect(isE164('237655123456')).toBe(false);
    expect(isE164('+0237655123456')).toBe(false);
    expect(isE164('+1234567890123456')).toBe(false);
  });

  it('findCountryByCallingCode prefers the longest match', () => {
    expect(findCountryByCallingCode('27821234567')?.code).toBe('ZA');
    expect(findCountryByCallingCode('237655123456')?.code).toBe('CM');
    expect(findCountryByCallingCode('1555')).toBeUndefined();
  });

  it('maskPhone hides all but the last digits', () => {
    expect(maskPhone('+237655123456')).toBe('+237•••••3456');
    expect(maskPhone('+237655123456', 2)).toBe('+237•••••••56');
    expect(maskPhone('garbage')).toBe('•••••••');
  });
});
