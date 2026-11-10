'use server';

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import { listAvailableProviders } from '@/server/connectors';
import { getCountry } from '@/server/countries';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { getQuote } from '@/server/fx';
import { assertWithinLimits } from '@/server/kyc';
import { formatMoney, formatRate, parseMinor, parseMoney, parseRate } from '@/server/money';
import type { ActionContext } from '@/server/rbac';
import {
  SOURCES_OF_FUNDS,
  TRANSFER_PURPOSES,
  type TransferPlan,
  createTransfer,
  planTransfer,
  previewTransfer,
  quoteTransfer,
} from '@/server/transfers';
import { getWallet } from '@/server/wallets';

import {
  type RecipientForm,
  checkPlanMatchesChoice,
  recipientFields,
  refineRecipient,
  secondsUntil,
  toRecipientInput,
} from '../_lib/send';

/**
 * Server actions of the guided "Send money" flow. The browser re-sends the recipient fields with
 * every step and each action resolves the recipient again through the engine: nothing the
 * client remembers (names, prices, transfer type) is ever trusted. Money moves only in
 * `confirmTransferAction`, through `createTransfer`.
 */

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** The engine reports recipient problems on `recipient`; the form field is `identifier`. */
function remapRecipientError(error: unknown): never {
  if (error instanceof AppError && error.fieldErrors?.recipient) {
    const { recipient, ...rest } = error.fieldErrors;
    throw new AppError(error.code, error.message, {
      fieldErrors: { ...rest, identifier: recipient },
    });
  }
  throw error;
}

/** Fails when the engine's plan is not what the customer chose in step 1. */
async function assertPlanMatches(form: RecipientForm, plan: TransferPlan): Promise<string> {
  const country = await getCountry(plan.recipient.countryCode);
  const countryName = country?.name ?? plan.recipient.countryCode;
  const mismatch = checkPlanMatchesChoice(form, {
    international: plan.international,
    recipientCountry: plan.recipient.countryCode,
    recipientCountryName: countryName,
    recipientWalletType: plan.recipient.walletType,
  });
  if (mismatch) {
    throw new AppError('VALIDATION', mismatch.message, {
      fieldErrors: { [mismatch.field]: [mismatch.message] },
    });
  }
  return countryName;
}

/** What the browser may know about a resolved plan — no internal ids. */
async function summarisePlan(plan: TransferPlan, countryName: string) {
  const provider = plan.recipient.providerId
    ? (await listAvailableProviders({ countryCode: plan.recipient.countryCode })).find(
        (candidate) => candidate.id === plan.recipient.providerId,
      )
    : undefined;
  return {
    type: plan.type,
    international: plan.international,
    senderCurrency: plan.sender.currency,
    recipient: {
      name: plan.recipient.name,
      account: plan.recipient.account,
      countryCode: plan.recipient.countryCode,
      countryName,
      currency: plan.recipient.currency,
      deliveryMethod: plan.recipient.deliveryMethod,
      providerName: provider?.name ?? null,
      simulated: provider?.simulated ?? false,
    },
  };
}

function parseAmount(text: string, currency: string): bigint {
  try {
    const amount = parseMoney(text, currency);
    if (amount <= 0n) throw new AppError('VALIDATION', 'Enter an amount greater than zero');
    return amount;
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError('VALIDATION', error.message, { fieldErrors: { amount: [error.message] } });
    }
    throw error;
  }
}

interface Blocker {
  readonly code: 'INSUFFICIENT_FUNDS' | 'KYC_REQUIRED' | 'LIMIT_EXCEEDED';
  readonly message: string;
}

/**
 * The reasons the engine would refuse this transfer right now (balance, KYC tier, limits),
 * found early so the customer is told while typing rather than after confirming. Advisory only:
 * `createTransfer` runs the authoritative checks under the wallet lock.
 */
