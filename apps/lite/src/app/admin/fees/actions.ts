'use server';

import { z } from 'zod';

import { checkbox } from '@/components/admin/helpers';
import { createAction } from '@/lib/server-action';
import { TRANSFER_TYPES, saveFeeRule, setFeeRuleActive } from '@/server/fees';
import { isCurrencyCode, parseMoney } from '@/server/money';

const optionalCountry = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Choose a country')
  .optional();

/**
 * Create or update a fee rule (`fees:write`). Amounts are typed in major units ("1.50") and
 * converted to minor units with `parseMoney` — never floats.
 */
export const saveFeeRuleAction = createAction({
  schema: z.object({
    id: z.uuid().optional(),
    name: z.string().trim().min(2, 'Name the rule').max(120),
    transferType: z.enum(TRANSFER_TYPES).optional(),
    currency: z.string().trim().toUpperCase().refine(isCurrencyCode, 'Choose a currency'),
    sourceCountry: optionalCountry,
    targetCountry: optionalCountry,
    fixedAmount: z.string().max(30).optional(),
    percentBps: z.coerce
      .number('Enter basis points')
      .int('Whole basis points only')
      .min(0)
      .max(5000, 'At most 5000 bps (50%)'),
    minFee: z.string().max(30).optional(),
    maxFee: z.string().max(30).optional(),
    priority: z.coerce.number().int().min(0).max(1000).default(0),
    active: checkbox,
  }),
  permission: 'fees:write',
  handler: async (input, ctx) => {
    const minor = (text: string | undefined): string | undefined =>
      text === undefined ? undefined : parseMoney(text, input.currency).toString();
    const rule = await saveFeeRule(ctx, {
      id: input.id,
      name: input.name,
      transferType: input.transferType,
      currency: input.currency,
      sourceCountry: input.sourceCountry,
      targetCountry: input.targetCountry,
      fixedAmount: minor(input.fixedAmount) ?? '0',
      percentBps: input.percentBps,
      minFee: minor(input.minFee),
      maxFee: minor(input.maxFee),
      priority: input.priority,
      active: input.active,
    });
    return { id: rule.id, created: input.id === undefined };
  },
  revalidate: ['/admin/fees'],
  redirectTo: (result) => `/admin/fees?saved=${result.created ? 'created' : 'updated'}`,
});

export const setFeeRuleActiveAction = createAction({
  schema: z.object({ id: z.uuid(), active: z.enum(['true', 'false']) }),
  permission: 'fees:write',
  handler: async (input, ctx) => {
    const rule = await setFeeRuleActive(ctx, input.id, input.active === 'true');
    return { id: rule.id, active: rule.active };
  },
  successMessage: (result) => (result.active ? 'Rule activated' : 'Rule deactivated'),
  revalidate: ['/admin/fees'],
});
