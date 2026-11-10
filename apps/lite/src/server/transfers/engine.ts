import { z } from 'zod';

import type {
  DeliveryMethod,
  KycTier,
  TransferChannel,
  TransferType,
} from '@/generated/prisma/enums';
import type { Transfer } from '@/generated/prisma/client';

import {
  type ScreeningResult,
  assessUserRisk,
  evaluateTransfer,
  recordScreening,
} from '../aml/engine';
import { writeAudit } from '../audit';
import { getConnectorForProvider } from '../connectors/registry';
import { ConnectorTimeoutError, type ConnectorTransferResult } from '../connectors/types';
import { randomCode } from '../crypto';
import { type Prisma, type Tx, db, withTransaction } from '../db';
import { AppError, isUniqueViolation } from '../errors';
import { type Pricing, consumeQuote, createQuote, priceTransfer } from '../fx';
import { type CashInOwner, assertCashInWithinLimits, assertWithinLimits } from '../kyc/limits';
import {
  type PostingLine,
  getSystemAccountIds,
  lockAccounts,
  postJournal,
  reverseJournal,
} from '../ledger';
import { MAX_AMOUNT_MINOR, bpsOf, formatMoney, rateToDecimalString } from '../money';
import { notify } from '../notifications';
import { type PartnerEventType, dispatchPartnerEvent } from '../partners/webhooks';
import {
  type ActionContext,
  actorPartnerId,
  actorUserId,
  assertPermission,
  hasPermission,
} from '../rbac';
import { findRecipientWallet, ownsWallet } from '../wallets';

/**
 * The transfer engine — quote → create → screen → execute / hold → complete / fail → reverse.
 *
 * Money movement rules (SPEC.md) and how they are met here:
 *  1. One database transaction per state change, with `SELECT … FOR UPDATE` on every ledger
 *     account involved, taken up-front in id order (`lockAccounts`).
 *  2. Every journal balances per currency; a cross-currency transfer posts two balanced legs
 *     through the per-currency FX position accounts.
 *  3. Wallets never go negative (checked under the lock, and by a database CHECK constraint).
 *  4. `(idempotencyScope, idempotencyKey)` is unique; a replay returns the original transfer.
 *  5. Fee, FX margin and partner commission post in the same transaction as the settlement.
 *  6. AML screening runs before any debit; a held transfer has its funds reserved in SUSPENSE
 *     and is later released (completed) or rejected (refunded) by compliance.
 *  7. Reversal is a new compensating journal; journals, entries and audit rows are append-only.
 *  8. Authorisation happens here: only the wallet owner can send from it.
 *
 * Wallet-to-wallet transfers settle inside the creating transaction. Mobile-money payouts are
 * two-phase by necessity: funds are reserved in SUSPENSE, the operator is called after commit,
 * and the outcome (immediate, polled or by webhook) settles or refunds in a second transaction.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const TRANSFER_PURPOSES = [
  'FAMILY_SUPPORT',
  'EDUCATION',
  'MEDICAL',
  'GOODS_AND_SERVICES',
  'SALARY',
  'RENT',
  'SAVINGS',
  'GIFT',
  'BUSINESS',
  'OTHER',
] as const;

export const SOURCES_OF_FUNDS = [
  'SALARY',
  'BUSINESS_INCOME',
  'SAVINGS',
  'FAMILY',
  'INVESTMENT',
  'LOAN',
  'OTHER',
] as const;

const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.:-]{8,100}$/, 'Idempotency key must be 8–100 URL-safe characters');

const recipientSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('WALLET'),
    /** Phone (+237…), e-mail or partner code (M-…, A-…, P-…) of a BI-Rem account. */
    identifier: z.string().trim().min(3).max(254),
  }),
  z.object({
    kind: z.literal('MOBILE_MONEY'),
    providerId: z.uuid(),
    accountNumber: z.string().trim().min(8).max(20),
    name: z.string().trim().min(2).max(120),
  }),
  z.object({ kind: z.literal('BENEFICIARY'), beneficiaryId: z.uuid() }),
]);
export type RecipientInput = z.infer<typeof recipientSchema>;

export const createTransferSchema = z.object({
  senderWalletId: z.uuid(),
  recipient: recipientSchema,
  /** Send amount in minor units of the sender wallet's currency. Optional with `quoteId`. */
  amount: z.bigint().positive().max(MAX_AMOUNT_MINOR, 'Amount is too large').optional(),
  /** A quote from `quoteTransfer` — locks the FX rate and fee shown to the customer. */
  quoteId: z.uuid().optional(),
  idempotencyKey: idempotencyKeySchema,
  purpose: z.enum(TRANSFER_PURPOSES).optional(),
  sourceOfFunds: z.enum(SOURCES_OF_FUNDS).optional(),
  note: z.string().trim().max(140).optional(),
});
export type CreateTransferInput = z.infer<typeof createTransferSchema>;

export interface EngineOptions {
  /** Clock override — demo seed (backdating) and tests only. */
  readonly now?: Date;
  readonly channel?: TransferChannel;
}

export interface TransferResult {
  readonly transfer: Transfer;
  /** True when `idempotencyKey` had already been used and the original transfer is returned. */
  readonly replayed: boolean;
}

// ---------------------------------------------------------------------------
// Planning (recipient resolution + classification) — no money moves here
// ---------------------------------------------------------------------------

interface SenderInfo {
  readonly walletId: string;
  readonly ledgerAccountId: string;
  readonly currency: string;
  readonly countryCode: string;
  readonly name: string;
  readonly userId: string | null;
  readonly partnerId: string | null;
  readonly partnerType: 'PARTNER' | 'MERCHANT' | 'AGENT' | null;
  readonly partnerCommissionBps: number;
  readonly kycTier: KycTier | null;
  readonly createdAt: Date | null;
  readonly scope: string;
}

interface RecipientInfo {
  readonly deliveryMethod: DeliveryMethod;
  readonly name: string;
  readonly account: string;
  readonly countryCode: string;
  readonly currency: string;
  readonly walletId: string | null;
  readonly ledgerAccountId: string | null;
  readonly walletType: 'CUSTOMER' | 'MERCHANT' | 'AGENT' | 'PARTNER' | null;
  readonly userId: string | null;
  readonly partnerId: string | null;
  readonly providerId: string | null;
  readonly beneficiaryId: string | null;
}

export interface TransferPlan {
  readonly type: TransferType;
  readonly international: boolean;
  readonly sender: SenderInfo;
  readonly recipient: RecipientInfo;
}

async function loadSender(ctx: ActionContext, walletId: string): Promise<SenderInfo> {
  const wallet = await db.wallet.findUnique({
    where: { id: walletId },
    include: { user: true, partner: true },
  });
  // Rule 8: a wallet the actor does not own is indistinguishable from a missing one.
  if (!wallet || !ownsWallet(ctx, wallet)) throw new AppError('NOT_FOUND', 'Wallet not found');
  if (wallet.status !== 'ACTIVE') throw new AppError('INVALID_STATE', 'This wallet is not active');
  if (wallet.partner) {
    if (wallet.partner.status !== 'ACTIVE') {
      throw new AppError('FORBIDDEN', 'This partner account is not active');
    }
    return {
      walletId: wallet.id,
      ledgerAccountId: wallet.ledgerAccountId,
      currency: wallet.currency,
      countryCode: wallet.partner.countryCode,
      name: wallet.partner.name,
      userId: null,
      partnerId: wallet.partner.id,
      partnerType: wallet.partner.type,
      partnerCommissionBps: wallet.partner.commissionBps,
      kycTier: null,
      createdAt: null,
      scope: `partner:${wallet.partner.id}`,
    };
  }
  if (!wallet.user) throw new AppError('NOT_FOUND', 'Wallet not found');
  if (wallet.user.status !== 'ACTIVE')
    throw new AppError('FORBIDDEN', 'This account is not active');
  if (!wallet.user.countryCode) throw new AppError('INVALID_STATE', 'Complete your profile first');
  return {
    walletId: wallet.id,
    ledgerAccountId: wallet.ledgerAccountId,
    currency: wallet.currency,
    countryCode: wallet.user.countryCode,
    name: wallet.user.fullName,
    userId: wallet.user.id,
    partnerId: null,
    partnerType: null,
    partnerCommissionBps: 0,
    kycTier: wallet.user.kycTier,
    createdAt: wallet.user.createdAt,
    scope: `user:${wallet.user.id}`,
  };
}

