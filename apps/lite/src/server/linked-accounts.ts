import { z } from 'zod';

import { writeAudit } from './audit';
import { getConnectorForProvider } from './connectors/registry';
import { db } from './db';
import { AppError } from './errors';
import { priceTransfer } from './fx';
import { type ActionContext, requireUserActor } from './rbac';
import { getWallet, ownsWallet } from './wallets';

/**
 * Linked mobile-money accounts (phase 4, customer side): the customer's OWN operator account,
 * validated through the provider's connector, then reused for cash-in (top-up) and cash-out.
 *
 * Storage: a linked account is a `beneficiaries` row of method MOBILE_MONEY whose `relationship`
 * is the reserved marker {@link OWN_ACCOUNT_RELATIONSHIP}. That keeps the schema unchanged and
 * lets the transfer engine pay it out like any other saved recipient (`kind: 'BENEFICIARY'`).
 * The beneficiaries screens hide these rows; this module is the only writer of the marker.
 *
 * The connector contract has no per-customer balance call, so Lite never shows (or invents) the
 * balance held at the operator — only the BI-Rem wallet balance, which comes from the ledger.
 */

export const OWN_ACCOUNT_RELATIONSHIP = 'SELF';

export const linkAccountSchema = z.object({
  providerId: z.uuid('Choose a mobile-money provider'),
  accountNumber: z
    .string()
    .trim()
    .min(8, 'Enter the full mobile-money number')
    .max(20, 'This number is too long'),
  nickname: z.string().trim().max(60).optional(),
});
export type LinkAccountInput = z.infer<typeof linkAccountSchema>;

export interface LinkedAccountView {
  readonly id: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly providerCode: string;
  /** True when the provider runs on the sandbox simulator (never a real operator). */
  readonly simulated: boolean;
  readonly providerActive: boolean;
  readonly supportsCollection: boolean;
  readonly supportsPayout: boolean;
  readonly accountNumber: string;
  /** Account holder name as returned by the operator's account validation. */
  readonly accountName: string;
  readonly nickname: string | null;
  readonly countryCode: string;
  readonly currency: string;
  readonly linkedAt: Date;
}

const INCLUDE = {
  provider: {
    select: {
      id: true,
      name: true,
      code: true,
      adapter: true,
      status: true,
      supportsCollection: true,
      supportsPayout: true,
    },
  },
} as const;

/** True for a beneficiary row that is one of the customer's own linked accounts. */
export function isLinkedAccount(beneficiary: {
  method: string;
  relationship: string | null;
}): boolean {
  return (
    beneficiary.method === 'MOBILE_MONEY' && beneficiary.relationship === OWN_ACCOUNT_RELATIONSHIP
  );
}

/** The signed-in customer's linked mobile-money accounts, oldest first. */
export async function listLinkedAccounts(ctx: ActionContext): Promise<LinkedAccountView[]> {
  const actor = requireUserActor(ctx);
  const rows = await db.beneficiary.findMany({
    where: {
      userId: actor.id,
      archivedAt: null,
      method: 'MOBILE_MONEY',
      relationship: OWN_ACCOUNT_RELATIONSHIP,
    },
    orderBy: { createdAt: 'asc' },
    include: INCLUDE,
  });
  return rows.flatMap((row) =>
    row.provider
      ? [
          {
            id: row.id,
            providerId: row.provider.id,
            providerName: row.provider.name,
            providerCode: row.provider.code,
            simulated: row.provider.adapter === 'simulator',
            providerActive: row.provider.status === 'ACTIVE',
            supportsCollection: row.provider.supportsCollection,
            supportsPayout: row.provider.supportsPayout,
            accountNumber: row.accountNumber,
            accountName: row.fullName,
            nickname: row.nickname,
            countryCode: row.countryCode,
            currency: row.currency,
            linkedAt: row.createdAt,
          },
        ]
      : [],
  );
}

/** One linked account of the signed-in customer; NOT_FOUND for anything else. */
export async function getLinkedAccount(ctx: ActionContext, id: string): Promise<LinkedAccountView> {
  const account = (await listLinkedAccounts(ctx)).find((candidate) => candidate.id === id);
  if (!account) throw new AppError('NOT_FOUND', 'Linked account not found');
  return account;
}

