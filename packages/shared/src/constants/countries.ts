import type { CurrencyCode } from './currencies.js';
import type { Locale } from './locales.js';

/** Economic/political grouping used for corridor planning and reporting. */
export type CountryRegion = 'CEMAC' | 'PALOP' | 'WEST_AFRICA' | 'EAST_AFRICA' | 'SOUTHERN_AFRICA';

/**
 * `LIVE` countries are served by Phase 1; `FUTURE` ones are modelled now so that
 * data captured today (phone numbers, currencies) is already valid when they launch.
 */
export type CountryAvailability = 'LIVE' | 'FUTURE';

export interface CountryInfo {
  /** ISO 3166-1 alpha-2. */
  readonly code: CountryCode;
  /** ISO 3166-1 alpha-3. */
  readonly alpha3: string;
  /** ISO 3166-1 numeric, zero-padded. */
  readonly numeric: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  /** E.164 country calling code without the leading `+`. */
  readonly callingCode: string;
  /**
   * Accepted lengths of the national significant number (digits after the calling code).
   * Coarse validation only; full numbering-plan validation belongs to a telecom provider.
   */
  readonly nationalNumberLengths: readonly number[];
  /** National trunk prefix users habitually dial locally (stripped during E.164 normalisation). */
  readonly trunkPrefix?: string;
  /** True when the national significant number itself legitimately starts with 0 (CG, GA). */
  readonly nationalNumberMayStartWithZero?: true;
  readonly region: CountryRegion;
  readonly availability: CountryAvailability;
  /** Supported platform locales in order of preference for this market. */
  readonly locales: readonly Locale[];
}

export const CEMAC_COUNTRY_CODES = ['CM', 'CF', 'TD', 'CG', 'GQ', 'GA'] as const;
export const PALOP_COUNTRY_CODES = ['AO', 'MZ', 'CV', 'GW', 'ST'] as const;
export const FUTURE_COUNTRY_CODES = ['NG', 'GH', 'KE', 'UG', 'TZ', 'RW', 'ZA'] as const;

export const LIVE_COUNTRY_CODES = [...CEMAC_COUNTRY_CODES, ...PALOP_COUNTRY_CODES] as const;
export const COUNTRY_CODES = [...LIVE_COUNTRY_CODES, ...FUTURE_COUNTRY_CODES] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];
export type LiveCountryCode = (typeof LIVE_COUNTRY_CODES)[number];

