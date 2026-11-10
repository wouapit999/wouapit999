'use server';

import { createAction } from '@/lib/server-action';
import { profileSchema, updateProfile } from '@/server/auth';

/** Updates the signed-in customer's own profile (the service audits before / after). */
export const updateProfileAction = createAction({
  schema: profileSchema,
  roles: ['CUSTOMER'],
  handler: (input, ctx) => updateProfile(ctx, input),
  successMessage: 'Profile saved',
  revalidate: ['/app/profile', '/app'],
});
