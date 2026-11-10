import type { KycTier } from '@/generated/prisma/enums';

import { type DbOrTx, db } from '../db';
import { AppError } from '../errors';
import { fromUsdMinor } from '../fx';
import { formatMoney, toBigInt } from '../money';
import { type ActionContext, hasPermission } from '../rbac';
import { getSetting } from '../settings';

/**
 * Transfer limits per KYC tier, expressed in USD cents (setting `kyc.limits`) so they apply
 * uniformly across currencies. Usage counts every outgoing transfer that is not failed,
 * rejected or reversed; top-ups are not limited.
 */

export interface TierLimits {
  readonly perTransaction: bigint;
  readonly daily: bigint;
  readonly monthly: bigint;
  readonly international: boolean;
}

export async function getTierLimits(client: DbOrTx = db): Promise<Record<KycTier, TierLimits>> {
  const raw = await getSetting('kyc.limits', client);
  const convert = (tier: (typeof raw)[KycTier]): TierLimits => ({
    perTransaction: BigInt(tier.perTransaction),
    daily: BigInt(tier.daily),
    monthly: BigInt(tier.monthly),
    international: tier.international,
  });
  return { TIER_0: convert(raw.TIER_0), TIER_1: convert(raw.TIER_1), TIER_2: convert(raw.TIER_2) };
}

export interface LimitUsage {
  readonly tier: KycTier;
  readonly limits: TierLimits;
  /** USD cents sent today (UTC) / this calendar month (UTC). */
  readonly usedToday: bigint;
  readonly usedThisMonth: bigint;
  readonly remainingToday: bigint;
  readonly remainingThisMonth: bigint;
}

interface UsageRow {
  today: bigint | null;
  month: bigint | null;
}

const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const startOfUtcMonth = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Limits and current usage of a user. Call inside the transfer transaction for consistency. */
export async function getLimitUsage(
  client: DbOrTx,
  userId: string,
  tier: KycTier,
  now: Date = new Date(),
): Promise<LimitUsage> {
  const limits = (await getTierLimits(client))[tier];
  const dayStart = startOfUtcDay(now);
  const monthStart = startOfUtcMonth(now);
  const rows = await client.$queryRaw<UsageRow[]>`
    SELECT
      COALESCE(SUM(send_amount_usd) FILTER (WHERE created_at >= ${dayStart}), 0) AS today,
      COALESCE(SUM(send_amount_usd), 0) AS month
    FROM transfers
    WHERE sender_user_id = ${userId}::uuid
      AND type <> 'TOPUP'
      AND status IN ('PROCESSING', 'ON_HOLD', 'COMPLETED')
      AND created_at >= ${monthStart}
      AND created_at <= ${now}`;
  const usedToday = toBigInt(rows[0]?.today);
  const usedThisMonth = toBigInt(rows[0]?.month);
  const remaining = (limit: bigint, used: bigint): bigint => (limit > used ? limit - used : 0n);
  return {
    tier,
    limits,
    usedToday,
    usedThisMonth,
    remainingToday: remaining(limits.daily, usedToday),
    remainingThisMonth: remaining(limits.monthly, usedThisMonth),
  };
}

const usd = (cents: bigint): string => formatMoney(cents, 'USD');

/**
 * Throws `LIMIT_EXCEEDED` / `KYC_REQUIRED` when a transfer of `amountUsd` (USD cents) would
 * break the sender's tier limits. Must run after the sender's wallet account is locked.
 */
export async function assertWithinLimits(
  client: DbOrTx,
  input: { userId: string; tier: KycTier; amountUsd: bigint; international: boolean; now?: Date },
): Promise<LimitUsage> {
  const usage = await getLimitUsage(client, input.userId, input.tier, input.now);
  const { limits } = usage;
  if (input.international && !limits.international) {
    throw new AppError('KYC_REQUIRED', 'Verify your identity to send money abroad', {
      details: { tier: input.tier },
    });
  }
  if (input.amountUsd > limits.perTransaction) {
    throw new AppError(
      input.tier === 'TIER_2' ? 'LIMIT_EXCEEDED' : 'KYC_REQUIRED',
      `This exceeds your per-transfer limit of about ${usd(limits.perTransaction)}`,
      { details: { limit: 'perTransaction', tier: input.tier } },
    );
  }
  if (input.amountUsd > usage.remainingToday) {
    throw new AppError(
      'LIMIT_EXCEEDED',
      `This exceeds your daily limit of about ${usd(limits.daily)}`,
      {
        details: { limit: 'daily', tier: input.tier },
      },
    );
  }
  if (input.amountUsd > usage.remainingThisMonth) {
    throw new AppError(
      'LIMIT_EXCEEDED',
      `This exceeds your monthly limit of about ${usd(limits.monthly)}`,
      {
        details: { limit: 'monthly', tier: input.tier },
      },
    );
  }
  return usage;
}

/** Limits and usage for display: the signed-in user's own, or any user for staff (`users:read`). */
export async function getLimitOverview(
  ctx: ActionContext,
  userId?: string,
  displayCurrency?: string,
) {
  const targetId = userId ?? (ctx.actor.type === 'USER' ? ctx.actor.id : undefined);
  if (!targetId) throw new AppError('VALIDATION', 'userId is required');
  const isSelf = ctx.actor.type === 'USER' && ctx.actor.id === targetId;
  if (!isSelf && !hasPermission(ctx, 'users:read')) throw new AppError('FORBIDDEN', 'Not allowed');
  const user = await db.user.findUnique({
    where: { id: targetId },
    select: { kycTier: true, country: { select: { currency: true } } },
  });
  if (!user) throw new AppError('NOT_FOUND', 'User not found');
  const usage = await getLimitUsage(db, targetId, user.kycTier);
  const currency = displayCurrency ?? user.country?.currency ?? 'USD';
  const local = async (cents: bigint) => fromUsdMinor(db, cents, currency);
  return {
    ...usage,
    allTiers: await getTierLimits(),
    currency,
    local: {
      perTransaction: await local(usage.limits.perTransaction),
      daily: await local(usage.limits.daily),
      monthly: await local(usage.limits.monthly),
      remainingToday: await local(usage.remainingToday),
      remainingThisMonth: await local(usage.remainingThisMonth),
    },
  };
}