/**
 * Links the customer's own mobile-money account: the provider must be an active operator of the
 * customer's country of residence and the number must pass the connector's account validation.
 * The holder name returned by the operator is stored with the link.
 */
export async function linkMobileMoneyAccount(
  ctx: ActionContext,
  input: LinkAccountInput,
): Promise<LinkedAccountView> {
  const actor = requireUserActor(ctx);
  const data = linkAccountSchema.parse(input);

  const [user, provider] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { fullName: true, countryCode: true },
    }),
    db.provider.findUnique({
      where: { id: data.providerId },
      include: { country: { select: { enabled: true, name: true } } },
    }),
  ]);
  if (provider?.status !== 'ACTIVE' || !provider.country.enabled) {
    throw new AppError('VALIDATION', 'This provider is not available', {
      fieldErrors: { providerId: ['Choose an available provider'] },
    });
  }
  if (provider.countryCode !== user.countryCode) {
    throw new AppError(
      'VALIDATION',
      'You can only link a mobile-money account from your country of residence',
      { fieldErrors: { providerId: [`${provider.name} operates in ${provider.country.name}`] } },
    );
  }

  const accountNumber = data.accountNumber.replace(/[\s().-]/g, '');
  const { connector } = await getConnectorForProvider(provider.id);
  let validation;
  try {
    validation = await connector.validateAccount({ accountNumber, currency: provider.currency });
  } catch {
    throw new AppError(
      'PROVIDER_ERROR',
      `${provider.name} could not validate the account right now. Please try again later.`,
    );
  }
  if (!validation.valid) {
    throw new AppError('VALIDATION', validation.reason ?? 'The account could not be validated', {
      fieldErrors: { accountNumber: [validation.reason ?? 'Invalid account'] },
    });
  }

  const duplicate = await db.beneficiary.findFirst({
    where: {
      userId: actor.id,
      archivedAt: null,
      method: 'MOBILE_MONEY',
      accountNumber,
      providerId: provider.id,
    },
    select: { relationship: true },
  });
  if (duplicate) {
    throw new AppError(
      'CONFLICT',
      duplicate.relationship === OWN_ACCOUNT_RELATIONSHIP
        ? 'This mobile-money account is already linked'
        : 'This number is saved as one of your beneficiaries — remove it there first',
      { fieldErrors: { accountNumber: ['Already saved'] } },
    );
  }

  const created = await db.$transaction(async (tx) => {
    const row = await tx.beneficiary.create({
      data: {
        userId: actor.id,
        fullName: validation.accountName?.trim() || user.fullName,
        nickname: data.nickname ?? null,
        countryCode: provider.countryCode,
        currency: provider.currency,
        method: 'MOBILE_MONEY',
        accountNumber,
        providerId: provider.id,
        relationship: OWN_ACCOUNT_RELATIONSHIP,
      },
      select: { id: true },
    });
    await writeAudit(tx, ctx, {
      action: 'wallet.link',
      resourceType: 'linked_account',
      resourceId: row.id,
      after: {
        provider: provider.code,
        accountNumber,
        accountName: validation.accountName ?? null,
        simulated: connector.simulated,
      },
    });
    return row;
  });
  return getLinkedAccount(ctx, created.id);
}

