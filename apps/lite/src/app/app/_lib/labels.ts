import { humanize } from '@/lib/format';

/**
 * Customer-facing wording for enums. Pure and dependency-free so both Server and Client
 * Components can use it. Strings live here in one place, ready to be extracted for fr / pt.
 */

export const TRANSFER_TYPE_LABELS: Readonly<Record<string, string>> = {
  W2W: 'Wallet to wallet',
  W2M: 'Merchant payment',
  W2A: 'Agent cash-out',
  INTERNATIONAL: 'International transfer',
  TOPUP: 'Wallet top-up',
};

/**
 * What a transfer is, in the customer's words. A domestic payout to a mobile-money number is
 * typed W2W by the engine (same country and currency) — calling it "wallet to wallet" would be
 * wrong, so the delivery method refines the label.
 */
export function transferKindLabel(type: string, deliveryMethod?: string | null): string {
  if (deliveryMethod === 'MOBILE_MONEY' && type === 'W2W') return 'Mobile-money payout';
  if (deliveryMethod === 'MOBILE_MONEY' && type === 'INTERNATIONAL') {
    return 'International mobile-money payout';
  }
  return labelFor(TRANSFER_TYPE_LABELS, type);
}

export const TRANSFER_STATUS_LABELS: Readonly<Record<string, string>> = {
  PROCESSING: 'Processing',
  ON_HOLD: 'Under review',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  REJECTED: 'Not approved',
  REVERSED: 'Reversed',
};

export const PURPOSE_LABELS: Readonly<Record<string, string>> = {
  FAMILY_SUPPORT: 'Family support',
  EDUCATION: 'Education',
  MEDICAL: 'Medical',
  GOODS_AND_SERVICES: 'Goods and services',
  SALARY: 'Salary',
  RENT: 'Rent',
  SAVINGS: 'Savings',
  GIFT: 'Gift',
  BUSINESS: 'Business',
  OTHER: 'Other',
};

export const SOURCE_OF_FUNDS_LABELS: Readonly<Record<string, string>> = {
  SALARY: 'Salary',
  BUSINESS_INCOME: 'Business income',
  SAVINGS: 'Savings',
  FAMILY: 'Family',
  INVESTMENT: 'Investment',
  LOAN: 'Loan',
  OTHER: 'Other',
};

export const KYC_ID_TYPE_LABELS: Readonly<Record<string, string>> = {
  PASSPORT: 'Passport',
  NATIONAL_ID: 'National ID card',
  DRIVERS_LICENSE: "Driver's licence",
  VOTER_CARD: 'Voter card',
  RESIDENCE_PERMIT: 'Residence permit',
};

export const KYC_DOCUMENT_LABELS: Readonly<Record<string, string>> = {
  ID_FRONT: 'ID document — front',
  ID_BACK: 'ID document — back',
  SELFIE: 'Selfie',
  PROOF_OF_ADDRESS: 'Proof of address',
};

export const KYC_CASE_STATUS_LABELS: Readonly<Record<string, string>> = {
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RESUBMIT_REQUESTED: 'More information needed',
};

export const KYC_TIER_SHORT: Readonly<Record<string, string>> = {
  TIER_0: 'Tier 0',
  TIER_1: 'Tier 1',
  TIER_2: 'Tier 2',
};

export const KYC_VENDOR_LABELS: Readonly<Record<string, string>> = {
  veriff: 'Veriff',
  sumsub: 'Sumsub',
  smile_identity: 'Smile Identity',
};

export const JOURNAL_KIND_LABELS: Readonly<Record<string, string>> = {
  TRANSFER: 'Transfer',
  RESERVE: 'Funds reserved',
  RELEASE: 'Funds released',
  REFUND: 'Refund',
  REVERSAL: 'Reversal',
  TOPUP: 'Top-up',
  COMMISSION: 'Commission',
  SETTLEMENT: 'Settlement',
  ADJUSTMENT: 'Adjustment',
};

/** Label lookup with a readable fallback for values added later. */
export function labelFor(labels: Readonly<Record<string, string>>, value: string): string {
  return labels[value] ?? humanize(value);
}

/** `[{ value, label }]` for a `<Select>` from a list of enum values. */
export function optionsFor(
  values: readonly string[],
  labels: Readonly<Record<string, string>>,
): Array<{ value: string; label: string }> {
  return values.map((value) => ({ value, label: labelFor(labels, value) }));
}

/** Masks the middle of an account number for lists: `+237699000101` → `+237 ••• 0101`. */
export function maskAccount(account: string): string {
  const trimmed = account.trim();
  if (trimmed.includes('@')) {
    const [local = '', domain = ''] = trimmed.split('@');
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${'•'.repeat(Math.max(local.length - visible.length, 1))}@${domain}`;
  }
  if (trimmed.length <= 6) return trimmed;
  return `${trimmed.slice(0, 4)} ••• ${trimmed.slice(-4)}`;
}
