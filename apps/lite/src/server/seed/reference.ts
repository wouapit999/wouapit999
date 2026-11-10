import type { AmlAction, AmlRuleType, RiskLevel, TransferType } from '@/generated/prisma/enums';

import { serializeRuleParams } from '../aml/engine';
import { normalizeName } from '../aml/names';
import type { Db } from '../db';
import { ensureSystemAccounts, getSystemAccountId } from '../ledger';
import {
  CURRENCY_CODES,
  type CurrencyCode,
  RATE_SCALE,
  divRound,
  parseRate,
  rateToDecimalString,
} from '../money';

/**
 * Reference data — idempotent upserts, safe to run on every deploy. Values an administrator can
 * change in the back office (country `enabled`, provider settings, manual FX rates, AML rule
 * tuning, thresholds) are only written when the row is first created, never overwritten.
 */

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

interface CountrySeed {
  code: string;
  name: string;
  region: string;
  currency: CurrencyCode;
  dialCode: string;
  enabled: boolean;
  stage: 'core' | 'expansion';
  /** Illustrative demo ratings, not a regulatory assessment. */
  riskLevel: RiskLevel;
}

export const COUNTRIES: readonly CountrySeed[] = [
  {
    code: 'CM',
    name: 'Cameroon',
    region: 'CEMAC',
    currency: 'XAF',
    dialCode: '+237',
    enabled: true,
    stage: 'core',
    riskLevel: 'LOW',
  },
  {
    code: 'GA',
    name: 'Gabon',
    region: 'CEMAC',
    currency: 'XAF',
    dialCode: '+241',
    enabled: true,
    stage: 'core',
    riskLevel: 'LOW',
  },
  {
    code: 'TD',
    name: 'Chad',
    region: 'CEMAC',
    currency: 'XAF',
    dialCode: '+235',
    enabled: true,
    stage: 'core',
    riskLevel: 'MEDIUM',
  },
  {
    code: 'CG',
    name: 'Republic of the Congo',
    region: 'CEMAC',
    currency: 'XAF',
    dialCode: '+242',
    enabled: true,
    stage: 'core',
    riskLevel: 'LOW',
  },
  {
    code: 'CF',
    name: 'Central African Republic',
    region: 'CEMAC',
    currency: 'XAF',
    dialCode: '+236',
    enabled: true,
    stage: 'core',
    riskLevel: 'HIGH',
  },
  {
    code: 'GQ',
    name: 'Equatorial Guinea',
    region: 'CEMAC',
    currency: 'XAF',
    dialCode: '+240',
    enabled: true,
    stage: 'core',
    riskLevel: 'LOW',
  },
  {
    code: 'AO',
    name: 'Angola',
    region: 'Lusophone Africa',
    currency: 'AOA',
    dialCode: '+244',
    enabled: true,
    stage: 'core',
    riskLevel: 'LOW',
  },
  {
    code: 'MZ',
    name: 'Mozambique',
    region: 'Lusophone Africa',
    currency: 'MZN',
    dialCode: '+258',
    enabled: true,
    stage: 'core',
    riskLevel: 'LOW',
  },
  {
    code: 'CV',
    name: 'Cabo Verde',
    region: 'Lusophone Africa',
    currency: 'CVE',
    dialCode: '+238',
    enabled: true,
    stage: 'core',
    riskLevel: 'LOW',
  },
  {
    code: 'GW',
    name: 'Guinea-Bissau',
    region: 'Lusophone Africa',
    currency: 'XOF',
    dialCode: '+245',
    enabled: true,
    stage: 'core',
    riskLevel: 'MEDIUM',
  },
  {
    code: 'ST',
    name: 'São Tomé and Príncipe',
    region: 'Lusophone Africa',
    currency: 'STN',
    dialCode: '+239',
    enabled: true,
    stage: 'core',
    riskLevel: 'LOW',
  },
  {
    code: 'NG',
    name: 'Nigeria',
    region: 'West Africa',
    currency: 'NGN',
    dialCode: '+234',
    enabled: false,
    stage: 'expansion',
    riskLevel: 'MEDIUM',
  },
  {
    code: 'GH',
    name: 'Ghana',
    region: 'West Africa',
    currency: 'GHS',
    dialCode: '+233',
    enabled: false,
    stage: 'expansion',
    riskLevel: 'LOW',
  },
  {
    code: 'KE',
    name: 'Kenya',
    region: 'East Africa',
    currency: 'KES',
    dialCode: '+254',
    enabled: false,
    stage: 'expansion',
    riskLevel: 'LOW',
  },
  {
    code: 'UG',
    name: 'Uganda',
    region: 'East Africa',
    currency: 'UGX',
    dialCode: '+256',
    enabled: false,
    stage: 'expansion',
    riskLevel: 'LOW',
  },
  {
    code: 'TZ',
    name: 'Tanzania',
    region: 'East Africa',
    currency: 'TZS',
    dialCode: '+255',
    enabled: false,
    stage: 'expansion',
    riskLevel: 'LOW',
  },
  {
    code: 'RW',
    name: 'Rwanda',
    region: 'East Africa',
    currency: 'RWF',
    dialCode: '+250',
    enabled: false,
    stage: 'expansion',
    riskLevel: 'LOW',
  },
  {
    code: 'ZA',
    name: 'South Africa',
    region: 'Southern Africa',
    currency: 'ZAR',
    dialCode: '+27',
    enabled: false,
    stage: 'expansion',
    riskLevel: 'LOW',
  },
];

