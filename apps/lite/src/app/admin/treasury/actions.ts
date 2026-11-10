'use server';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import { isCurrencyCode, parseMoney } from '@/server/money';
import { moveFloat, setTreasuryThreshold } from '@/server/treasury';

const currencyField = z.string().trim().toUpperCase().refine(isCurrencyCode, 'Choose a currency');

/** Low / critical liquidity thresholds of a float account (`treasury:write`). */
export const setThresholdAction = createAction({
  schema: z.object({
    currency: currencyField,
    lowBalance: z.string().trim().min(1, 'Enter the low level').max(30),
    criticalBalance: z.string().trim().min(1, 'Enter the critical level').max(30),
  }),
  permission: 'treasury:write',
  handler: async (input, ctx) => {
    await setTreasuryThreshold(ctx, {
      currency: input.currency,
      lowBalance: parseMoney(input.lowBalance, input.currency).toString(),
      criticalBalance: parseMoney(input.criticalBalance, input.currency).toString(),
    });
    return { currency: input.currency };
  },
  successMessage: (result) => `Thresholds saved for ${result.currency}`,
  revalidate: ['/admin/treasury', '/admin/reports'],
});

/**
 * Manual funding / rebalancing of a float account (`treasury:write`): one balanced ADJUSTMENT
 * journal (float against treasury capital). The four-eyes note — who approved the movement —
 * is mandatory and is stored with the reason in the journal description and the audit row.
 */
export const moveFloatAction = createAction({
  schema: z.object({
    currency: currencyField,
    direction: z.enum(['FUND', 'WITHDRAW'], 'Choose a direction'),
    amount: z.string().trim().min(1, 'Enter an amount').max(30),
    reason: z.string().trim().min(5, 'Describe the movement').max(170),
    approvedBy: z
      .string()
      .trim()
      .min(3, 'Name the second person who approved this movement')
      .max(100),
  }),
  permission: 'treasury:write',
  handler: async (input, ctx) => {
    const result = await moveFloat(ctx, {
      currency: input.currency,
      direction: input.direction,
      amount: parseMoney(input.amount, input.currency),
      reason: `${input.reason} [four-eyes: ${input.approvedBy}]`,
    });
    return { currency: input.currency, direction: input.direction, journalId: result.journalId };
  },
  successMessage: (result) =>
    `${result.direction === 'FUND' ? 'Funding' : 'Withdrawal'} journal posted for ${result.currency}`,
  revalidate: ['/admin/treasury', '/admin/reports'],
});
