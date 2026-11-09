/**
 * ISO 4217 currencies handled by the platform. `exponent` is the number of minor-unit digits
 * (e.g. 2 for USD cents, 0 for XAF which has no subunit in circulation).
 *
 * Money is always stored and transported as BIGINT minor units + currency code; use
 * `@bi-rem/shared/utils` money helpers for conversions. Never floats.
 */
export interface CurrencyInfo {
  readonly code: CurrencyCode;
  readonly numeric: string;
  readonly exponent: 0 | 2;
  readonly name: string;
  readonly symbol: string;
}

export const CURRENCY_CODES = [
  'XAF',
  'AOA',
  'MZN',
  'CVE',
  'XOF',
  'STN',
  'NGN',
  'GHS',
  'KES',
  'UGX',
  'TZS',
  'RWF',
  'ZAR',
  'USD',
  'EUR',
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export const CURRENCIES: Readonly<Record<CurrencyCode, CurrencyInfo>> = {
  XAF: {
    code: 'XAF',
    numeric: '950',
    exponent: 0,
    name: 'Central African CFA franc',
    symbol: 'FCFA',
  },
  AOA: { code: 'AOA', numeric: '973', exponent: 2, name: 'Angolan kwanza', symbol: 'Kz' },
  MZN: { code: 'MZN', numeric: '943', exponent: 2, name: 'Mozambican metical', symbol: 'MT' },
  CVE: { code: 'CVE', numeric: '132', exponent: 2, name: 'Cape Verdean escudo', symbol: 'Esc' },
  XOF: { code: 'XOF', numeric: '952', exponent: 0, name: 'West African CFA franc', symbol: 'CFA' },
  STN: {
    code: 'STN',
    numeric: '930',
    exponent: 2,
    name: 'São Tomé and Príncipe dobra',
    symbol: 'Db',
  },
  NGN: { code: 'NGN', numeric: '566', exponent: 2, name: 'Nigerian naira', symbol: '₦' },
  GHS: { code: 'GHS', numeric: '936', exponent: 2, name: 'Ghanaian cedi', symbol: 'GH₵' },
  KES: { code: 'KES', numeric: '404', exponent: 2, name: 'Kenyan shilling', symbol: 'KSh' },
  UGX: { code: 'UGX', numeric: '800', exponent: 0, name: 'Ugandan shilling', symbol: 'USh' },
  TZS: { code: 'TZS', numeric: '834', exponent: 2, name: 'Tanzanian shilling', symbol: 'TSh' },
  RWF: { code: 'RWF', numeric: '646', exponent: 0, name: 'Rwandan franc', symbol: 'FRw' },
  ZAR: { code: 'ZAR', numeric: '710', exponent: 2, name: 'South African rand', symbol: 'R' },
  USD: { code: 'USD', numeric: '840', exponent: 2, name: 'United States dollar', symbol: '$' },
  EUR: { code: 'EUR', numeric: '978', exponent: 2, name: 'Euro', symbol: '€' },
};

/** Settlement / reference currencies used for FX quoting across corridors. */
export const SETTLEMENT_CURRENCIES = ['USD', 'EUR'] as const satisfies readonly CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function getCurrency(code: CurrencyCode): CurrencyInfo {
  return CURRENCIES[code];
}