// ---------------------------------------------------------------------------
// Providers & rails
// ---------------------------------------------------------------------------

interface ProviderSeed {
  code: string;
  operator: string;
  countryCode: string;
  /** Providers of planned countries start INACTIVE. */
  active: boolean;
}

export const PROVIDERS: readonly ProviderSeed[] = [
  { code: 'mtn-momo-cm', operator: 'MTN MoMo', countryCode: 'CM', active: true },
  { code: 'orange-money-cm', operator: 'Orange Money', countryCode: 'CM', active: true },
  { code: 'airtel-money-ga', operator: 'Airtel Money', countryCode: 'GA', active: true },
  { code: 'moov-money-ga', operator: 'Moov Money', countryCode: 'GA', active: true },
  { code: 'airtel-money-td', operator: 'Airtel Money', countryCode: 'TD', active: true },
  { code: 'moov-money-td', operator: 'Moov Money', countryCode: 'TD', active: true },
  { code: 'mtn-momo-cg', operator: 'MTN MoMo', countryCode: 'CG', active: true },
  { code: 'airtel-money-cg', operator: 'Airtel Money', countryCode: 'CG', active: true },
  { code: 'orange-money-cf', operator: 'Orange Money', countryCode: 'CF', active: true },
  { code: 'orange-money-gq', operator: 'Orange Money', countryCode: 'GQ', active: true },
  { code: 'unitel-money-ao', operator: 'Unitel Money', countryCode: 'AO', active: true },
  { code: 'm-pesa-mz', operator: 'M-Pesa', countryCode: 'MZ', active: true },
  { code: 'e-mola-mz', operator: 'e-Mola', countryCode: 'MZ', active: true },
  { code: 'orange-money-gw', operator: 'Orange Money', countryCode: 'GW', active: true },
  { code: 'mtn-momo-gw', operator: 'MTN MoMo', countryCode: 'GW', active: true },
  // Planned (phase 13) — inactive until the country is enabled.
  { code: 'mtn-momo-ng', operator: 'MTN MoMo', countryCode: 'NG', active: false },
  { code: 'mtn-momo-gh', operator: 'MTN MoMo', countryCode: 'GH', active: false },
  { code: 'm-pesa-ke', operator: 'M-Pesa', countryCode: 'KE', active: false },
  { code: 'airtel-money-ke', operator: 'Airtel Money', countryCode: 'KE', active: false },
  { code: 'mtn-momo-ug', operator: 'MTN MoMo', countryCode: 'UG', active: false },
  { code: 'm-pesa-tz', operator: 'M-Pesa', countryCode: 'TZ', active: false },
  { code: 'mtn-momo-rw', operator: 'MTN MoMo', countryCode: 'RW', active: false },
  { code: 'mtn-momo-za', operator: 'MTN MoMo', countryCode: 'ZA', active: false },
];