async function findBlocker(
  ctx: ActionContext,
  plan: TransferPlan,
  price: { totalDebit: bigint; sendAmountUsd: bigint },
): Promise<Blocker | null> {
  const wallet = await getWallet(ctx, plan.sender.walletId);
  if (wallet.balance < price.totalDebit) {
    return {
      code: 'INSUFFICIENT_FUNDS',
      message: `You need ${formatMoney(price.totalDebit, wallet.currency)} but your wallet holds ${formatMoney(wallet.balance, wallet.currency)}.`,
    };
  }
  if (plan.sender.userId && plan.sender.kycTier) {
    try {
      await assertWithinLimits(db, {
        userId: plan.sender.userId,
        tier: plan.sender.kycTier,
        amountUsd: price.sendAmountUsd,
        international: plan.international,
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === 'KYC_REQUIRED' || error.code === 'LIMIT_EXCEEDED')
      ) {
        return { code: error.code, message: error.message };
      }
      throw error;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 1 — resolve the recipient
// ---------------------------------------------------------------------------

export const resolveRecipientAction = createAction({
  schema: recipientFields.superRefine(refineRecipient),
  roles: ['CUSTOMER'],
  handler: async (input, ctx) => {
    const plan = await planTransfer(ctx, {
      senderWalletId: input.senderWalletId,
      recipient: toRecipientInput(input),
    }).catch(remapRecipientError);
    const countryName = await assertPlanMatches(input, plan);
    return summarisePlan(plan, countryName);
  },
});

// ---------------------------------------------------------------------------
// Step 2 — live estimate while the amount is typed (nothing stored)
// ---------------------------------------------------------------------------

const amountText = z.string().trim().min(1, 'Enter an amount').max(24);

export const estimateTransferAction = createAction({
  schema: recipientFields.extend({ amount: amountText }).superRefine(refineRecipient),
  roles: ['CUSTOMER'],
  handler: async (input, ctx) => {
    const wallet = await getWallet(ctx, input.senderWalletId);
    const amount = parseAmount(input.amount, wallet.currency);
    const { plan, pricing } = await previewTransfer(ctx, {
      senderWalletId: input.senderWalletId,
      recipient: toRecipientInput(input),
      amount,
    }).catch(remapRecipientError);
    await assertPlanMatches(input, plan);
    const crossCurrency = pricing.sourceCurrency !== pricing.targetCurrency;
    return {
      sendAmount: pricing.sendAmount,
      feeAmount: pricing.feeAmount,
      totalDebit: pricing.totalDebit,
      receiveAmount: pricing.receiveAmount,
      sourceCurrency: pricing.sourceCurrency,
      targetCurrency: pricing.targetCurrency,
      /** Customer rate (margin included), or null for same-currency transfers. */
      rate: crossCurrency ? formatRate(pricing.customerRate, 4) : null,
      marginBps: crossCurrency ? pricing.marginBps : 0,
      blocker: await findBlocker(ctx, plan, pricing),
    };
  },
});

// ---------------------------------------------------------------------------
// Step 3 — lock the price (stored quote) and mint the idempotency key
// ---------------------------------------------------------------------------

const complianceFields = {
  purpose: z.enum(TRANSFER_PURPOSES, 'Choose the purpose of this transfer').optional(),
  sourceOfFunds: z.enum(SOURCES_OF_FUNDS, 'Choose the source of funds').optional(),
  note: z.string().trim().max(140, 'Keep the note under 140 characters').optional(),
};

export const lockQuoteAction = createAction({
  schema: recipientFields
    .extend({ amount: amountText, ...complianceFields })
    .superRefine(refineRecipient),
  roles: ['CUSTOMER'],
  handler: async (input, ctx) => {
    const wallet = await getWallet(ctx, input.senderWalletId);
    const amount = parseAmount(input.amount, wallet.currency);
    const recipient = toRecipientInput(input);

    const preview = await previewTransfer(ctx, {
      senderWalletId: input.senderWalletId,
      recipient,
      amount,
    }).catch(remapRecipientError);
    const countryName = await assertPlanMatches(input, preview.plan);
    if (preview.plan.international && (!input.purpose || !input.sourceOfFunds)) {
      throw new AppError(
        'VALIDATION',
        'International transfers need a purpose and a source of funds',
        {
          fieldErrors: {
            ...(input.purpose ? {} : { purpose: ['Choose the purpose of this transfer'] }),
            ...(input.sourceOfFunds ? {} : { sourceOfFunds: ['Choose the source of funds'] }),
          },
        },
      );
    }
    const blocker = await findBlocker(ctx, preview.plan, preview.pricing);
    if (blocker) throw new AppError(blocker.code, blocker.message);

    // Stores the quote: fee and FX rate are now fixed until it expires.
    const quoted = await quoteTransfer(ctx, {
      senderWalletId: input.senderWalletId,
      recipient,
      amount,
    });
    if (!quoted.quoteId || !quoted.expiresAt) {
      throw new AppError('INTERNAL', 'The quote could not be created. Please try again.');
    }
    // Show exactly what was stored — that is what `createTransfer` will execute.
    const quote = await getQuote(ctx, quoted.quoteId);
    const crossCurrency = quote.sourceCurrency !== quote.targetCurrency;
    return {
      plan: await summarisePlan(quoted.plan, countryName),
      quoteId: quote.id,
      /** Seconds the price stays locked, measured on the server's clock. */
      ttlSeconds: secondsUntil(quote.expiresAt),
      /** One key per locked quote: a double click or a retry can never pay twice. */
      idempotencyKey: randomUUID(),
      sendAmount: quote.sendAmount,
      feeAmount: quote.feeAmount,
      totalDebit: quote.totalDebit,
      receiveAmount: quote.receiveAmount,
      sourceCurrency: quote.sourceCurrency,
      targetCurrency: quote.targetCurrency,
      rate: crossCurrency ? formatRate(parseRate(quote.customerRate), 4) : null,
      marginBps: crossCurrency ? quote.marginBps : 0,
      purpose: input.purpose ?? null,
      sourceOfFunds: input.sourceOfFunds ?? null,
      note: input.note ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// Step 4 — confirm: the only step that moves money
// ---------------------------------------------------------------------------

export const confirmTransferAction = createAction({
  schema: recipientFields
    .extend({
      /** Send amount in minor units, exactly as quoted. */
      amountMinor: z.string().regex(/^\d{1,18}$/),
      quoteId: z.uuid(),
      idempotencyKey: z.uuid(),
      ...complianceFields,
    })
    .superRefine(refineRecipient),
  roles: ['CUSTOMER'],
  handler: async (input, ctx) => {
    const recipient = toRecipientInput(input);
    const plan = await planTransfer(ctx, {
      senderWalletId: input.senderWalletId,
      recipient,
    }).catch(remapRecipientError);
    await assertPlanMatches(input, plan);

    const { transfer, replayed } = await createTransfer(ctx, {
      senderWalletId: input.senderWalletId,
      recipient,
      amount: parseMinor(input.amountMinor),
      quoteId: input.quoteId,
      idempotencyKey: input.idempotencyKey,
      purpose: input.purpose,
      sourceOfFunds: input.sourceOfFunds,
      note: input.note,
    }).catch((error: unknown) => {
      // A dead quote is reported on `quoteId` so the wizard offers a new one instead of a retry.
      if (error instanceof AppError && error.code === 'QUOTE_EXPIRED') {
        throw new AppError(error.code, error.message, {
          fieldErrors: { quoteId: [error.message] },
        });
      }
      throw error;
    });
    return {
      id: transfer.id,
      reference: transfer.reference,
      status: transfer.status,
      type: transfer.type,
      deliveryMethod: transfer.deliveryMethod,
      failureReason: transfer.failureReason,
      recipientName: transfer.recipientName,
      totalDebit: transfer.totalDebit,
      sourceCurrency: transfer.sourceCurrency,
      receiveAmount: transfer.receiveAmount,
      targetCurrency: transfer.targetCurrency,
      replayed,
    };
  },
  revalidate: ['/app', '/app/wallets', '/app/transfers', '/app/send'],
});
