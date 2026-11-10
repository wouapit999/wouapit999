import { z } from 'zod';

import type { RecipientInput } from '@/server/transfers';

/**
 * Pure logic of the guided "Send money" flow, shared by the server actions (validation) and the
 * client wizard (messages, countdown). No server imports besides types, so it is safe in Client
 * Components and trivially unit-testable.
 */

export const SEND_SCOPES = ['DOMESTIC', 'INTERNATIONAL'] as const;
export type SendScope = (typeof SEND_SCOPES)[number];

/** What the customer says they are paying. The engine still derives the real transfer type. */
export const RECIPIENT_TYPES = [
  'PERSON',
  'MERCHANT',
  'AGENT',
  'MOBILE_MONEY',
  'BENEFICIARY',
] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];

export const RECIPIENT_TYPE_LABELS: Readonly<Record<RecipientType, string>> = {
  PERSON: 'BI-Rem customer',
  MERCHANT: 'Merchant',
  AGENT: 'Agent',
  MOBILE_MONEY: 'Mobile-money number',
  BENEFICIARY: 'Saved beneficiary',
};

const PHONE_PATTERN = /^\+?[0-9][0-9\s().-]{6,18}[0-9]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MERCHANT_CODE = /^M-[A-Z0-9]{4,12}$/i;
const AGENT_CODE = /^A-[A-Z0-9]{4,12}$/i;

/**
 * Fields of step 1. They are re-sent, unchanged, with every later step: the server never trusts
 * a recipient it resolved earlier. Kept as a plain object so later steps can `.extend()` it;
 * apply {@link refineRecipient} to whatever schema is built from it.
 */
export const recipientFields = z.object({
  senderWalletId: z.uuid('Choose the wallet to send from'),
  scope: z.enum(SEND_SCOPES, 'Choose where the money is going'),
  targetCountry: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Choose the destination country')
    .optional(),
  recipientType: z.enum(RECIPIENT_TYPES, 'Choose who you are sending to'),
  identifier: z.string().trim().max(254).optional(),
  providerId: z.uuid('Choose a mobile-money provider').optional(),
  accountNumber: z.string().trim().max(20, 'This number is too long').optional(),
  recipientName: z.string().trim().max(120).optional(),
  beneficiaryId: z.uuid('Choose a beneficiary').optional(),
});
export type RecipientForm = z.infer<typeof recipientFields>;

/** Cross-field rules of step 1 (which fields each recipient type needs). */
export function refineRecipient(value: RecipientForm, ctx: z.RefinementCtx): void {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });

  if (value.scope === 'INTERNATIONAL') {
    if (value.recipientType === 'MERCHANT' || value.recipientType === 'AGENT') {
      issue('recipientType', 'Merchant and agent payments are domestic only');
    }
    if (value.recipientType !== 'BENEFICIARY' && !value.targetCountry) {
      issue('targetCountry', 'Choose the destination country');
    }
  }

  switch (value.recipientType) {
    case 'PERSON': {
      const identifier = value.identifier ?? '';
      if (identifier === '') issue('identifier', 'Enter a phone number or an e-mail address');
      else if (!PHONE_PATTERN.test(identifier) && !EMAIL_PATTERN.test(identifier)) {
        issue('identifier', 'Enter a phone number (+237…) or an e-mail address');
      }
      break;
    }
    case 'MERCHANT':
      if (!MERCHANT_CODE.test(value.identifier ?? '')) {
        issue('identifier', 'Merchant codes look like M-DEMO01');
      }
      break;
    case 'AGENT':
      if (!AGENT_CODE.test(value.identifier ?? '')) {
        issue('identifier', 'Agent codes look like A-DEMO01');
      }
      break;
    case 'MOBILE_MONEY':
      if (!value.providerId) issue('providerId', 'Choose a mobile-money provider');
      if ((value.accountNumber ?? '').replace(/\D/g, '').length < 8) {
        issue('accountNumber', 'Enter the full mobile-money number');
      }
      if ((value.recipientName ?? '').length < 2) {
        issue('recipientName', "Enter the recipient's name");
      }
      break;
    case 'BENEFICIARY':
      if (!value.beneficiaryId) issue('beneficiaryId', 'Choose a beneficiary');
      break;
  }
}

/** Step 1 on its own. */
export const recipientFormSchema = recipientFields.superRefine(refineRecipient);