export const RAILS: ReadonlyArray<{
  code: string;
  name: string;
  category: string;
  description: string;
}> = [
  {
    code: 'visa-direct',
    name: 'Visa Direct',
    category: 'Card push',
    description: 'Push-to-card payouts to Visa debit and prepaid cards.',
  },
  {
    code: 'mastercard-send',
    name: 'Mastercard Send',
    category: 'Card push',
    description: 'Push-to-card payouts to Mastercard cards.',
  },
  {
    code: 'terrapay',
    name: 'TerraPay',
    category: 'Aggregator',
    description: 'Cross-border wallet and bank payouts network.',
  },
  {
    code: 'onafriq',
    name: 'Onafriq',
    category: 'Aggregator',
    description: 'Pan-African mobile-money interoperability hub (formerly MFS Africa).',
  },
  {
    code: 'flutterwave',
    name: 'Flutterwave',
    category: 'Aggregator',
    description: 'Collections and payouts across African markets.',
  },
  {
    code: 'paystack',
    name: 'Paystack',
    category: 'Aggregator',
    description: 'Card and bank collections (Nigeria, Ghana, Kenya, South Africa).',
  },
  {
    code: 'iso-20022',
    name: 'ISO 20022',
    category: 'Messaging standard',
    description: 'pacs/pain/camt messages for bank and RTGS connectivity.',
  },
  {
    code: 'swift',
    name: 'SWIFT',
    category: 'Bank network',
    description: 'Correspondent-banking wires for treasury settlement.',
  },
  {
    code: 'sepa',
    name: 'SEPA',
    category: 'Bank network',
    description: 'Euro credit transfers (SCT / SCT Inst) for diaspora corridors.',
  },
];

// ---------------------------------------------------------------------------
// FX — plausible mid rates expressed per 1 EUR (XAF and XOF pegged at 655.957)
// ---------------------------------------------------------------------------

export const UNITS_PER_EUR: Readonly<Record<CurrencyCode, string>> = {
  EUR: '1',
  USD: '1.08',
  XAF: '655.957',
  XOF: '655.957',
  CVE: '110.265',
  STN: '24.5',
  AOA: '985',
  MZN: '69',
  NGN: '1674',
  GHS: '16.74',
  KES: '139.3',
  UGX: '3996',
  TZS: '2916',
  RWF: '1512',
  ZAR: '19.66',
};

const EUR_PEGGED: readonly CurrencyCode[] = ['XAF', 'XOF', 'CVE', 'STN', 'EUR'];

function marginFor(base: CurrencyCode, quote: CurrencyCode): number {
  const cfa = (code: CurrencyCode) => code === 'XAF' || code === 'XOF';
  if (cfa(base) && cfa(quote)) return 50;
  if (EUR_PEGGED.includes(base) && EUR_PEGGED.includes(quote)) return 100;
  if (base === 'USD' || quote === 'USD' || base === 'EUR' || quote === 'EUR') return 125;
  return 175;
}

/** Mid rate base→quote (scaled by 10^10) derived from the per-EUR table. */
export function seedMidRate(base: CurrencyCode, quote: CurrencyCode): bigint {
  return divRound(
    parseRate(UNITS_PER_EUR[quote]) * RATE_SCALE,
    parseRate(UNITS_PER_EUR[base]),
    'half_up',
  );
}

// ---------------------------------------------------------------------------
// Fees — amounts scale with a per-currency "unit" worth roughly 1 USD (minor units)
// ---------------------------------------------------------------------------

