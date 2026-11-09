import {
  COUNTRIES,
  COUNTRIES_BY_CALLING_CODE_LENGTH,
  type CountryCode,
  type CountryInfo,
} from '../constants/countries.js';

/** Strict E.164: `+` followed by 2–15 digits, no leading zero. */
export const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

export interface NormalizedPhone {
  /** `+<calling code><national number>` */
  readonly e164: string;
  readonly countryCode: CountryCode;
  readonly callingCode: string;
  readonly nationalNumber: string;
}

export class PhoneNumberError extends Error {
  override readonly name = 'PhoneNumberError';

  constructor(
    message: string,
    readonly code:
      'EMPTY' | 'INVALID_CHARACTERS' | 'UNKNOWN_COUNTRY' | 'COUNTRY_REQUIRED' | 'INVALID_LENGTH',
  ) {
    super(message);
  }
}

export function isE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

/** Finds the supported country whose calling code prefixes `digits` (longest match wins). */
export function findCountryByCallingCode(digits: string): CountryInfo | undefined {
  return COUNTRIES_BY_CALLING_CODE_LENGTH.find((country) => digits.startsWith(country.callingCode));
}

/** Removes formatting characters commonly typed by users: spaces, dots, dashes, parentheses. */
function stripFormatting(input: string): string {
  return input.replace(/[\s().\-\u2010-\u2015\u00a0]/g, '');
}

function validateNationalNumber(country: CountryInfo, nationalNumber: string): NormalizedPhone {
  if (!country.nationalNumberLengths.includes(nationalNumber.length)) {
    throw new PhoneNumberError(
      `${country.name} numbers must have ${country.nationalNumberLengths.join(' or ')} digits after +${country.callingCode}; got ${nationalNumber.length}`,
      'INVALID_LENGTH',
    );
  }
  if (nationalNumber.startsWith('0') && !country.nationalNumberMayStartWithZero) {
    // After trunk-prefix stripping a national significant number never begins with 0, except in
    // the few plans that embed it (flagged per country).
    throw new PhoneNumberError(`${country.name} numbers cannot start with 0`, 'INVALID_LENGTH');
  }
  return {
    e164: `+${country.callingCode}${nationalNumber}`,
    countryCode: country.code,
    callingCode: country.callingCode,
    nationalNumber,
  };
}

/**
 * Normalises a user-entered phone number to E.164 for one of the supported countries.
 *
 * - International input (`+237 6 55 12 34 56`, `00237655123456`) is matched by calling code.
 * - National input (`0803 123 4567`) requires `defaultCountry`; a trunk prefix is stripped.
 *
 * This is deliberately dependency-free and only validates calling code + length. Carrier-level
 * validation (is the number allocated / mobile) is done by the SMS provider at send time.
 */
export function normalizePhone(input: string, defaultCountry?: CountryCode): NormalizedPhone {
  let digits = stripFormatting(input);
  if (digits.length === 0) {
    throw new PhoneNumberError('Phone number is empty', 'EMPTY');
  }

  if (digits.startsWith('00')) {
    digits = `+${digits.slice(2)}`;
  }

  const international = digits.startsWith('+');
  const body = international ? digits.slice(1) : digits;
  if (!/^\d+$/.test(body)) {
    throw new PhoneNumberError(`"${input}" contains invalid characters`, 'INVALID_CHARACTERS');
  }

  if (international) {
    const country = findCountryByCallingCode(body);
    if (!country) {
      throw new PhoneNumberError(
        `"${input}" does not belong to a supported country`,
        'UNKNOWN_COUNTRY',
      );
    }
    let national = body.slice(country.callingCode.length);
    // Some users type "+234 0803…", keeping the trunk prefix after the country code.
    if (country.trunkPrefix && national.startsWith(country.trunkPrefix)) {
      const withoutTrunk = national.slice(country.trunkPrefix.length);
      if (country.nationalNumberLengths.includes(withoutTrunk.length)) {
        national = withoutTrunk;
      }
    }
    return validateNationalNumber(country, national);
  }

  if (!defaultCountry) {
    throw new PhoneNumberError(
      `"${input}" has no country code; provide a default country or use +<code> format`,
      'COUNTRY_REQUIRED',
    );
  }

  const country = COUNTRIES[defaultCountry];
  let national = body;
  if (country.trunkPrefix && national.startsWith(country.trunkPrefix)) {
    national = national.slice(country.trunkPrefix.length);
  }
  // Users sometimes type the calling code without "+" (e.g. "237655123456").
  if (
    !country.nationalNumberLengths.includes(national.length) &&
    national.startsWith(country.callingCode) &&
    country.nationalNumberLengths.includes(national.length - country.callingCode.length)
  ) {
    national = national.slice(country.callingCode.length);
  }
  return validateNationalNumber(country, national);
}

/** Non-throwing variant of {@link normalizePhone}. */
export function tryNormalizePhone(
  input: string,
  defaultCountry?: CountryCode,
): NormalizedPhone | null {
  try {
    return normalizePhone(input, defaultCountry);
  } catch (error) {
    if (error instanceof PhoneNumberError) {
      return null;
    }
    throw error;
  }
}

/** Masks a phone number for logs and UI (`+237655123456` → `+237•••••3456`). */
export function maskPhone(e164: string, visibleDigits = 4): string {
  if (!isE164(e164)) {
    return '•'.repeat(Math.max(e164.length, 4));
  }
  const country = findCountryByCallingCode(e164.slice(1));
  const prefixLength = 1 + (country?.callingCode.length ?? 0);
  const prefix = e164.slice(0, prefixLength);
  const rest = e164.slice(prefixLength);
  const keep = Math.min(visibleDigits, Math.max(rest.length - 2, 0));
  return `${prefix}${'•'.repeat(rest.length - keep)}${rest.slice(rest.length - keep)}`;
}