/** Removes a link (soft delete — past transfers keep their reference to it). */
export async function unlinkAccount(ctx: ActionContext, id: string): Promise<void> {
  const actor = requireUserActor(ctx);
  await db.$transaction(async (tx) => {
    const result = await tx.beneficiary.updateMany({
      where: {
        id,
        userId: actor.id,
        archivedAt: null,
        method: 'MOBILE_MONEY',
        relationship: OWN_ACCOUNT_RELATIONSHIP,
      },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new AppError('NOT_FOUND', 'Linked account not found');
    await writeAudit(tx, ctx, {
      action: 'wallet.unlink',
      resourceType: 'linked_account',
      resourceId: id,
    });
  });
}

// ---------------------------------------------------------------------------
// Top-up preview (confirmation screen) — moves no money
// ---------------------------------------------------------------------------

export interface TopUpPreview {
  readonly walletId: string;
  readonly currency: string;
  readonly balance: bigint;
  readonly providerId: string;
  readonly providerName: string;
  readonly simulated: boolean;
  /** Normalised number the collection will be requested from. */
  readonly accountNumber: string;
  /** Holder name returned by the operator's account validation, when it gives one. */
  readonly accountName: string | null;
  readonly amount: bigint;
  readonly feeAmount: bigint;
  /** What reaches the wallet: `amount - feeAmount`. */
  readonly creditAmount: bigint;
}

/**
 * Everything the top-up confirmation screen shows: the wallet (must be the actor's own), the
 * operator's validation of the paying account and the fee at current rules. Nothing is stored
 * and nothing is collected — `topUpWallet` runs the same checks again when the customer confirms.
 */
export async function previewTopUp(
  ctx: ActionContext,
  input: { walletId: string; providerId: string; accountNumber: string; amount: bigint },
): Promise<TopUpPreview> {
  requireUserActor(ctx);
  const wallet = await getWallet(ctx, input.walletId);
  // `getWallet` also lets staff read wallets; a top-up is only ever for one's own wallet.
  if (!ownsWallet(ctx, wallet)) throw new AppError('NOT_FOUND', 'Wallet not found');
  if (wallet.status !== 'ACTIVE') throw new AppError('INVALID_STATE', 'This wallet is not active');
  if (input.amount <= 0n) {
    throw new AppError('VALIDATION', 'Amount must be greater than zero', {
      fieldErrors: { amount: ['Enter an amount greater than zero'] },
    });
  }

  const provider = await db.provider.findUnique({
    where: { id: input.providerId },
    include: { country: { select: { enabled: true } } },
  });
  if (provider?.status !== 'ACTIVE' || !provider.supportsCollection || !provider.country.enabled) {
    throw new AppError('UNSUPPORTED', 'This mobile-money provider is not available for top-ups', {
      fieldErrors: { providerId: ['Choose an available provider'] },
    });
  }
  if (provider.currency !== wallet.currency) {
    throw new AppError(
      'VALIDATION',
      `${provider.name} works in ${provider.currency}, this wallet is in ${wallet.currency}`,
      { fieldErrors: { providerId: [`Choose a ${wallet.currency} provider`] } },
    );
  }

  const accountNumber = input.accountNumber.replace(/[\s().-]/g, '');
  const { connector } = await getConnectorForProvider(provider.id);
  let validation;
  try {
    validation = await connector.validateAccount({ accountNumber, currency: provider.currency });
  } catch {
    throw new AppError(
      'PROVIDER_ERROR',
      `${provider.name} could not validate the account right now. Please try again later.`,
    );
  }
  if (!validation.valid) {
    throw new AppError('VALIDATION', validation.reason ?? 'The account could not be validated', {
      fieldErrors: { accountNumber: [validation.reason ?? 'Invalid account'] },
    });
  }

  const pricing = await priceTransfer(db, {
    type: 'TOPUP',
    deliveryMethod: 'MOBILE_MONEY',
    sourceCountry: provider.countryCode,
    targetCountry: provider.countryCode,
    sourceCurrency: wallet.currency,
    targetCurrency: wallet.currency,
    sendAmount: input.amount,
  });
  if (pricing.feeAmount >= input.amount) {
    throw new AppError('VALIDATION', 'Amount is too small', {
      fieldErrors: { amount: ['This amount does not cover the top-up fee'] },
    });
  }
  return {
    walletId: wallet.id,
    currency: wallet.currency,
    balance: wallet.balance,
    providerId: provider.id,
    providerName: provider.name,
    simulated: connector.simulated,
    accountNumber,
    accountName: validation.accountName?.trim() || null,
    amount: input.amount,
    feeAmount: pricing.feeAmount,
    creditAmount: input.amount - pricing.feeAmount,
  };
}