export const FEE_UNIT: Readonly<Record<CurrencyCode, bigint>> = {
  XAF: 600n,
  XOF: 600n,
  AOA: 90_000n,
  MZN: 6_400n,
  CVE: 10_000n,
  STN: 2_300n,
  NGN: 150_000n,
  GHS: 1_500n,
  KES: 13_000n,
  UGX: 3_700n,
  TZS: 260_000n,
  RWF: 1_400n,
  ZAR: 1_800n,
  USD: 100n,
  EUR: 100n,
};

interface FeeTemplate {
  type: TransferType;
  label: string;
  /** Fixed part in tenths of a unit. */
  fixedTenths: bigint;
  percentBps: number;
  minTenths: bigint | null;
  maxTenths: bigint | null;
}

const FEE_TEMPLATES: readonly FeeTemplate[] = [
  {
    type: 'W2W',
    label: 'Wallet to wallet',
    fixedTenths: 0n,
    percentBps: 50,
    minTenths: 1n,
    maxTenths: 50n,
  },
  {
    type: 'W2M',
    label: 'Merchant payment',
    fixedTenths: 0n,
    percentBps: 75,
    minTenths: null,
    maxTenths: 80n,
  },
  {
    type: 'W2A',
    label: 'Agent cash-out',
    fixedTenths: 0n,
    percentBps: 150,
    minTenths: 3n,
    maxTenths: 150n,
  },
  {
    type: 'INTERNATIONAL',
    label: 'International',
    fixedTenths: 10n,
    percentBps: 150,
    minTenths: null,
    maxTenths: 400n,
  },
  {
    type: 'TOPUP',
    label: 'Top-up',
    fixedTenths: 0n,
    percentBps: 0,
    minTenths: null,
    maxTenths: null,
  },
];

const tenths = (unit: bigint, value: bigint | null): bigint | null =>
  value === null ? null : (unit * value) / 10n;

// ---------------------------------------------------------------------------
// AML rules & demo screening list
// ---------------------------------------------------------------------------

interface AmlRuleSeed {
  code: string;
  name: string;
  description: string;
  type: AmlRuleType;
  params: Record<string, unknown>;
  severity: RiskLevel;
  score: number;
  action: AmlAction;
}

export const AML_RULES: readonly AmlRuleSeed[] = [
  {
    code: 'AML-001',
    name: 'Large transfer',
    description: 'Single transfer at or above USD 3,000 — held for review.',
    type: 'AMOUNT_THRESHOLD',
    params: { thresholdUsd: 300_000n },
    severity: 'HIGH',
    score: 60,
    action: 'HOLD',
  },
  {
    code: 'AML-002',
    name: 'Notable transfer',
    description: 'Single transfer at or above USD 700 — flagged for monitoring.',
    type: 'AMOUNT_THRESHOLD',
    params: { thresholdUsd: 70_000n },
    severity: 'LOW',
    score: 15,
    action: 'FLAG',
  },
  {
    code: 'AML-010',
    name: 'Velocity — count',
    description: 'More than 5 outgoing transfers within one hour.',
    type: 'VELOCITY_COUNT',
    params: { windowHours: 1, maxCount: 5 },
    severity: 'MEDIUM',
    score: 30,
    action: 'FLAG',
  },
  {
    code: 'AML-011',
    name: 'Velocity — value',
    description: 'More than USD 5,000 sent within 24 hours.',
    type: 'VELOCITY_VALUE',
    params: { windowHours: 24, maxValueUsd: 500_000n },
    severity: 'HIGH',
    score: 40,
    action: 'FLAG',
  },
  {
    code: 'AML-020',
    name: 'Structuring',
    description: 'Three or more transfers within 24 hours kept just under the USD 3,000 line.',
    type: 'STRUCTURING',
    params: { windowHours: 24, thresholdUsd: 300_000n, bandPercent: 80, minCount: 3 },
    severity: 'HIGH',
    score: 60,
    action: 'HOLD',
  },
  {
    code: 'AML-030',
    name: 'New account, high value',
    description: 'Account younger than 7 days sending USD 500 or more.',
    type: 'NEW_ACCOUNT_HIGH_VALUE',
    params: { accountAgeDays: 7, thresholdUsd: 50_000n },
    severity: 'MEDIUM',
    score: 30,
    action: 'FLAG',
  },
  {
    code: 'AML-040',
    name: 'High-risk corridor',
    description: 'USD 200 or more from or to a country rated high risk.',
    type: 'HIGH_RISK_CORRIDOR',
    params: { thresholdUsd: 20_000n },
    severity: 'MEDIUM',
    score: 35,
    action: 'FLAG',
  },
  {
    code: 'AML-050',
    name: 'Sanctions name match',
    description: 'Sender or recipient name matches the (demo) sanctions list — held.',
    type: 'SANCTIONS_MATCH',
    params: { listType: 'SANCTION' },
    severity: 'HIGH',
    score: 100,
    action: 'HOLD',
  },
  {
    code: 'AML-051',
    name: 'PEP name match',
    description: 'Sender or recipient name matches the (demo) PEP list — flagged.',
    type: 'SANCTIONS_MATCH',
    params: { listType: 'PEP' },
    severity: 'MEDIUM',
    score: 40,
    action: 'FLAG',
  },
];

