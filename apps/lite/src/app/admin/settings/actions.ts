'use server';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import { AppError } from '@/server/errors';
import { SETTING_KEYS, type SettingKey, setSetting } from '@/server/settings';

/**
 * Update one platform setting (`settings:write`). The value is typed as JSON and validated by
 * the setting's own Zod schema in the service, which also audits before / after.
 */
export const setSettingAction = createAction({
  schema: z.object({
    key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]),
    value: z.string().min(1, 'Enter a value').max(4000),
  }),
  permission: 'settings:write',
  handler: async (input, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.value);
    } catch {
      throw new AppError('VALIDATION', 'The value is not valid JSON', {
        fieldErrors: {
          value: ['Not valid JSON — text needs double quotes, e.g. "smile_identity"'],
        },
      });
    }
    await setSetting(ctx, input.key, parsed);
    return { key: input.key };
  },
  successMessage: (result) => `${result.key} saved`,
  revalidate: ['/admin/settings', '/status'],
});
