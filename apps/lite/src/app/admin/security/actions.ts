'use server';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import {
  beginMfaEnrolment,
  changePassword,
  confirmMfaEnrolment,
  disableMfa,
  passwordSchema,
} from '@/server/auth';
import { getSession } from '@/server/auth/session';
import { STAFF_ROLES } from '@/server/rbac';

const PATH = '/admin/security';
const totp = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'));

/** Change the signed-in staff member's own password; other sessions are signed out. */
export const changePasswordAction = createAction({
  schema: z
    .object({
      currentPassword: z.string().min(1, 'Enter your current password').max(128),
      newPassword: passwordSchema,
      confirmPassword: z.string().max(128),
    })
    .refine((value) => value.newPassword === value.confirmPassword, {
      message: 'The two passwords do not match',
      path: ['confirmPassword'],
    }),
  roles: STAFF_ROLES,
  handler: async (input, ctx) => {
    const session = await getSession();
    await changePassword(
      ctx,
      { currentPassword: input.currentPassword, newPassword: input.newPassword },
      session?.sessionId,
    );
  },
  successMessage: 'Password changed. Your other sessions were signed out.',
  revalidate: [PATH],
});

/** Start two-factor enrolment: returns the secret once so it can be added to an authenticator. */
export const beginMfaAction = createAction({
  schema: z.object({}),
  roles: STAFF_ROLES,
  handler: (_input, ctx) => beginMfaEnrolment(ctx),
});

export const confirmMfaAction = createAction({
  schema: z.object({ code: totp }),
  roles: STAFF_ROLES,
  handler: (input, ctx) => confirmMfaEnrolment(ctx, input.code),
  successMessage: 'Two-factor authentication is on',
  revalidate: [PATH, '/admin/users'],
});

export const disableMfaAction = createAction({
  schema: z.object({
    password: z.string().min(1, 'Enter your password').max(128),
    code: totp,
  }),
  roles: STAFF_ROLES,
  handler: (input, ctx) => disableMfa(ctx, input),
  successMessage: 'Two-factor authentication is off',
  revalidate: [PATH, '/admin/users'],
});