/** Obviously fictional names. This is demo data, NOT a real sanctions or PEP list. */
export const DEMO_SCREENING_LIST: ReadonlyArray<{
  code: string;
  type: 'SANCTION' | 'PEP';
  name: string;
  aliases: string[];
  countryCode: string | null;
}> = [
  {
    code: 'demo-s-001',
    type: 'SANCTION',
    name: 'Viktor Demo Sanctionov',
    aliases: ['V. D. Sanctionov', 'Victor Demo Sanktionov'],
    countryCode: null,
  },
  {
    code: 'demo-s-002',
    type: 'SANCTION',
    name: 'Zed Example Blocklisted',
    aliases: ['Zed E. Blocklisted'],
    countryCode: null,
  },
  {
    code: 'demo-s-003',
    type: 'SANCTION',
    name: 'Ibrahim Testcase Al-Fictif',
    aliases: ['Ibrahim Al Fictif'],
    countryCode: 'TD',
  },
  {
    code: 'demo-s-004',
    type: 'SANCTION',
    name: 'Acme Shellfront Trading Demo Ltd',
    aliases: ['Acme Shellfront Demo'],
    countryCode: null,
  },
  {
    code: 'demo-p-001',
    type: 'PEP',
    name: 'Honorable Sample Ministro',
    aliases: ['Sample Ministro'],
    countryCode: 'AO',
  },
  {
    code: 'demo-p-002',
    type: 'PEP',
    name: 'Paula Exemplo Governadora',
    aliases: ['Paula E. Governadora'],
    countryCode: 'MZ',
  },
  {
    code: 'demo-p-003',
    type: 'PEP',
    name: 'Jean-Fictif Depute Demo',
    aliases: ['Jean Fictif Depute'],
    countryCode: 'CM',
  },
];

// ---------------------------------------------------------------------------