export const COUNTRIES: Readonly<Record<CountryCode, CountryInfo>> = {
  // --- CEMAC (XAF) -------------------------------------------------------------------------
  CM: {
    code: 'CM',
    alpha3: 'CMR',
    numeric: '120',
    name: 'Cameroon',
    currency: 'XAF',
    callingCode: '237',
    nationalNumberLengths: [9],
    region: 'CEMAC',
    availability: 'LIVE',
    locales: ['fr', 'en'],
  },
  CF: {
    code: 'CF',
    alpha3: 'CAF',
    numeric: '140',
    name: 'Central African Republic',
    currency: 'XAF',
    callingCode: '236',
    nationalNumberLengths: [8],
    region: 'CEMAC',
    availability: 'LIVE',
    locales: ['fr'],
  },
  TD: {
    code: 'TD',
    alpha3: 'TCD',
    numeric: '148',
    name: 'Chad',
    currency: 'XAF',
    callingCode: '235',
    nationalNumberLengths: [8],
    region: 'CEMAC',
    availability: 'LIVE',
    locales: ['fr'],
  },
  CG: {
    code: 'CG',
    alpha3: 'COG',
    numeric: '178',
    name: 'Republic of the Congo',
    currency: 'XAF',
    callingCode: '242',
    // Congolese mobile numbers keep their leading 0 inside the national number (e.g. +242 06 xxx xxxx).
    nationalNumberLengths: [9],
    nationalNumberMayStartWithZero: true,
    region: 'CEMAC',
    availability: 'LIVE',
    locales: ['fr'],
  },
  GQ: {
    code: 'GQ',
    alpha3: 'GNQ',
    numeric: '226',
    name: 'Equatorial Guinea',
    currency: 'XAF',
    callingCode: '240',
    nationalNumberLengths: [9],
    region: 'CEMAC',
    availability: 'LIVE',
    locales: ['fr', 'pt'],
  },
  GA: {
    code: 'GA',
    alpha3: 'GAB',
    numeric: '266',
    name: 'Gabon',
    currency: 'XAF',
    callingCode: '241',
    // Gabon's 2020 plan keeps the leading 0 inside the national number (e.g. +241 06 xx xx xx).
    nationalNumberLengths: [8],
    nationalNumberMayStartWithZero: true,
    region: 'CEMAC',
    availability: 'LIVE',
    locales: ['fr'],
  },
  // --- Lusophone Africa (PALOP) --------------------------------------------------------------
  AO: {
    code: 'AO',
    alpha3: 'AGO',
    numeric: '024',
    name: 'Angola',
    currency: 'AOA',
    callingCode: '244',
    nationalNumberLengths: [9],
    region: 'PALOP',
    availability: 'LIVE',
    locales: ['pt'],
  },
  MZ: {
    code: 'MZ',
    alpha3: 'MOZ',
    numeric: '508',
    name: 'Mozambique',
    currency: 'MZN',
    callingCode: '258',
    nationalNumberLengths: [9],
    region: 'PALOP',
    availability: 'LIVE',
    locales: ['pt'],
  },
  CV: {
    code: 'CV',
    alpha3: 'CPV',
    numeric: '132',
    name: 'Cabo Verde',
    currency: 'CVE',
    callingCode: '238',
    nationalNumberLengths: [7],
    region: 'PALOP',
    availability: 'LIVE',
    locales: ['pt'],
  },
  GW: {
    code: 'GW',
    alpha3: 'GNB',
    numeric: '624',
    name: 'Guinea-Bissau',
    currency: 'XOF',
    callingCode: '245',
    nationalNumberLengths: [7, 9],
    region: 'PALOP',
    availability: 'LIVE',
    locales: ['pt', 'fr'],
  },
  ST: {
    code: 'ST',
    alpha3: 'STP',
    numeric: '678',
    name: 'São Tomé and Príncipe',
    currency: 'STN',
    callingCode: '239',
    nationalNumberLengths: [7],
    region: 'PALOP',
    availability: 'LIVE',
    locales: ['pt'],
  },
  // --- Future corridors ------------------------------------------------------------------------
  NG: {
    code: 'NG',
    alpha3: 'NGA',
    numeric: '566',
    name: 'Nigeria',
    currency: 'NGN',
    callingCode: '234',
    nationalNumberLengths: [10],
    trunkPrefix: '0',
    region: 'WEST_AFRICA',
    availability: 'FUTURE',
    locales: ['en'],
  },
  GH: {
    code: 'GH',
    alpha3: 'GHA',
    numeric: '288',
    name: 'Ghana',
    currency: 'GHS',
    callingCode: '233',
    nationalNumberLengths: [9],
    trunkPrefix: '0',
    region: 'WEST_AFRICA',
    availability: 'FUTURE',
    locales: ['en'],
  },
  KE: {
    code: 'KE',
    alpha3: 'KEN',
    numeric: '404',
    name: 'Kenya',
    currency: 'KES',
    callingCode: '254',
    nationalNumberLengths: [9],
    trunkPrefix: '0',
    region: 'EAST_AFRICA',
    availability: 'FUTURE',
    locales: ['en'],
  },
  UG: {
    code: 'UG',
    alpha3: 'UGA',
    numeric: '800',
    name: 'Uganda',
    currency: 'UGX',
    callingCode: '256',
    nationalNumberLengths: [9],
    trunkPrefix: '0',
    region: 'EAST_AFRICA',
    availability: 'FUTURE',
    locales: ['en'],
  },
  TZ: {
    code: 'TZ',
    alpha3: 'TZA',
    numeric: '834',
    name: 'Tanzania',
    currency: 'TZS',
    callingCode: '255',
    nationalNumberLengths: [9],
    trunkPrefix: '0',
    region: 'EAST_AFRICA',
    availability: 'FUTURE',
    locales: ['en'],
  },
  RW: {
    code: 'RW',
    alpha3: 'RWA',
    numeric: '646',
    name: 'Rwanda',
    currency: 'RWF',
    callingCode: '250',
    nationalNumberLengths: [9],
    trunkPrefix: '0',
    region: 'EAST_AFRICA',
    availability: 'FUTURE',
    locales: ['en', 'fr'],
  },
  ZA: {
    code: 'ZA',
    alpha3: 'ZAF',
    numeric: '710',
    name: 'South Africa',
    currency: 'ZAR',
    callingCode: '27',
    nationalNumberLengths: [9],
    trunkPrefix: '0',
    region: 'SOUTHERN_AFRICA',
    availability: 'FUTURE',
    locales: ['en'],
  },
};

export function isCountryCode(value: string): value is CountryCode {
  return Object.prototype.hasOwnProperty.call(COUNTRIES, value);
}

export function isLiveCountryCode(value: string): value is LiveCountryCode {
  return isCountryCode(value) && COUNTRIES[value].availability === 'LIVE';
}

export function getCountry(code: CountryCode): CountryInfo {
  return COUNTRIES[code];
}

/** Countries sorted by calling-code length (longest first) so prefix matching is unambiguous. */
export const COUNTRIES_BY_CALLING_CODE_LENGTH: readonly CountryInfo[] = Object.values(
  COUNTRIES,
).sort(
  (a, b) =>
    b.callingCode.length - a.callingCode.length || a.callingCode.localeCompare(b.callingCode),
);