async function resolveRecipient(
  ctx: ActionContext,
  sender: SenderInfo,
  input: RecipientInput,
): Promise<RecipientInfo> {
  let recipient = input;
  let beneficiaryId: string | null = null;

  if (recipient.kind === 'BENEFICIARY') {
    const beneficiary = await db.beneficiary.findUnique({ where: { id: recipient.beneficiaryId } });
    const owned = beneficiary && sender.userId !== null && beneficiary.userId === sender.userId;
    if (!beneficiary || !owned || beneficiary.archivedAt) {
      throw new AppError('NOT_FOUND', 'Beneficiary not found');
    }
    beneficiaryId = beneficiary.id;
    if (beneficiary.method === 'MOBILE_MONEY') {
      if (!beneficiary.providerId)
        throw new AppError('INVALID_STATE', 'Beneficiary has no provider');
      recipient = {
        kind: 'MOBILE_MONEY',
        providerId: beneficiary.providerId,
        accountNumber: beneficiary.accountNumber,
        name: beneficiary.fullName,
      };
    } else {
      recipient = { kind: 'WALLET', identifier: beneficiary.accountNumber };
    }
  }

  if (recipient.kind === 'WALLET') {
    const found = await findRecipientWallet(db, recipient.identifier);
    if (!found) {
      throw new AppError('NOT_FOUND', 'No BI-Rem account matches this phone, e-mail or code', {
        fieldErrors: { recipient: ['No BI-Rem account found'] },
      });
    }
    if (found.walletId === sender.walletId) {
      throw new AppError('VALIDATION', 'You cannot send money to the same wallet', {
        fieldErrors: { recipient: ['Choose a different recipient'] },
      });
    }
    return {
      deliveryMethod: 'WALLET',
      name: found.displayName,
      account: found.account,
      countryCode: found.countryCode,
      currency: found.currency,
      walletId: found.walletId,
      ledgerAccountId: found.ledgerAccountId,
      walletType: found.type,
      userId: found.userId,
      partnerId: found.partnerId,
      providerId: null,
      beneficiaryId,
    };
  }

  // MOBILE_MONEY
  const provider = await db.provider.findUnique({ where: { id: recipient.providerId } });
  if (provider?.status !== 'ACTIVE' || !provider.supportsPayout) {
    throw new AppError('UNSUPPORTED', 'This mobile-money provider is not available for payouts');
  }
  const accountNumber = recipient.accountNumber.replace(/[\s().-]/g, '');
  const { connector } = await getConnectorForProvider(provider.id);
  let validation;
  try {
    validation = await connector.validateAccount({ accountNumber, currency: provider.currency });
  } catch {
    throw new AppError(
      'PROVIDER_ERROR',
      `${provider.name} could not validate the account right now`,
    );
  }
  if (!validation.valid) {
    throw new AppError('VALIDATION', validation.reason ?? 'The account could not be validated', {
      fieldErrors: { accountNumber: [validation.reason ?? 'Invalid account'] },
    });
  }
  return {
    deliveryMethod: 'MOBILE_MONEY',
    name: recipient.name,
    account: accountNumber,
    countryCode: provider.countryCode,
    currency: provider.currency,
    walletId: null,
    ledgerAccountId: null,
    walletType: null,
    userId: null,
    partnerId: null,
    providerId: provider.id,
    beneficiaryId,
  };
}

/**
 * Resolves sender and recipient and classifies the transfer (W2W / W2M / W2A / INTERNATIONAL).
 * Checks ownership of the sender wallet and that both countries are enabled. Moves no money.
 */
export async function planTransfer(
  ctx: ActionContext,
  input: { senderWalletId: string; recipient: RecipientInput },
): Promise<TransferPlan> {
  const sender = await loadSender(ctx, input.senderWalletId);
  const recipient = await resolveRecipient(ctx, sender, recipientSchema.parse(input.recipient));
  const countries = await db.country.findMany({
    where: { code: { in: [sender.countryCode, recipient.countryCode] } },
    select: { code: true, enabled: true, name: true },
  });
  for (const code of [sender.countryCode, recipient.countryCode]) {
    const country = countries.find((candidate) => candidate.code === code);
    if (!country?.enabled) {
      throw new AppError(
        'UNSUPPORTED',
        `Transfers ${code === sender.countryCode ? 'from' : 'to'} ${country?.name ?? code} are not available yet`,
      );
    }
  }
  const international =
    sender.countryCode !== recipient.countryCode || sender.currency !== recipient.currency;
  const type: TransferType = international
    ? 'INTERNATIONAL'
    : recipient.walletType === 'MERCHANT'
      ? 'W2M'
      : recipient.walletType === 'AGENT'
        ? 'W2A'
        : 'W2W';
  return { type, international, sender, recipient };
}

const pricingInputFor = (plan: TransferPlan, sendAmount: bigint) => ({
  type: plan.type,
  deliveryMethod: plan.recipient.deliveryMethod,
  sourceCountry: plan.sender.countryCode,
  targetCountry: plan.recipient.countryCode,
  sourceCurrency: plan.sender.currency,
  targetCurrency: plan.recipient.currency,
  sendAmount,
});

export interface TransferPreview {
  readonly plan: TransferPlan;
  readonly pricing: Pricing;
  /** Set by `quoteTransfer`: the stored quote locking this price. */
  readonly quoteId: string | null;
  readonly expiresAt: Date | null;
}

/** Recipient + price at current rates, nothing stored (confirmation screens, API estimates). */
export async function previewTransfer(
  ctx: ActionContext,
  input: { senderWalletId: string; recipient: RecipientInput; amount: bigint },
): Promise<TransferPreview> {
  const plan = await planTransfer(ctx, input);
  const pricing = await priceTransfer(db, pricingInputFor(plan, input.amount));
  return { plan, pricing, quoteId: null, expiresAt: null };
}

/**
 * Like {@link previewTransfer} but stores a quote that locks fee and FX rate for 15 minutes
 * (`fx.quoteTtlMinutes`). Pass the returned `quoteId` to {@link createTransfer}.
 */
export async function quoteTransfer(
  ctx: ActionContext,
  input: { senderWalletId: string; recipient: RecipientInput; amount: bigint },
  options: EngineOptions = {},
): Promise<TransferPreview> {
  const plan = await planTransfer(ctx, input);
  const quote = await createQuote(ctx, pricingInputFor(plan, input.amount), { now: options.now });
  const pricing = await priceTransfer(db, pricingInputFor(plan, input.amount));
  return { plan, pricing, quoteId: quote.id, expiresAt: quote.expiresAt };
}

// ---------------------------------------------------------------------------
// Ledger helpers
// ---------------------------------------------------------------------------

interface TransferAccounts {
  readonly sender: string | null;
  readonly suspense: string;
  readonly feeRevenue: string;
  readonly fxRevenue: string;
  readonly fxPositionSource: string;
  readonly fxPositionTarget: string;
  /** Recipient wallet account, or the target-currency settlement account for payouts. */
  readonly destination: string;
  readonly commissionExpense: string;
  readonly commissionPayable: string;
}

type MoneyShape = Pick<
  Transfer,
  | 'sourceCurrency'
  | 'targetCurrency'
  | 'sendAmount'
  | 'feeAmount'
  | 'fxMarginAmount'
  | 'totalDebit'
  | 'receiveAmount'
>;