/** Upserts all reference data. Idempotent. */
export async function seedReferenceData(db: Db): Promise<void> {
  for (const country of COUNTRIES) {
    const { code, enabled, riskLevel, ...rest } = country;
    await db.country.upsert({
      where: { code },
      create: { code, enabled, riskLevel, ...rest },
      // `enabled` and `riskLevel` belong to the administrator after the first seed.
      update: rest,
    });
  }

  for (const rail of RAILS) {
    await db.rail.upsert({
      where: { code: rail.code },
      create: { ...rail, status: 'PLANNED' },
      update: { name: rail.name, category: rail.category, description: rail.description },
    });
  }

  const currencyOf = new Map(COUNTRIES.map((country) => [country.code, country.currency]));
  for (const provider of PROVIDERS) {
    const currency = currencyOf.get(provider.countryCode);
    if (!currency) continue;
    await db.provider.upsert({
      where: { code: provider.code },
      create: {
        code: provider.code,
        name: `${provider.operator} ${provider.countryCode}`,
        operator: provider.operator,
        countryCode: provider.countryCode,
        currency,
        adapter: 'simulator',
        environment: 'SANDBOX',
        status: provider.active ? 'ACTIVE' : 'INACTIVE',
        config: {},
      },
      // Connectivity settings are managed from the back office once the row exists.
      update: {},
    });
  }

  for (const currency of CURRENCY_CODES) {
    await ensureSystemAccounts(db, currency);
    const floatAccountId = await getSystemAccountId(db, 'SETTLEMENT', currency);
    await db.treasuryThreshold.upsert({
      where: { accountId: floatAccountId },
      create: {
        accountId: floatAccountId,
        lowBalance: FEE_UNIT[currency] * 5_000n,
        criticalBalance: FEE_UNIT[currency] * 1_000n,
      },
      update: {},
    });
  }

  for (const base of CURRENCY_CODES) {
    for (const quote of CURRENCY_CODES) {
      if (base === quote) continue;
      const where = { baseCurrency_quoteCurrency: { baseCurrency: base, quoteCurrency: quote } };
      const existing = await db.fxRate.findUnique({ where, select: { source: true } });
      const midRate = rateToDecimalString(seedMidRate(base, quote));
      if (!existing) {
        await db.fxRate.create({
          data: {
            baseCurrency: base,
            quoteCurrency: quote,
            midRate,
            marginBps: marginFor(base, quote),
            source: 'seed',
          },
        });
      } else if (existing.source === 'seed') {
        // Manual overrides are never touched; seeded rows follow the table above.
        await db.fxRate.update({ where, data: { midRate } });
      }
    }
  }

  for (const currency of CURRENCY_CODES) {
    const unit = FEE_UNIT[currency];
    for (const template of FEE_TEMPLATES) {
      const code = `seed-${template.type.toLowerCase()}-${currency.toLowerCase()}`;
      await db.feeRule.upsert({
        where: { code },
        create: {
          code,
          name: `${template.label} — ${currency}`,
          transferType: template.type,
          currency,
          fixedAmount: tenths(unit, template.fixedTenths) ?? 0n,
          percentBps: template.percentBps,
          minFee: tenths(unit, template.minTenths),
          maxFee: tenths(unit, template.maxTenths),
        },
        update: {},
      });
    }
  }

  for (const rule of AML_RULES) {
    await db.amlRule.upsert({
      where: { code: rule.code },
      create: { ...rule, params: serializeRuleParams(rule.params) },
      update: { name: rule.name, description: rule.description },
    });
  }

  for (const entry of DEMO_SCREENING_LIST) {
    const listName =
      entry.type === 'SANCTION' ? 'DEMO-SANCTIONS (fictional)' : 'DEMO-PEP (fictional)';
    await db.sanctionsEntry.upsert({
      where: { code: entry.code },
      create: {
        code: entry.code,
        listName,
        type: entry.type,
        name: entry.name,
        normalizedName: normalizeName(entry.name),
        aliases: entry.aliases,
        countryCode: entry.countryCode,
        notes: 'Fictional demo entry — not a real person or company.',
      },
      update: {
        name: entry.name,
        normalizedName: normalizeName(entry.name),
        aliases: entry.aliases,
        listName,
      },
    });
  }
}

/** Creates the initial administrator if no user has that e-mail. Never resets a password. */
export async function seedAdminUser(
  db: Db,
  input: { email: string; passwordHash: string },
): Promise<{ created: boolean }> {
  const existing = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) return { created: false };
  await db.user.create({
    data: {
      email: input.email,
      passwordHash: input.passwordHash,
      fullName: 'BI-Rem Administrator',
      role: 'ADMIN',
    },
  });
  return { created: true };
}
