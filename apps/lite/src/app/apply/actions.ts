'use server';

import { z } from 'zod';

import { createPublicAction } from '@/lib/server-action';
import { applyForPartner, partnerApplicationSchema } from '@/server/partners';

/**
 * Public self-serve partner application. No session: the request is validated with Zod, rate
 * limited per IP by the service and creates a PENDING partner plus a PARTNER login. Nothing is
 * usable (no wallet, no API key, no webhook) until an administrator approves the application.
 */

const applicationFormSchema = partnerApplicationSchema
  .extend({
    confirmPassword: z.string().max(128),
    authorised: z.literal('on', 'Confirm that you may apply for this business'),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'The two passwords do not match',
    path: ['confirmPassword'],
  });

export const applyForPartnerAction = createPublicAction({
  schema: applicationFormSchema,
  handler: async (input, meta) => {
    const { confirmPassword: _confirm, authorised: _authorised, ...application } = input;
    await applyForPartner(application, meta);
  },
  redirectTo: '/apply/submitted',
});