async function resolveAccounts(
  tx: Tx,
  shape: { sourceCurrency: string; targetCurrency: string },
  senderAccountId: string | null,
  recipientAccountId: string | null,
): Promise<TransferAccounts> {
  const source = await getSystemAccountIds(tx, shape.sourceCurrency, [
    'SUSPENSE',
    'FEE_REVENUE',
    'FX_REVENUE',
    'FX_POSITION',
    'COMMISSION_EXPENSE',
    'COMMISSION_PAYABLE',
  ]);
  const target = await getSystemAccountIds(tx, shape.targetCurrency, ['FX_POSITION', 'SETTLEMENT']);
  return {
    sender: senderAccountId,
    suspense: source.SUSPENSE,
    feeRevenue: source.FEE_REVENUE,
    fxRevenue: source.FX_REVENUE,
    fxPositionSource: source.FX_POSITION,
    fxPositionTarget: target.FX_POSITION,
    destination: recipientAccountId ?? target.SETTLEMENT,
    commissionExpense: source.COMMISSION_EXPENSE,
    commissionPayable: source.COMMISSION_PAYABLE,
  };
}

const allAccountIds = (accounts: TransferAccounts): string[] =>
  Object.values(accounts).filter((id): id is string => typeof id === 'string');

/**
 * Entries that settle a transfer out of `fundsAccountId` (the sender's wallet, or SUSPENSE when
 * the funds were reserved first). Balanced per currency by construction:
 *   source: DR funds (send + fee) = CR fee + CR fx margin + CR fx position (send − margin)
 *   target: DR fx position (receive) = CR destination (receive)
 */
export function settlementLines(
  shape: MoneyShape,
  fundsAccountId: string,
  accounts: TransferAccounts,
): PostingLine[] {
  const lines: PostingLine[] = [
    { accountId: fundsAccountId, direction: 'DEBIT', amount: shape.totalDebit },
  ];
  if (shape.feeAmount > 0n) {
    lines.push({ accountId: accounts.feeRevenue, direction: 'CREDIT', amount: shape.feeAmount });
  }
  if (shape.sourceCurrency === shape.targetCurrency) {
    lines.push({ accountId: accounts.destination, direction: 'CREDIT', amount: shape.sendAmount });
    return lines;
  }
  if (shape.fxMarginAmount > 0n) {
    lines.push({
      accountId: accounts.fxRevenue,
      direction: 'CREDIT',
      amount: shape.fxMarginAmount,
    });
  }
  const converted = shape.sendAmount - shape.fxMarginAmount;
  if (converted > 0n) {
    lines.push({ accountId: accounts.fxPositionSource, direction: 'CREDIT', amount: converted });
  }
  lines.push({
    accountId: accounts.fxPositionTarget,
    direction: 'DEBIT',
    amount: shape.receiveAmount,
  });
  lines.push({ accountId: accounts.destination, direction: 'CREDIT', amount: shape.receiveAmount });
  return lines;
}

async function addEvent(
  tx: Tx,
  transferId: string,
  type: string,
  message: string,
  options: { data?: Prisma.InputJsonValue; actorId?: string | null; at?: Date } = {},
): Promise<void> {
  await tx.transferEvent.create({
    data: {
      transferId,
      type,
      message,
      data: options.data,
      actorId: options.actorId ?? null,
      ...(options.at ? { createdAt: options.at } : {}),
    },
  });
}

const newReference = (): string => `BR${randomCode(10)}`;

async function lockTransfer(tx: Tx, transferId: string): Promise<Transfer> {
  await tx.$queryRaw`SELECT id FROM transfers WHERE id = ${transferId}::uuid FOR UPDATE`;
  const transfer = await tx.transfer.findUnique({ where: { id: transferId } });
  if (!transfer) throw new AppError('NOT_FOUND', 'Transfer not found');
  return transfer;
}

async function accountsForTransfer(tx: Tx, transfer: Transfer): Promise<TransferAccounts> {
  const wallets = await tx.wallet.findMany({
    where: {
      id: {
        in: [transfer.senderWalletId, transfer.recipientWalletId].filter(
          (id): id is string => id !== null,
        ),
      },
    },
    select: { id: true, ledgerAccountId: true },
  });
  const accountOf = (walletId: string | null): string | null =>
    wallets.find((wallet) => wallet.id === walletId)?.ledgerAccountId ?? null;
  return resolveAccounts(
    tx,
    transfer,
    accountOf(transfer.senderWalletId),
    accountOf(transfer.recipientWalletId),
  );
}

/** Settles a transfer out of `fundsAccountId`, accrues commission and marks it COMPLETED. */
async function completeTransfer(
  tx: Tx,
  transfer: Transfer,
  accounts: TransferAccounts,
  fundsAccountId: string,
  options: { now: Date; actorId: string | null; journalKind: 'TRANSFER' | 'RELEASE' },
): Promise<Transfer> {
  const { now } = options;
  await postJournal(tx, {
    kind: options.journalKind,
    description: `Transfer ${transfer.reference}`,
    transferId: transfer.id,
    createdById: options.actorId,
    postedAt: now,
    lines: settlementLines(transfer, fundsAccountId, accounts),
  });

  if (transfer.partnerId && transfer.commissionAmount > 0n) {
    const partner = await tx.partner.findUniqueOrThrow({
      where: { id: transfer.partnerId },
      select: { commissionBps: true },
    });
    const journal = await postJournal(tx, {
      kind: 'COMMISSION',
      description: `Commission on ${transfer.reference}`,
      transferId: transfer.id,
      createdById: options.actorId,
      postedAt: now,
      lines: [
        {
          accountId: accounts.commissionExpense,
          direction: 'DEBIT',
          amount: transfer.commissionAmount,
        },
        {
          accountId: accounts.commissionPayable,
          direction: 'CREDIT',
          amount: transfer.commissionAmount,
        },
      ],
    });
    await tx.commission.create({
      data: {
        partnerId: transfer.partnerId,
        transferId: transfer.id,
        currency: transfer.sourceCurrency,
        amount: transfer.commissionAmount,
        bps: partner.commissionBps,
        journalId: journal.journalId,
        createdAt: now,
      },
    });
  }

  const completed = await tx.transfer.update({
    where: { id: transfer.id },
    data: {
      status: 'COMPLETED',
      completedAt: now,
      failureCode: null,
      failureReason: null,
      updatedAt: now,
    },
  });
  await addEvent(tx, transfer.id, 'COMPLETED', 'Transfer completed', {
    actorId: options.actorId,
    at: now,
  });

  if (transfer.senderUserId) {
    await notify(tx, {
      userId: transfer.senderUserId,
      type: 'transfer.completed',
      title: 'Transfer completed',
      body: `${formatMoney(transfer.sendAmount, transfer.sourceCurrency)} sent to ${transfer.recipientName}.`,
      href: `/app/transfers/${transfer.id}`,
      at: now,
    });
  }
  if (transfer.recipientUserId && transfer.recipientUserId !== transfer.senderUserId) {
    await notify(tx, {
      userId: transfer.recipientUserId,
      type: 'transfer.received',
      title: 'Money received',
      body: `${formatMoney(transfer.receiveAmount, transfer.targetCurrency)} received from ${transfer.senderName}.`,
      href: `/app/transfers/${transfer.id}`,
      at: now,
    });
  }
  return completed;
}

