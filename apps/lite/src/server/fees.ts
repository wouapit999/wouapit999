import { z } from 'zod';

import type { TransferType } from '@/generated/prisma/enums';

import { writeAudit } from './audit';
import { type DbOrTx, db } from './db';
import { AppError, isUniqueViolation } from './errors';
import { bpsOf, isCurrencyCode } from './money';
import { type ActionContext, assertPermission } from './rbac';

/**
 * Configurable fee rules: fee = fixed + amount × bps, clamped to [minFee, maxFee (cap)], charged
 * in the source currency on top of the send amount. The most specific active rule wins:
 * transfer type match > source country > target country > priority.
 */

export const TRANSFER_TYPES = ['W2W', 'W2M', 'W2A', 'INTERNATIONAL', 'TOPUP'] as const;

/** Applied when no rule matches (top-ups are free by default). */
export const DEFAULT_FEE_BPS = 100;

export interface FeeRuleLike {
  readonly id: string | null;
  readonly fixedAmount: bigint;
  readonly percentBps: number;
  readonly minFee: bigint | null;
  readonly maxFee: bigint | null;
}

export interface FeeQuery {
  readonly type: TransferType;
  readonly currency: string;
  readonly sourceCountry: string;
  readonly targetCountry: string;
}

/** Pure fee calculation for a rule. */
export function calculateFee(rule: FeeRuleLike, amount: bigint): bigint {
  if (amount <= 0n) return 0n;
  let fee = rule.fixedAmount + bpsOf(amount, rule.percentBps, 'half_up');
  if (rule.minFee !== null && fee < rule.minFee) fee = rule.minFee;
  if (rule.maxFee !== null && fee > rule.maxFee) fee = rule.maxFee;
  return fee;
}

/** Picks the rule that applies to a transfer, or the built-in default. */
export async function resolveFeeRule(client: DbOrTx, query: FeeQuery): Promise<FeeRuleLike> {
  const candidates = await client.feeRule.findMany({
    where: {
      active: true,
      currency: query.currency,
      AND: [
        { OR: [{ transferType: query.type }, { transferType: null }] },
        { OR: [{ sourceCountry: query.sourceCountry }, { sourceCountry: null }] },
        { OR: [{ targetCountry: query.targetCountry }, { targetCountry: null }] },
      ],
    },
  });
  const specificity = (rule: (typeof candidates)[number]): number =>
    (rule.transferType ? 4 : 0) + (rule.sourceCountry ? 2 : 0) + (rule.targetCountry ? 1 : 0);
  const best = candidates.sort(
    (a, b) =>
      specificity(b) - specificity(a) ||
      b.priority - a.priority ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
  if (best) return best;
  return {
    id: null,
    fixedAmount: 0n,
    percentBps: query.type === 'TOPUP' ? 0 : DEFAULT_FEE_BPS,
    minFee: null,
    maxFee: null,
  };
}

export async function quoteFee(
  client: DbOrTx,
  query: FeeQuery,
  amount: bigint,
): Promise<{ fee: bigint; ruleId: string | null }> {
  const rule = await resolveFeeRule(client, query);
  return { fee: calculateFee(rule, amount), ruleId: rule.id };
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

const minorString = z.string().regex(/^\d{1,18}$/, 'Whole number of minor units');
const optionalCountry = z.string().trim().toUpperCase().length(2).optional();

export const feeRuleSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(2).max(120),
    transferType: z.enum(TRANSFER_TYPES).optional(),
    currency: z.string().trim().toUpperCase().refine(isCurrencyCode, 'Unsupported currency'),
    sourceCountry: optionalCountry,
    targetCountry: optionalCountry,
    /** Minor units of `currency`, as integer strings. */
    fixedAmount: minorString.default('0'),
    percentBps: z.coerce.number().int().min(0).max(5000),
    minFee: minorString.optional(),
    maxFee: minorString.optional(),
    priority: z.coerce.number().int().min(0).max(1000).default(0),
    active: z.boolean().default(true),
  })
  .refine(
    (value) => !value.minFee || !value.maxFee || BigInt(value.minFee) <= BigInt(value.maxFee),
    { message: 'Minimum fee cannot exceed the cap', path: ['minFee'] },
  );
export type FeeRuleInput = z.input<typeof feeRuleSchema>;

export async function listFeeRules(ctx: ActionContext) {
  assertPermission(ctx, 'fees:read');
  return db.feeRule.findMany({
    orderBy: [{ currency: 'asc' }, { transferType: 'asc' }, { priority: 'desc' }],
  });
}

/** Creates or updates a fee rule. Requires `fees:write`; audited with before/after. */
export async function saveFeeRule(ctx: ActionContext, input: FeeRuleInput) {
  assertPermission(ctx, 'fees:write');
  const data = feeRuleSchema.parse(input);
  const values = {
    name: data.name,
    transferType: data.transferType ?? null,
    currency: data.currency,
    sourceCountry: data.sourceCountry ?? null,
    targetCountry: data.targetCountry ?? null,
    fixedAmount: BigInt(data.fixedAmount),
    percentBps: data.percentBps,
    minFee: data.minFee ? BigInt(data.minFee) : null,
    maxFee: data.maxFee ? BigInt(data.maxFee) : null,
    priority: data.priority,
    active: data.active,
  };
  try {
    return await db.$transaction(async (tx) => {
      if (data.id) {
        const before = await tx.feeRule.findUnique({ where: { id: data.id } });
        if (!before) throw new AppError('NOT_FOUND', 'Fee rule not found');
        const after = await tx.feeRule.update({ where: { id: data.id }, data: values });
        await writeAudit(tx, ctx, {
          action: 'fee_rule.update',
          resourceType: 'fee_rule',
          resourceId: after.id,
          before,
          after,
        });
        return after;
      }
      const created = await tx.feeRule.create({
        data: { ...values, code: `custom-${crypto.randomUUID()}` },
      });
      await writeAudit(tx, ctx, {
        action: 'fee_rule.create',
        resourceType: 'fee_rule',
        resourceId: created.id,
        after: created,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError('CONFLICT', 'A fee rule with this code already exists');
    throw error;
  }
}

/** Activates / deactivates a rule (rules are never deleted, to keep quotes explainable). */
export async function setFeeRuleActive(ctx: ActionContext, id: string, active: boolean) {
  assertPermission(ctx, 'fees:write');
  return db.$transaction(async (tx) => {
    const before = await tx.feeRule.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Fee rule not found');
    const after = await tx.feeRule.update({ where: { id }, data: { active } });
    await writeAudit(tx, ctx, {
      action: active ? 'fee_rule.activate' : 'fee_rule.deactivate',
      resourceType: 'fee_rule',
      resourceId: id,
      before: { active: before.active },
      after: { active },
    });
    return after;
  });
}