/** Maps the validated step-1 form to the engine's recipient input. */
export function toRecipientInput(form: RecipientForm): RecipientInput {
  switch (form.recipientType) {
    case 'PERSON':
      return { kind: 'WALLET', identifier: form.identifier ?? '' };
    case 'MERCHANT':
    case 'AGENT':
      return { kind: 'WALLET', identifier: (form.identifier ?? '').toUpperCase() };
    case 'MOBILE_MONEY':
      return {
        kind: 'MOBILE_MONEY',
        providerId: form.providerId ?? '',
        accountNumber: form.accountNumber ?? '',
        name: form.recipientName ?? '',
      };
    case 'BENEFICIARY':
      return { kind: 'BENEFICIARY', beneficiaryId: form.beneficiaryId ?? '' };
  }
}

/** Everything the wizard keeps about the recipient (all strings: they come from inputs). */
export interface RecipientDraft {
  readonly senderWalletId: string;
  readonly scope: SendScope;
  readonly targetCountry: string;
  readonly recipientType: RecipientType;
  readonly identifier: string;
  readonly providerId: string;
  readonly accountNumber: string;
  readonly recipientName: string;
  readonly beneficiaryId: string;
}

/**
 * The fields actually posted for a draft: only those the chosen recipient type uses, so a value
 * typed for another type (or another scope) can never leak into the request.
 */
export function recipientPayload(draft: RecipientDraft): Record<string, string | undefined> {
  const base = {
    senderWalletId: draft.senderWalletId,
    scope: draft.scope,
    recipientType: draft.recipientType,
  };
  const targetCountry = draft.scope === 'INTERNATIONAL' ? draft.targetCountry : undefined;
  switch (draft.recipientType) {
    case 'PERSON':
      return { ...base, targetCountry, identifier: draft.identifier.trim() };
    case 'MERCHANT':
    case 'AGENT':
      return { ...base, identifier: draft.identifier.trim().toUpperCase() };
    case 'MOBILE_MONEY':
      return {
        ...base,
        targetCountry,
        providerId: draft.providerId,
        accountNumber: draft.accountNumber.trim(),
        recipientName: draft.recipientName.trim(),
      };
    case 'BENEFICIARY':
      return { ...base, beneficiaryId: draft.beneficiaryId };
  }
}

/** Recipient types offered for a scope (merchant and agent payments are domestic). */
export function recipientTypesFor(scope: SendScope, hasBeneficiaries: boolean): RecipientType[] {
  const types: RecipientType[] =
    scope === 'DOMESTIC'
      ? ['PERSON', 'MERCHANT', 'AGENT', 'MOBILE_MONEY']
      : ['PERSON', 'MOBILE_MONEY'];
  if (hasBeneficiaries) types.push('BENEFICIARY');
  return types;
}

/** The facts of a resolved plan that the customer's choices are checked against. */
export interface PlanFacts {
  readonly international: boolean;
  readonly recipientCountry: string;
  readonly recipientCountryName: string;
  readonly recipientWalletType: 'CUSTOMER' | 'MERCHANT' | 'AGENT' | 'PARTNER' | null;
}

export interface ChoiceMismatch {
  /** Form field the message belongs to. */
  readonly field: 'scope' | 'targetCountry' | 'identifier' | 'recipientType';
  readonly message: string;
}

/**
 * The engine classifies a transfer from the recipient it resolves, not from what the customer
 * clicked. This check makes sure both agree — so nobody confirms a "domestic payment" that is in
 * fact an international transfer, or pays a customer believing it is a merchant. Returns null
 * when the plan is what the customer asked for. A saved beneficiary is taken as it is.
 */
export function checkPlanMatchesChoice(
  form: Pick<RecipientForm, 'scope' | 'targetCountry' | 'recipientType'>,
  plan: PlanFacts,
): ChoiceMismatch | null {
  if (form.recipientType === 'MERCHANT' && plan.recipientWalletType !== 'MERCHANT') {
    return { field: 'identifier', message: 'This code does not belong to a merchant' };
  }
  if (form.recipientType === 'AGENT' && plan.recipientWalletType !== 'AGENT') {
    return { field: 'identifier', message: 'This code does not belong to an agent' };
  }
  if (form.recipientType === 'PERSON' && plan.recipientWalletType !== 'CUSTOMER') {
    return { field: 'identifier', message: 'This is not a personal BI-Rem account' };
  }
  if (form.recipientType === 'BENEFICIARY') return null;

  if (form.scope === 'DOMESTIC' && plan.international) {
    return {
      field: 'scope',
      message: `This recipient is in ${plan.recipientCountryName}. Choose "To another country" to send an international transfer.`,
    };
  }
  if (form.scope === 'INTERNATIONAL') {
    if (!plan.international) {
      return {
        field: 'scope',
        message: 'This recipient is in your own country. Choose "Within my country" instead.',
      };
    }
    if (form.targetCountry && form.targetCountry !== plan.recipientCountry) {
      return {
        field: 'targetCountry',
        message: `This recipient is registered in ${plan.recipientCountryName}. Choose that country as the destination.`,
      };
    }
  }
  return null;
}