/** Returns reserved funds from SUSPENSE to the sender and marks the transfer FAILED / REJECTED. */
async function refundTransfer(
  tx: Tx,
  transfer: Transfer,
  accounts: TransferAccounts,
  options: {
    now: Date;
    actorId: string | null;
    status: 'FAILED' | 'REJECTED';
    failureCode: string;
    failureReason: string;
  },
): Promise<Transfer> {
  if (!accounts.sender) throw new AppError('INTERNAL', 'Transfer has no sender wallet to refund');
  await postJournal(tx, {
    kind: 'REFUND',
    description: `Refund of ${transfer.reference}`,
    transferId: transfer.id,
    createdById: options.actorId,
    postedAt: options.now,
    lines: [
      { accountId: accounts.suspense, direction: 'DEBIT', amount: transfer.totalDebit },
      { accountId: accounts.sender, direction: 'CREDIT', amount: transfer.totalDebit },
    ],
  });
  const updated = await tx.transfer.update({
    where: { id: transfer.id },
    data: {
      status: options.status,
      failureCode: options.failureCode,
      failureReason: options.failureReason.slice(0, 500),
      updatedAt: options.now,
    },
  });
  await addEvent(
    tx,
    transfer.id,
    options.status,
    options.status === 'REJECTED'
      ? 'Transfer rejected after review'
      : `Transfer failed: ${options.failureReason}`,
    { actorId: options.actorId, at: options.now, data: { failureCode: options.failureCode } },
  );
  await addEvent(tx, transfer.id, 'REFUNDED', 'Funds returned to the sender', { at: options.now });
  if (transfer.senderUserId) {
    await notify(tx, {
      userId: transfer.senderUserId,
      type: options.status === 'REJECTED' ? 'transfer.rejected' : 'transfer.failed',
      title: options.status === 'REJECTED' ? 'Transfer not approved' : 'Transfer failed',
      body: `${formatMoney(transfer.totalDebit, transfer.sourceCurrency)} has been returned to your wallet.`,
      href: `/app/transfers/${transfer.id}`,
      at: options.now,
    });
  }
  return updated;
}

// ---------------------------------------------------------------------------
// After-commit side effects
// ---------------------------------------------------------------------------

const publicTransferPayload = (transfer: Transfer): Record<string, unknown> => ({
  id: transfer.id,
  reference: transfer.reference,
  type: transfer.type,
  status: transfer.status,
  sourceCurrency: transfer.sourceCurrency,
  targetCurrency: transfer.targetCurrency,
  sendAmount: transfer.sendAmount.toString(),
  feeAmount: transfer.feeAmount.toString(),
  receiveAmount: transfer.receiveAmount.toString(),
  recipientName: transfer.recipientName,
  recipientAccount: transfer.recipientAccount,
  failureCode: transfer.failureCode,
  createdAt: transfer.createdAt.toISOString(),
  completedAt: transfer.completedAt?.toISOString() ?? null,
});

const SENDER_EVENT: Partial<Record<Transfer['status'], PartnerEventType>> = {
  COMPLETED: 'transfer.completed',
  FAILED: 'transfer.failed',
  ON_HOLD: 'transfer.on_hold',
  REJECTED: 'transfer.rejected',
  REVERSED: 'transfer.reversed',
};

/** Signed webhook deliveries to the partners involved. Never throws. */
async function emitPartnerEvents(transfer: Transfer): Promise<void> {
  const payload = publicTransferPayload(transfer);
  const senderEvent = SENDER_EVENT[transfer.status];
  if (transfer.senderPartnerId && senderEvent) {
    await dispatchPartnerEvent(transfer.senderPartnerId, senderEvent, payload);
  }
  if (
    transfer.recipientWalletId &&
    (transfer.status === 'COMPLETED' || transfer.status === 'REVERSED')
  ) {
    const wallet = await db.wallet.findUnique({
      where: { id: transfer.recipientWalletId },
      select: { partnerId: true },
    });
    if (wallet?.partnerId) {
      await dispatchPartnerEvent(
        wallet.partnerId,
        transfer.status === 'COMPLETED' ? 'payment.received' : 'payment.reversed',
        payload,
      );
    }
  }
}

type ProviderOutcome =
  | { status: 'SUCCESS'; providerRef: string | null }
  | { status: 'FAILED'; providerRef: string | null; failureCode: string; failureReason: string }
  | { status: 'PENDING'; providerRef: string | null; note?: string };

const toOutcome = (result: ConnectorTransferResult): ProviderOutcome =>
  result.status === 'SUCCESS'
    ? { status: 'SUCCESS', providerRef: result.providerRef }
    : result.status === 'FAILED'
      ? {
          status: 'FAILED',
          providerRef: result.providerRef,
          failureCode: result.failureCode ?? 'PROVIDER_FAILED',
          failureReason: result.failureReason ?? 'The provider declined the transaction',
        }
      : { status: 'PENDING', providerRef: result.providerRef };

/**
 * Applies a provider outcome to a PROCESSING transfer in one transaction: SUCCESS settles the
 * reserved funds (or credits a top-up), FAILED refunds them, PENDING only records the provider
 * reference. Idempotent — anything but PROCESSING is returned untouched.
 */
export async function applyProviderOutcome(
  transferId: string,
  outcome: ProviderOutcome,
  options: { now?: Date; source: 'DISPATCH' | 'POLL' | 'WEBHOOK'; actorId?: string | null } = {
    source: 'DISPATCH',
  },
): Promise<Transfer> {
  const now = options.now ?? new Date();
  const actorId = options.actorId ?? null;
  const updated = await withTransaction(async (tx) => {
    const transfer = await lockTransfer(tx, transferId);
    if (transfer.status !== 'PROCESSING') return transfer;
    const accounts = await accountsForTransfer(tx, transfer);
    await lockAccounts(tx, allAccountIds(accounts));
    const providerRef = outcome.providerRef ?? transfer.providerRef;

    if (outcome.status === 'PENDING') {
      const changed = providerRef !== transfer.providerRef;
      if (changed || outcome.note) {
        await addEvent(
          tx,
          transfer.id,
          'PROVIDER_PENDING',
          outcome.note ?? 'Waiting for the provider to confirm',
          {
            at: now,
            data: { source: options.source },
          },
        );
      }
      return changed
        ? tx.transfer.update({ where: { id: transfer.id }, data: { providerRef, updatedAt: now } })
        : transfer;
    }

    if (providerRef !== transfer.providerRef) {
      await tx.transfer.update({ where: { id: transfer.id }, data: { providerRef } });
    }

    if (transfer.type === 'TOPUP') {
      if (outcome.status === 'FAILED') {
        const failed = await tx.transfer.update({
          where: { id: transfer.id },
          data: {
            status: 'FAILED',
            failureCode: outcome.failureCode,
            failureReason: outcome.failureReason.slice(0, 500),
            updatedAt: now,
          },
        });
        await addEvent(tx, transfer.id, 'FAILED', `Top-up failed: ${outcome.failureReason}`, {
          at: now,
        });
        if (transfer.recipientUserId) {
          await notify(tx, {
            userId: transfer.recipientUserId,
            type: 'topup.failed',
            title: 'Top-up failed',
            body: outcome.failureReason,
            href: `/app/transfers/${transfer.id}`,
            at: now,
          });
        }
        return failed;
      }
      const settlement = (await getSystemAccountIds(tx, transfer.targetCurrency, ['SETTLEMENT']))
        .SETTLEMENT;
      const lines: PostingLine[] = [
        { accountId: settlement, direction: 'DEBIT', amount: transfer.totalDebit },
        { accountId: accounts.destination, direction: 'CREDIT', amount: transfer.receiveAmount },
      ];
      if (transfer.feeAmount > 0n) {
        lines.push({
          accountId: accounts.feeRevenue,
          direction: 'CREDIT',
          amount: transfer.feeAmount,
        });
      }
      await postJournal(tx, {
        kind: 'TOPUP',
        description: `Top-up ${transfer.reference}`,
        transferId: transfer.id,
        createdById: actorId,
        postedAt: now,
        lines,
      });
      const completed = await tx.transfer.update({
        where: { id: transfer.id },
        data: { status: 'COMPLETED', completedAt: now, updatedAt: now },
      });
      await addEvent(tx, transfer.id, 'COMPLETED', 'Top-up credited to the wallet', { at: now });
      if (transfer.recipientUserId) {
        await notify(tx, {
          userId: transfer.recipientUserId,
          type: 'topup.completed',
          title: 'Wallet topped up',
          body: `${formatMoney(transfer.receiveAmount, transfer.targetCurrency)} added to your wallet.`,
          href: `/app/transfers/${transfer.id}`,
          at: now,
        });
      }
      return completed;
    }

    if (outcome.status === 'SUCCESS') {
      return completeTransfer(tx, { ...transfer, providerRef }, accounts, accounts.suspense, {
        now,
        actorId,
        journalKind: 'RELEASE',
      });
    }
    return refundTransfer(tx, transfer, accounts, {
      now,
      actorId,
      status: 'FAILED',
      failureCode: outcome.failureCode,
      failureReason: outcome.failureReason,
    });
  });
  if (updated.status !== 'PROCESSING') await emitPartnerEvents(updated);
  return updated;
}

