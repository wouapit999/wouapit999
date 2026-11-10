'use server';

import { z } from 'zod';

import { checkbox, reasonField } from '@/components/admin/helpers';
import { createAction } from '@/lib/server-action';
import { setFxRate } from '@/server/fx';

/**
 * Manual FX override (`fx:write`): sets the mid rate and margin of a pair, optionally the
 * inverse pair too. The reason is mandatory here and is stored in the audit row next to the
 * before / after values.
 */
export const setFxRateAction = createAction({
  schema: z.object({
    baseCurrency: z.string().trim().toUpperCase().length(3, 'Choose a currency'),
    quoteCurrency: z.string().trim().toUpperCase().length(3, 'Choose a currency'),
    midRate: z.string().trim().min(1, 'Enter the mid rate').max(30),
    marginBps: z.coerce
      .number('Enter basis points')
      .int('Whole basis points only')
      .min(0)
      .max(2000, 'At most 2000 bps (20%)'),
    updateInverse: checkbox,
    reason: reasonField('Explain the override'),
  }),
  permission: 'fx:write',
  handler: async (input, ctx) => {
    const saved = await setFxRate(ctx, input);
    return { base: input.baseCurrency, quote: input.quoteCurrency, pairs: saved.length };
  },
  revalidate: ['/admin/fx', '/admin/treasury'],
  redirectTo: (result) =>
    `/admin/fx?base=${result.base}&saved=${result.base}-${result.quote}${result.pairs > 1 ? '&inverse=1' : ''}`,
});
