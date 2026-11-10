import { z } from 'zod';

import { writeAudit } from './audit';
import { db, withTransaction } from './db';
import { AppError } from './errors';
import { getSystemAccountIds, lockAccounts, postJournal } from './ledger';
import { formatMoney, isCurrencyCode } from './money';
import { type ActionContext, actorUserId, assertPermission } from './rbac';

/**
 * Treasury operations (phase 7): low-liquidity thresholds on the settlement / float accounts
 * and float funding. The treasury dashboard itself lives in `@/server/reports`.
 */

export type LiquidityLevel = 'OK' | 'LOW' | 'CRITICAL';

export function liquidityLevel(
  balance: bigint,
  threshold: { lowBalance: bigint; criticalBalance: bigint } | null,
): LiquidityLevel {
  if (!threshold) return 'OK';
  if (balance <= threshold.criticalBalance) return 'CRITICAL';
  if (balance <= threshold.lowBalance) return 'LOW';
  return 'OK';
}

const minorString = z.string().regex(/^\d{1,18}$/, 'Whole number of minor units');

export const thresholdSchema = z
  .object({
    currency: z.string().trim().toUpperCase().refine(isCurrencyCode, 'Unsupported currency'),
    lowBalance: minorString,
    criticalBalance: minorString,
  })
  .refine((value) => BigInt(value.criticalBalance) <= BigInt(value.lowBalance), {
    message: 'The critical level cannot be above the low level',
    path: ['criticalBalance'],
  });

/** Sets the low / critical liquidity thresholds of a currency's float account. `treasury:write`. */
export async function setTreasuryThreshold(
  ctx: ActionContext,
  input: z.input<typeof thresholdSchema>,
) {
  assertPermission(ctx, 'treasury:write');
  const data = thresholdSchema.parse(input);
  return db.$transaction(async (tx) => {
    const accountId = (await getSystemAccountIds(tx, data.currency, ['SETTLEMENT'])).SETTLEMENT;
    const before = await tx.treasuryThreshold.findUnique({ where: { accountId } });
    const values = {
      lowBalance: BigInt(data.lowBalance),
      criticalBalance: BigInt(data.criticalBalance),
      updatedById: actorUserId(ctx),
    };
    const after = await tx.treasuryThreshold.upsert({
      where: { accountId },
      create: { accountId, ...values },
      update: values,
    });
    await writeAudit(tx, ctx, {
      action: 'treasury.threshold',
      resourceType: 'ledger_account',
      resourceId: accountId,
      before: before
        ? { lowBalance: before.lowBalance, criticalBalance: before.criticalBalance }
        : null,
      after: {
        currency: data.currency,
        lowBalance: after.lowBalance,
        criticalBalance: after.criticalBalance,
      },
    });
    return after;
  });
}

export const floatMovementSchema = z.object({
  currency: z.string().trim().toUpperCase().refine(isCurrencyCode, 'Unsupported currency'),
  /** Minor units. */
  amount: z.bigint().positive(),
  direction: z.enum(['FUND', 'WITHDRAW']),
  reason: z.string().trim().min(5, 'Describe the movement').max(300),
});

/**
 * Records treasury funding (or withdrawal) of a float account as a balanced ADJUSTMENT journal:
 * FUND = DR settlement / CR treasury funding; WITHDRAW is the mirror. `treasury:write`.
 */
export async function moveFloat(
  ctx: ActionContext,
  input: z.infer<typeof floatMovementSchema>,
  options: { now?: Date } = {},
) {
  assertPermission(ctx, 'treasury:write');
  const data = floatMovementSchema.parse(input);
  return withTransaction(async (tx) => {
    const accounts = await getSystemAccountIds(tx, data.currency, ['SETTLEMENT', 'CAPITAL']);
    const locked = await lockAccounts(tx, [accounts.SETTLEMENT, accounts.CAPITAL]);
    const float = locked.get(accounts.SETTLEMENT)?.balance ?? 0n;
    if (data.direction === 'WITHDRAW' && float < data.amount) {
      throw new AppError(
        'INSUFFICIENT_FUNDS',
        `The float only holds ${formatMoney(float, data.currency)}`,
      );
    }
    const funding = data.direction === 'FUND';
    const journal = await postJournal(tx, {
      kind: 'ADJUSTMENT',
      description: `${funding ? 'Float funding' : 'Float withdrawal'} — ${data.reason}`,
      createdById: actorUserId(ctx),
      postedAt: options.now,
      lines: [
        {
          accountId: accounts.SETTLEMENT,
          direction: funding ? 'DEBIT' : 'CREDIT',
          amount: data.amount,
        },
        {
          accountId: accounts.CAPITAL,
          direction: funding ? 'CREDIT' : 'DEBIT',
          amount: data.amount,
        },
      ],
    });
    await writeAudit(tx, ctx, {
      action: funding ? 'treasury.float.fund' : 'treasury.float.withdraw',
      resourceType: 'ledger_account',
      resourceId: accounts.SETTLEMENT,
      at: options.now,
      after: {
        currency: data.currency,
        amount: data.amount,
        reason: data.reason,
        journalId: journal.journalId,
        balance: journal.balances.get(accounts.SETTLEMENT),
      },
    });
    return {
      journalId: journal.journalId,
      balance: journal.balances.get(accounts.SETTLEMENT) ?? 0n,
    };
  });
}