/** `mm:ss` for a number of seconds (never negative). */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(Math.floor(totalSeconds), 0);
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

/** Whole seconds left until `expiresAt`, measured on the same clock as `now` (≥ 0). */
export function secondsUntil(expiresAt: Date | string, now: Date = new Date()): number {
  const target = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const milliseconds = target.getTime() - now.getTime();
  return Number.isFinite(milliseconds) ? Math.max(Math.floor(milliseconds / 1000), 0) : 0;
}

export type OutcomeTone = 'success' | 'info' | 'warning' | 'danger';

export interface TransferOutcome {
  readonly tone: OutcomeTone;
  readonly title: string;
  readonly body: string;
  /** True when the sender's money is back in (or never left) their wallet. */
  readonly fundsReturned: boolean;
}

/**
 * Plain-language explanation of where a transfer stands, from the point of view of the person
 * looking at it. Used right after sending and on the tracking page, so both always agree.
 */
export function describeOutcome(transfer: {
  status: string;
  type: string;
  deliveryMethod: string;
  failureReason?: string | null;
  perspective?: 'SENDER' | 'RECIPIENT' | 'STAFF';
}): TransferOutcome {
  const topUp = transfer.type === 'TOPUP';
  const received = transfer.perspective === 'RECIPIENT';
  const reason = transfer.failureReason?.trim();
  switch (transfer.status) {
    case 'COMPLETED':
      return {
        tone: 'success',
        title: topUp ? 'Top-up completed' : received ? 'Money received' : 'Transfer completed',
        body: topUp
          ? 'The amount has been credited to your wallet.'
          : received
            ? 'The money is in your wallet.'
            : transfer.deliveryMethod === 'MOBILE_MONEY'
              ? 'The mobile-money operator confirmed the payout to the recipient.'
              : "The money is in the recipient's BI-Rem wallet.",
        fundsReturned: false,
      };
    case 'PROCESSING':
      return {
        tone: 'info',
        title: topUp ? 'Top-up in progress' : 'Transfer in progress',
        body: topUp
          ? 'We are waiting for the mobile-money operator to confirm the collection. Nothing is credited until it does.'
          : 'Your money is reserved and we are waiting for the mobile-money operator to confirm the payout. You can check the status below.',
        fundsReturned: false,
      };
    case 'ON_HOLD':
      return {
        tone: 'warning',
        title: 'Transfer under review',
        body: 'This transfer was selected for a compliance check before it is paid out. The amount is reserved from your wallet in the meantime. You do not need to do anything: you will be notified when it is released, or refunded in full if it cannot be approved.',
        fundsReturned: false,
      };
    case 'FAILED':
      return {
        tone: 'danger',
        title: topUp ? 'Top-up failed' : 'Transfer failed',
        body: topUp
          ? `The operator did not collect the money${reason ? `: ${reason}` : ''}. Your wallet was not credited and nothing was charged.`
          : `The payout could not be completed${reason ? `: ${reason}` : ''}. The full amount, including the fee, is back in your wallet.`,
        fundsReturned: true,
      };
    case 'REJECTED':
      return {
        tone: 'danger',
        title: 'Transfer not approved',
        body: 'After review this transfer could not be approved. The full amount, including the fee, has been refunded to your wallet.',
        fundsReturned: true,
      };
    case 'REVERSED':
      return {
        tone: 'warning',
        title: 'Transfer reversed',
        body: received
          ? 'This payment was reversed and the amount was taken back from your wallet.'
          : 'This transfer was reversed and the full amount, including the fee, was returned to your wallet.',
        fundsReturned: !received,
      };
    default:
      return {
        tone: 'info',
        title: 'Transfer status',
        body: 'The status of this transfer is being updated.',
        fundsReturned: false,
      };
  }
}