/**
 * Sends a PROCESSING mobile-money transfer (or top-up) to its provider and applies the answer.
 * A timeout or connector error leaves the transfer PROCESSING for `refreshTransferStatus` or a
 * provider webhook to resolve — the reserved funds stay in SUSPENSE meanwhile.
 */
async function dispatchToProvider(transferId: string, now?: Date): Promise<Transfer> {
  const transfer = await db.transfer.findUniqueOrThrow({ where: { id: transferId } });
  if (transfer.status !== 'PROCESSING' || !transfer.providerId) return transfer;
  await db.transferEvent.create({
    data: {
      transferId,
      type: 'SENT_TO_PROVIDER',
      message: 'Sent to the mobile-money provider',
      ...(now ? { createdAt: now } : {}),
    },
  });
  let outcome: ProviderOutcome;
  try {
    const { connector } = await getConnectorForProvider(transfer.providerId, {
      allowInactive: true,
    });
    const result = await connector.transfer({
      reference: transfer.reference,
      direction: transfer.type === 'TOPUP' ? 'COLLECT' : 'PAYOUT',
      accountNumber: transfer.recipientAccount,
      amount: transfer.type === 'TOPUP' ? transfer.totalDebit : transfer.receiveAmount,
      currency: transfer.targetCurrency,
      narration: `BI-Rem ${transfer.reference}`,
    });
    outcome = toOutcome(result);
  } catch (error) {
    outcome = {
      status: 'PENDING',
      providerRef: null,
      note:
        error instanceof ConnectorTimeoutError
          ? 'The provider did not answer in time — the status will be checked again'
          : 'The provider could not be reached — the status will be checked again',
    };
  }
  return applyProviderOutcome(transferId, outcome, { now, source: 'DISPATCH' });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function commissionFor(
  plan: TransferPlan,
  recipientPartner: { id: string; commissionBps: number } | null,
  pricing: Pricing,
) {
  // Merchant / agent receiving a payment earns the commission; otherwise an API partner earns
  // a rebate on the transfers it originates. Never more than the fee the platform collected.
  const earner =
    recipientPartner && recipientPartner.commissionBps > 0
      ? recipientPartner
      : plan.sender.partnerId && plan.sender.partnerCommissionBps > 0
        ? { id: plan.sender.partnerId, commissionBps: plan.sender.partnerCommissionBps }
        : null;
  if (!earner) return { partnerId: null, amount: 0n };
  const raw = bpsOf(pricing.sendAmount, earner.commissionBps, 'floor');
  const amount = raw > pricing.feeAmount ? pricing.feeAmount : raw;
  return amount > 0n ? { partnerId: earner.id, amount } : { partnerId: null, amount: 0n };
}

function assertQuoteMatches(
  plan: TransferPlan,
  pricing: Pricing,
  amount: bigint | undefined,
): void {
  const mismatch =
    pricing.type !== plan.type ||
    pricing.deliveryMethod !== plan.recipient.deliveryMethod ||
    pricing.sourceCurrency !== plan.sender.currency ||
    pricing.targetCurrency !== plan.recipient.currency ||
    pricing.sourceCountry !== plan.sender.countryCode ||
    pricing.targetCountry !== plan.recipient.countryCode ||
    (amount !== undefined && amount !== pricing.sendAmount);
  if (mismatch) {
    throw new AppError(
      'VALIDATION',
      'This quote does not match the transfer. Please request a new quote.',
    );
  }
}

/**
 * Creates and executes a transfer from a wallet the actor owns.
 *
 * - Wallet recipient, not flagged: settles immediately → COMPLETED.
 * - Mobile-money recipient, not flagged: funds reserved → PROCESSING → provider outcome.
 * - Flagged by AML: funds reserved → ON_HOLD with a compliance case.
 *
 * Idempotent on `idempotencyKey` per sender. Throws `AppError` (NOT_FOUND, VALIDATION,
 * INSUFFICIENT_FUNDS, LIMIT_EXCEEDED, KYC_REQUIRED, QUOTE_EXPIRED, UNSUPPORTED…).
 */
export async function createTransfer(
  ctx: ActionContext,
  input: CreateTransferInput,
  options: EngineOptions = {},
): Promise<TransferResult> {
  const data = createTransferSchema.parse(input);
  if (data.amount === undefined && !data.quoteId) {
    throw new AppError('VALIDATION', 'Provide an amount or a quote');
  }
  const now = options.now ?? new Date();
  const channel: TransferChannel =
    options.channel ?? (ctx.actor.type === 'API_KEY' ? 'API' : 'WEB');
  const actorId = actorUserId(ctx);

  const plan = await planTransfer(ctx, data);
  const { sender, recipient } = plan;

  const replayOf = (client: Tx | typeof db) =>
    client.transfer.findUnique({
      where: {
        idempotencyScope_idempotencyKey: {
          idempotencyScope: sender.scope,
          idempotencyKey: data.idempotencyKey,
        },
      },
    });
  const existing = await replayOf(db);
  if (existing) return { transfer: existing, replayed: true };

  if (plan.international && (!data.purpose || !data.sourceOfFunds)) {
    throw new AppError(
      'VALIDATION',
      'International transfers need a purpose and a source of funds',
      {
        fieldErrors: {
          ...(data.purpose ? {} : { purpose: ['Choose the purpose of this transfer'] }),
          ...(data.sourceOfFunds ? {} : { sourceOfFunds: ['Choose the source of funds'] }),
        },
      },
    );
  }

  const recipientPartner = recipient.partnerId
    ? await db.partner.findUnique({
        where: { id: recipient.partnerId },
        select: { id: true, commissionBps: true },
      })
    : null;

  let screening: ScreeningResult = { decision: 'CLEAR', score: 0, hits: [] };
  let created: { transfer: Transfer; replayed: boolean };
  try {
    created = await withTransaction(async (tx) => {
      const accounts = await resolveAccounts(
        tx,
        { sourceCurrency: sender.currency, targetCurrency: recipient.currency },
        sender.ledgerAccountId,
        recipient.ledgerAccountId,
      );
      // Rule 1: lock every account this transfer can touch, in id order, before reading balances.
      const locked = await lockAccounts(tx, allAccountIds(accounts));

      // Rule 4: under the sender's lock a concurrent duplicate is now visible.
      const duplicate = await replayOf(tx);
      if (duplicate) return { transfer: duplicate, replayed: true };

      const pricing = data.quoteId
        ? await consumeQuote(tx, ctx, data.quoteId, now)
        : await priceTransfer(tx, pricingInputFor(plan, data.amount ?? 0n));
      if (data.quoteId) assertQuoteMatches(plan, pricing, data.amount);

      if (sender.userId && sender.kycTier) {
        await assertWithinLimits(tx, {
          userId: sender.userId,
          tier: sender.kycTier,
          amountUsd: pricing.sendAmountUsd,
          international: plan.international,
          now,
        });
      }

      const balance = locked.get(sender.ledgerAccountId)?.balance ?? 0n;
      if (balance < pricing.totalDebit) {
        throw new AppError(
          'INSUFFICIENT_FUNDS',
          `Insufficient funds: ${formatMoney(balance, sender.currency)} available, ${formatMoney(pricing.totalDebit, sender.currency)} needed`,
          { details: { available: balance.toString(), required: pricing.totalDebit.toString() } },
        );
      }

      // Rule 6: screen before any debit.
      screening = await evaluateTransfer(tx, {
        senderUserId: sender.userId,
        senderName: sender.name,
        senderCreatedAt: sender.createdAt,
        recipientName: recipient.name,
        sourceCountry: sender.countryCode,
        targetCountry: recipient.countryCode,
        type: plan.type,
        amountUsd: pricing.sendAmountUsd,
        now,
      });
      const held = screening.decision === 'HOLD';
      const commission = commissionFor(plan, recipientPartner, pricing);

      const transfer = await tx.transfer.create({
        data: {
          reference: newReference(),
          type: plan.type,
          status: held ? 'ON_HOLD' : 'PROCESSING',
          deliveryMethod: recipient.deliveryMethod,
          channel,
          senderUserId: sender.userId,
          senderPartnerId: sender.partnerId,
          senderWalletId: sender.walletId,
          recipientUserId: recipient.userId,
          recipientWalletId: recipient.walletId,
          beneficiaryId: recipient.beneficiaryId,
          senderName: sender.name,
          recipientName: recipient.name,
          recipientAccount: recipient.account,
          providerId: recipient.providerId,
          sourceCountry: sender.countryCode,
          targetCountry: recipient.countryCode,
          sourceCurrency: sender.currency,
          targetCurrency: recipient.currency,
          sendAmount: pricing.sendAmount,
          feeAmount: pricing.feeAmount,
          fxMarginAmount: pricing.fxMarginAmount,
          totalDebit: pricing.totalDebit,
          receiveAmount: pricing.receiveAmount,
          midRate: rateToDecimalString(pricing.midRate),
          customerRate: rateToDecimalString(pricing.customerRate),
          marginBps: pricing.marginBps,
          sendAmountUsd: pricing.sendAmountUsd,
          revenueUsd: pricing.revenueUsd,
          quoteId: data.quoteId ?? null,
          purpose: data.purpose ?? null,
          sourceOfFunds: data.sourceOfFunds ?? null,
          note: data.note ?? null,
          partnerId: commission.partnerId,
          commissionAmount: commission.amount,
          idempotencyScope: sender.scope,
          idempotencyKey: data.idempotencyKey,
          amlScore: screening.score,
          amlFlags: screening.hits.map((hit) => hit.ruleCode),
          createdAt: now,
          updatedAt: now,
        },
      });

      await addEvent(tx, transfer.id, 'CREATED', 'Transfer created', { actorId, at: now });
      await addEvent(
        tx,
        transfer.id,
        'SCREENED',
        screening.decision === 'CLEAR'
          ? 'Compliance screening passed'
          : 'Compliance screening raised alerts',
        {
          at: now,
          data: {
            decision: screening.decision,
            score: screening.score,
            rules: screening.hits.map((hit) => hit.ruleCode),
          },
        },
      );
      const { caseId } = await recordScreening(tx, {
        transferId: transfer.id,
        transferReference: transfer.reference,
        userId: sender.userId,
        result: screening,
        now,
      });

      let result: Transfer;
      if (held || recipient.deliveryMethod === 'MOBILE_MONEY') {
        await postJournal(tx, {
          kind: 'RESERVE',
          description: `Funds reserved for ${transfer.reference}`,
          transferId: transfer.id,
          createdById: actorId,
          postedAt: now,
          lines: [
            { accountId: sender.ledgerAccountId, direction: 'DEBIT', amount: transfer.totalDebit },
            { accountId: accounts.suspense, direction: 'CREDIT', amount: transfer.totalDebit },
          ],
        });
        if (held) {
          await addEvent(
            tx,
            transfer.id,
            'HELD',
            'Transfer is under compliance review; funds are reserved',
            {
              at: now,
              data: caseId ? { caseId } : undefined,
            },
          );
          if (sender.userId) {
            await notify(tx, {
              userId: sender.userId,
              type: 'transfer.on_hold',
              title: 'Transfer under review',
              body: `Your transfer to ${recipient.name} is being reviewed. We will notify you shortly.`,
              href: `/app/transfers/${transfer.id}`,
              at: now,
            });
          }
        } else {
          await addEvent(
            tx,
            transfer.id,
            'FUNDS_RESERVED',
            'Funds reserved while the provider processes the payout',
            { at: now },
          );
        }
        result = transfer;
      } else {
        result = await completeTransfer(tx, transfer, accounts, sender.ledgerAccountId, {
          now,
          actorId,
          journalKind: 'TRANSFER',
        });
      }

      await writeAudit(tx, ctx, {
        action: 'transfer.create',
        resourceType: 'transfer',
        resourceId: transfer.id,
        at: options.now,
        after: {
          reference: transfer.reference,
          type: transfer.type,
          status: result.status,
          deliveryMethod: transfer.deliveryMethod,
          sourceCurrency: transfer.sourceCurrency,
          targetCurrency: transfer.targetCurrency,
          sendAmount: transfer.sendAmount,
          feeAmount: transfer.feeAmount,
          fxMarginAmount: transfer.fxMarginAmount,
          receiveAmount: transfer.receiveAmount,
          recipientAccount: transfer.recipientAccount,
          amlDecision: screening.decision,
          amlScore: screening.score,
        },
      });
      return { transfer: result, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await replayOf(db);
      if (winner) return { transfer: winner, replayed: true };
    }
    throw error;
  }

  if (created.replayed) return created;

  let transfer = created.transfer;
  if (transfer.status === 'PROCESSING' && transfer.deliveryMethod === 'MOBILE_MONEY') {
    transfer = await dispatchToProvider(transfer.id, options.now);
  } else {
    await emitPartnerEvents(transfer);
  }
  if (sender.userId && screening.hits.length > 0) {
    await assessUserRisk(db, sender.userId, now).catch(() => undefined);
  }
  return { transfer, replayed: false };
}

// ---------------------------------------------------------------------------
// Top-up (cash-in from mobile money)
// ---------------------------------------------------------------------------

export const topUpSchema = z.object({
  walletId: z.uuid(),
  providerId: z.uuid(),
  accountNumber: z.string().trim().min(8).max(20),
  amount: z.bigint().positive().max(MAX_AMOUNT_MINOR, 'Amount is too large'),
  idempotencyKey: idempotencyKeySchema,
});
export type TopUpInput = z.infer<typeof topUpSchema>;

/**
 * Cash-in: collects `amount` from a mobile-money account through the provider's connector and
 * credits the wallet (DR settlement/float, CR wallet, CR fee revenue if a TOPUP fee rule exists).
 * Nothing is posted until the provider confirms.
 */
export async function topUpWallet(
  ctx: ActionContext,
  input: TopUpInput,
  options: EngineOptions = {},
): Promise<TransferResult> {
  const data = topUpSchema.parse(input);
  const now = options.now ?? new Date();
  const wallet = await db.wallet.findUnique({
    where: { id: data.walletId },
    include: { user: true, partner: true },
  });
  if (!wallet || !ownsWallet(ctx, wallet)) throw new AppError('NOT_FOUND', 'Wallet not found');
  if (wallet.status !== 'ACTIVE') throw new AppError('INVALID_STATE', 'This wallet is not active');
  if (wallet.partner && wallet.partner.status !== 'ACTIVE') {
    throw new AppError('FORBIDDEN', 'This partner account is not active');
  }
  const scope = wallet.partnerId ? `partner:${wallet.partnerId}` : `user:${wallet.userId}`;
  const ownerName = wallet.partner?.name ?? wallet.user?.fullName ?? 'Wallet owner';

  const where = {
    idempotencyScope_idempotencyKey: {
      idempotencyScope: scope,
      idempotencyKey: data.idempotencyKey,
    },
  };
  const existing = await db.transfer.findUnique({ where });
  if (existing) return { transfer: existing, replayed: true };

  const provider = await db.provider.findUnique({
    where: { id: data.providerId },
    include: { country: true },
  });
  if (provider?.status !== 'ACTIVE' || !provider.supportsCollection || !provider.country.enabled) {
    throw new AppError('UNSUPPORTED', 'This mobile-money provider is not available for top-ups');
  }
  if (provider.currency !== wallet.currency) {
    throw new AppError(
      'VALIDATION',
      `${provider.name} works in ${provider.currency}, this wallet is in ${wallet.currency}`,
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
      `${provider.name} could not validate the account right now`,
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
    sendAmount: data.amount,
  });
  if (pricing.feeAmount >= data.amount) throw new AppError('VALIDATION', 'Amount is too small');
  // The seed (system actor) funds demo wallets; everybody else is held to the cash-in limits.
  const cashInOwner: CashInOwner | null =
    ctx.actor.type === 'SYSTEM'
      ? null
      : wallet.partnerId
        ? { partnerId: wallet.partnerId }
        : wallet.user
          ? { userId: wallet.user.id, tier: wallet.user.kycTier }
          : null;

  let created: { transfer: Transfer; replayed: boolean };
  try {
    created = await withTransaction(async (tx) => {
      // Serialise the top-ups of one wallet: the limit check and the insert are one unit.
      await lockAccounts(tx, [wallet.ledgerAccountId]);
      const duplicate = await tx.transfer.findUnique({ where });
      if (duplicate) return { transfer: duplicate, replayed: true };
      if (cashInOwner) {
        await assertCashInWithinLimits(tx, {
          owner: cashInOwner,
          amountUsd: pricing.sendAmountUsd,
          now,
        });
      }
      const createdTransfer = await tx.transfer.create({
        data: {
          reference: newReference(),
          type: 'TOPUP',
          status: 'PROCESSING',
          deliveryMethod: 'MOBILE_MONEY',
          channel: options.channel ?? (ctx.actor.type === 'API_KEY' ? 'API' : 'WEB'),
          senderUserId: wallet.userId,
          senderPartnerId: wallet.partnerId,
          recipientUserId: wallet.userId,
          recipientWalletId: wallet.id,
          senderName: `${provider.name} · ${accountNumber}`,
          recipientName: ownerName,
          recipientAccount: accountNumber,
          providerId: provider.id,
          sourceCountry: provider.countryCode,
          targetCountry: provider.countryCode,
          sourceCurrency: wallet.currency,
          targetCurrency: wallet.currency,
          sendAmount: data.amount,
          feeAmount: pricing.feeAmount,
          fxMarginAmount: 0n,
          totalDebit: data.amount,
          receiveAmount: data.amount - pricing.feeAmount,
          midRate: rateToDecimalString(pricing.midRate),
          customerRate: rateToDecimalString(pricing.customerRate),
          sendAmountUsd: pricing.sendAmountUsd,
          revenueUsd: pricing.revenueUsd,
          idempotencyScope: scope,
          idempotencyKey: data.idempotencyKey,
          createdAt: now,
          updatedAt: now,
        },
      });
      await addEvent(tx, createdTransfer.id, 'CREATED', 'Top-up requested', {
        actorId: actorUserId(ctx),
        at: now,
      });
      await writeAudit(tx, ctx, {
        action: 'wallet.topup',
        resourceType: 'transfer',
        resourceId: createdTransfer.id,
        at: options.now,
        after: {
          reference: createdTransfer.reference,
          walletId: wallet.id,
          provider: provider.code,
          amount: data.amount,
          currency: wallet.currency,
        },
      });
      return { transfer: createdTransfer, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await db.transfer.findUnique({ where });
      if (winner) return { transfer: winner, replayed: true };
    }
    throw error;
  }
  // A duplicate found under the lock belongs to (and is dispatched by) the request that won.
  if (created.replayed) return created;
  return { transfer: await dispatchToProvider(created.transfer.id, options.now), replayed: false };
}

// ---------------------------------------------------------------------------
// Compliance: release / reject a held transfer
// ---------------------------------------------------------------------------

/**
 * Releases an ON_HOLD transfer inside `tx`. Wallet deliveries settle from SUSPENSE right away;
 * mobile-money deliveries go back to PROCESSING and must be dispatched after commit
 * (`finishRelease`). The caller is responsible for permission checks and audit.
 */
export async function releaseHeldTransferTx(
  tx: Tx,
  transferId: string,
  options: { now: Date; actorId: string | null; note: string },
): Promise<Transfer> {
  const transfer = await lockTransfer(tx, transferId);
  if (transfer.status !== 'ON_HOLD')
    throw new AppError('INVALID_STATE', 'This transfer is not on hold');
  const accounts = await accountsForTransfer(tx, transfer);
  await lockAccounts(tx, allAccountIds(accounts));
  await addEvent(tx, transfer.id, 'RELEASED', 'Released by compliance', {
    actorId: options.actorId,
    at: options.now,
    data: { note: options.note },
  });
  if (transfer.deliveryMethod === 'MOBILE_MONEY') {
    return tx.transfer.update({
      where: { id: transfer.id },
      data: { status: 'PROCESSING', updatedAt: options.now },
    });
  }
  return completeTransfer(tx, transfer, accounts, accounts.suspense, {
    now: options.now,
    actorId: options.actorId,
    journalKind: 'RELEASE',
  });
}

/** Rejects an ON_HOLD transfer inside `tx`: refunds the reserved funds and marks it REJECTED. */
export async function rejectHeldTransferTx(
  tx: Tx,
  transferId: string,
  options: { now: Date; actorId: string | null; reason: string },
): Promise<Transfer> {
  const transfer = await lockTransfer(tx, transferId);
  if (transfer.status !== 'ON_HOLD')
    throw new AppError('INVALID_STATE', 'This transfer is not on hold');
  const accounts = await accountsForTransfer(tx, transfer);
  await lockAccounts(tx, allAccountIds(accounts));
  return refundTransfer(tx, transfer, accounts, {
    now: options.now,
    actorId: options.actorId,
    status: 'REJECTED',
    failureCode: 'COMPLIANCE_REJECTED',
    failureReason: options.reason,
  });
}

/** After-commit step of a release / rejection: provider dispatch and partner webhooks. */
export async function finishHeldTransfer(transfer: Transfer, now?: Date): Promise<Transfer> {
  if (transfer.status === 'PROCESSING' && transfer.deliveryMethod === 'MOBILE_MONEY') {
    return dispatchToProvider(transfer.id, now);
  }
  await emitPartnerEvents(transfer);
  if (transfer.senderUserId)
    await assessUserRisk(db, transfer.senderUserId, now).catch(() => undefined);
  return transfer;
}

/**
 * Releases a held transfer (completes it). Requires `aml:write`. For transfers attached to an
 * AML case prefer `releaseCase` in `@/server/aml/cases`, which also closes the case.
 */
export async function releaseHeldTransfer(
  ctx: ActionContext,
  transferId: string,
  note: string,
  options: EngineOptions = {},
): Promise<Transfer> {
  assertPermission(ctx, 'aml:write');
  const now = options.now ?? new Date();
  const released = await withTransaction(async (tx) => {
    const transfer = await releaseHeldTransferTx(tx, transferId, {
      now,
      actorId: actorUserId(ctx),
      note,
    });
    await writeAudit(tx, ctx, {
      action: 'transfer.release',
      resourceType: 'transfer',
      resourceId: transferId,
      at: options.now,
      before: { status: 'ON_HOLD' },
      after: { status: transfer.status, note },
    });
    return transfer;
  });
  return finishHeldTransfer(released, options.now);
}

/** Rejects a held transfer and refunds the sender. Requires `aml:write`. */
export async function rejectHeldTransfer(
  ctx: ActionContext,
  transferId: string,
  reason: string,
  options: EngineOptions = {},
): Promise<Transfer> {
  assertPermission(ctx, 'aml:write');
  const now = options.now ?? new Date();
  const rejected = await withTransaction(async (tx) => {
    const transfer = await rejectHeldTransferTx(tx, transferId, {
      now,
      actorId: actorUserId(ctx),
      reason,
    });
    await writeAudit(tx, ctx, {
      action: 'transfer.reject',
      resourceType: 'transfer',
      resourceId: transferId,
      at: options.now,
      before: { status: 'ON_HOLD' },
      after: { status: transfer.status, reason },
    });
    return transfer;
  });
  return finishHeldTransfer(rejected, options.now);
}

// ---------------------------------------------------------------------------
// Provider status refresh
// ---------------------------------------------------------------------------

/**
 * Polls the provider for a PROCESSING transfer and applies the outcome. Allowed for the sender
 * (or the topped-up wallet's owner), the sending partner, and staff with `transfers:refresh`.
 */
export async function refreshTransferStatus(
  ctx: ActionContext,
  transferId: string,
): Promise<Transfer> {
  const transfer = await db.transfer.findUnique({ where: { id: transferId } });
  const isOwner =
    ctx.actor.type === 'SYSTEM' ||
    (ctx.actor.type === 'USER' && transfer?.senderUserId === ctx.actor.id) ||
    (transfer?.senderPartnerId != null && actorPartnerId(ctx) === transfer.senderPartnerId);
  if (!transfer || !(isOwner || hasPermission(ctx, 'transfers:refresh'))) {
    throw new AppError('NOT_FOUND', 'Transfer not found');
  }
  if (transfer.status !== 'PROCESSING' || !transfer.providerId) return transfer;

  const dispatched = await db.transferEvent.count({
    where: { transferId, type: 'SENT_TO_PROVIDER' },
  });
  if (dispatched === 0) return dispatchToProvider(transferId);

  let outcome: ProviderOutcome;
  try {
    const { connector } = await getConnectorForProvider(transfer.providerId, {
      allowInactive: true,
    });
    outcome = toOutcome(
      await connector.getStatus({
        reference: transfer.reference,
        providerRef: transfer.providerRef,
        accountNumber: transfer.recipientAccount,
      }),
    );
  } catch {
    throw new AppError(
      'PROVIDER_ERROR',
      'The provider could not be reached. Please try again later.',
    );
  }
  return applyProviderOutcome(transferId, outcome, { source: 'POLL', actorId: actorUserId(ctx) });
}

// ---------------------------------------------------------------------------
// Reversal
// ---------------------------------------------------------------------------

/**
 * Reverses a COMPLETED transfer with compensating journals (rule 7): every journal of the
 * transfer is mirrored, so the sender gets back send + fee, the recipient is debited what they
 * received and revenue is unwound. Fails with INSUFFICIENT_FUNDS if the recipient no longer
 * holds the money. For mobile-money payouts the operator is asked to reverse first.
 * Requires `transfers:reverse`.
 */
export async function reverseTransfer(
  ctx: ActionContext,
  transferId: string,
  reason: string,
  options: EngineOptions = {},
): Promise<Transfer> {
  assertPermission(ctx, 'transfers:reverse');
  const cleanReason = z
    .string()
    .trim()
    .min(5, 'Explain why the transfer is reversed')
    .max(500)
    .parse(reason);
  const now = options.now ?? new Date();
  const actorId = actorUserId(ctx);

  const current = await db.transfer.findUnique({ where: { id: transferId } });
  if (!current) throw new AppError('NOT_FOUND', 'Transfer not found');
  if (current.status !== 'COMPLETED')
    throw new AppError('INVALID_STATE', 'Only completed transfers can be reversed');

  // Reversing a top-up sends the money back through the operator, so make sure the wallet still
  // holds it BEFORE the operator is asked: the other order would refund the payer at the
  // operator and then fail to debit the wallet. (The ledger reversal re-checks under the lock.)
  if (current.type === 'TOPUP' && current.recipientWalletId) {
    const held = await db.wallet.findUnique({
      where: { id: current.recipientWalletId },
      select: { ledgerAccount: { select: { balance: true } } },
    });
    if (!held || held.ledgerAccount.balance < current.receiveAmount) {
      throw new AppError(
        'INSUFFICIENT_FUNDS',
        'The wallet no longer holds enough funds to reverse this top-up',
      );
    }
  }

  if (current.deliveryMethod === 'MOBILE_MONEY' && current.providerId) {
    let result: ConnectorTransferResult;
    try {
      const { connector } = await getConnectorForProvider(current.providerId, {
        allowInactive: true,
      });
      result = await connector.reverse({
        reference: current.reference,
        providerRef: current.providerRef,
        accountNumber: current.recipientAccount,
        amount: current.type === 'TOPUP' ? current.totalDebit : current.receiveAmount,
        currency: current.targetCurrency,
        reason: cleanReason,
      });
    } catch {
      result = {
        status: 'FAILED',
        providerRef: '',
        failureReason: 'The provider could not be reached',
      };
    }
    if (result.status !== 'SUCCESS') {
      await writeAudit(db, ctx, {
        action: 'transfer.reverse',
        resourceType: 'transfer',
        resourceId: transferId,
        outcome: 'FAILURE',
        metadata: { reason: cleanReason, providerFailure: result.failureReason ?? result.status },
      });
      throw new AppError(
        'PROVIDER_ERROR',
        result.failureReason ?? 'The provider did not confirm the reversal',
      );
    }
  }

  const reversed = await withTransaction(async (tx) => {
    const transfer = await lockTransfer(tx, transferId);
    if (transfer.status !== 'COMPLETED')
      throw new AppError('INVALID_STATE', 'Only completed transfers can be reversed');

    // The journals of a transfer only change under its row lock, which we hold.
    const journals = await tx.journal.findMany({
      where: { transferId, reversesJournalId: null, reversal: null },
      include: { entries: { select: { accountId: true } } },
      orderBy: { postedAt: 'desc' },
    });
    // Lock every account first — including COMMISSION_PAYABLE, which serialises this reversal
    // with a commission settlement — and only then read the commission. Reading it before the
    // lock let a concurrent settlement pay the commission out while the reversal, still seeing
    // ACCRUED, reversed the accrual as well (paid-out commission booked as never owed).
    const accounts = await accountsForTransfer(tx, transfer);
    await lockAccounts(tx, [
      ...allAccountIds(accounts),
      ...journals.flatMap((journal) => journal.entries.map((entry) => entry.accountId)),
    ]);
    const commission = await tx.commission.findFirst({
      where: { transferId, status: { not: 'REVERSED' } },
    });
    // A commission already paid out to the partner is not clawed back automatically.
    const reversible = journals.filter(
      (journal) => !(journal.kind === 'COMMISSION' && commission?.status === 'SETTLED'),
    );
    for (const journal of reversible) {
      try {
        await reverseJournal(tx, journal.id, {
          description: `Reversal of ${transfer.reference}`,
          createdById: actorId,
          transferId: transfer.id,
          postedAt: now,
        });
      } catch (error) {
        if (error instanceof AppError && error.code === 'INSUFFICIENT_FUNDS') {
          throw new AppError(
            'INSUFFICIENT_FUNDS',
            'The recipient no longer holds enough funds to reverse this transfer',
          );
        }
        throw error;
      }
    }
    if (commission?.status === 'ACCRUED') {
      await tx.commission.update({ where: { id: commission.id }, data: { status: 'REVERSED' } });
    }
    const updated = await tx.transfer.update({
      where: { id: transfer.id },
      data: { status: 'REVERSED', reversedAt: now, failureReason: cleanReason, updatedAt: now },
    });
    await addEvent(tx, transfer.id, 'REVERSED', 'Transfer reversed', {
      actorId,
      at: now,
      data: { reason: cleanReason },
    });
    const parties = new Set(
      [transfer.senderUserId, transfer.recipientUserId].filter((id): id is string => id !== null),
    );
    for (const userId of parties) {
      await notify(tx, {
        userId,
        type: 'transfer.reversed',
        title: 'Transfer reversed',
        body: `Transfer ${transfer.reference} has been reversed.`,
        href: `/app/transfers/${transfer.id}`,
        at: now,
      });
    }
    await writeAudit(tx, ctx, {
      action: 'transfer.reverse',
      resourceType: 'transfer',
      resourceId: transfer.id,
      at: options.now,
      before: { status: 'COMPLETED' },
      after: { status: 'REVERSED', reason: cleanReason, journalsReversed: reversible.length },
    });
    return updated;
  });
  await emitPartnerEvents(reversed);
  return reversed;
}
