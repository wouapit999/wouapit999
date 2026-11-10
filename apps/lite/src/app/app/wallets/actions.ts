'use server';

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import { AppError } from '@/server/errors';
import {
  getLinkedAccount,
  linkAccountSchema,
  linkMobileMoneyAccount,
  previewTopUp,
  unlinkAccount,
} from '@/server/linked-accounts';
import { parseMinor, parseMoney } from '@/server/money';
import type { ActionContext } from '@/server/rbac';
import { topUpWallet } from '@/server/transfers';
import { getWallet } from '@/server/wallets';

/**
 * Wallet actions of the customer area. Every action authenticates (`createAction`), is limited
 * to role CUSTOMER, validates its input with Zod and calls a service that re-checks ownership.
 */

const pad = (value: number): string => value.toString().padStart(2, '0');

/** Re-reads the balances from the ledger (they are never cached, this just redraws the page). */
export const refreshBalancesAction = createAction({
  schema: z.object({}),
  roles: ['CUSTOMER'],
  handler: () => Promise.resolve(new Date()),
  successMessage: (now) =>
    `Balances are up to date as of ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC.`,
  revalidate: ['/app/wallets', '/app'],
});

/** Links the customer's own mobile-money account after the operator validated it. */
export const linkAccountAction = createAction({
  schema: linkAccountSchema,
  roles: ['CUSTOMER'],
  handler: (input, ctx) => linkMobileMoneyAccount(ctx, input),
  successMessage: (account) =>
    `${account.providerName} account ${account.accountNumber} linked — holder: ${account.accountName}.`,
  revalidate: ['/app/wallets'],
});

export const unlinkAccountAction = createAction({
  schema: z.object({ id: z.uuid() }),
  roles: ['CUSTOMER'],
  handler: (input, ctx) => unlinkAccount(ctx, input.id),
  successMessage: 'Account unlinked',
  revalidate: ['/app/wallets'],
});

// ---------------------------------------------------------------------------
// Top-up: review, then confirm
// ---------------------------------------------------------------------------

const topUpSourceSchema = z
  .object({
    walletId: z.uuid('Choose the wallet to top up'),
    /** A linked account id, or `OTHER` to type a provider and number. */
    source: z.union([z.uuid(), z.literal('OTHER')], 'Choose where the money comes from'),
    providerId: z.uuid('Choose a mobile-money provider').optional(),
    accountNumber: z.string().trim().max(20, 'This number is too long').optional(),
    amount: z.string().trim().min(1, 'Enter an amount').max(24),
  })
  .superRefine((value, ctx) => {
    if (value.source !== 'OTHER') return;
    if (!value.providerId) {
      ctx.addIssue({
        code: 'custom',
        path: ['providerId'],
        message: 'Choose a mobile-money provider',
      });
    }
    if ((value.accountNumber ?? '').replace(/\D/g, '').length < 8) {
      ctx.addIssue({
        code: 'custom',
        path: ['accountNumber'],
        message: 'Enter the full mobile-money number',
      });
    }
  });

/** Resolves the paying account: a linked account the customer owns, or the typed number. */
async function resolveSource(
  ctx: ActionContext,
  input: z.infer<typeof topUpSourceSchema>,
): Promise<{ providerId: string; accountNumber: string }> {
  if (input.source === 'OTHER') {
    return { providerId: input.providerId ?? '', accountNumber: input.accountNumber ?? '' };
  }
  const linked = await getLinkedAccount(ctx, input.source);
  return { providerId: linked.providerId, accountNumber: linked.accountNumber };
}

function amountFor(text: string, currency: string): bigint {
  try {
    return parseMoney(text, currency);
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError('VALIDATION', error.message, { fieldErrors: { amount: [error.message] } });
    }
    throw error;
  }
}

/**
 * Step 1: validates the wallet, the paying account (through the operator's connector) and the
 * amount, and mints the idempotency key of this submission. Moves no money.
 */
export const reviewTopUpAction = createAction({
  schema: topUpSourceSchema,
  roles: ['CUSTOMER'],
  handler: async (input, ctx) => {
    const wallet = await getWallet(ctx, input.walletId);
    const source = await resolveSource(ctx, input);
    const preview = await previewTopUp(ctx, {
      walletId: wallet.id,
      providerId: source.providerId,
      accountNumber: source.accountNumber,
      amount: amountFor(input.amount, wallet.currency),
    });
    return { ...preview, idempotencyKey: randomUUID() };
  },
});

const confirmTopUpSchema = z.object({
  walletId: z.uuid(),
  providerId: z.uuid(),
  accountNumber: z.string().trim().min(8).max(20),
  /** Minor units, exactly as reviewed. */
  amountMinor: z.string().regex(/^\d{1,18}$/),
  idempotencyKey: z.uuid(),
});

/**
 * Step 2: asks the operator to collect the money and credits the wallet when it confirms. The
 * idempotency key minted at review makes a double click or a retry harmless.
 */
export const confirmTopUpAction = createAction({
  schema: confirmTopUpSchema,
  roles: ['CUSTOMER'],
  handler: async (input, ctx) => {
    const { transfer, replayed } = await topUpWallet(ctx, {
      walletId: input.walletId,
      providerId: input.providerId,
      accountNumber: input.accountNumber,
      amount: parseMinor(input.amountMinor),
      idempotencyKey: input.idempotencyKey,
    });
    return { id: transfer.id, replayed };
  },
  revalidate: ['/app', '/app/wallets', '/app/transfers'],
  redirectTo: (result) => `/app/transfers/${result.id}?${result.replayed ? 'replayed=1' : 'new=1'}`,
});
