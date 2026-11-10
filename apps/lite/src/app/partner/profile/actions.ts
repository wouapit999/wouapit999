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
import { revokeOtherOwnSessions } from '@/server/auth/own-sessions';
import { getSession } from '@/server/auth/session';
import { AppError } from '@/server/errors';

/**
 * Security actions of the signed-in partner user: password, TOTP two-factor and sessions. Every
 * service call acts on the actor's own account; secrets are never echoed back or logged.
 */

const ROLES = ['PARTNER'] as const;
const PATH = '/partner/profile';

async function currentSessionId(): Promise<string> {
  const session = await getSession();
  if (!session) {
    throw new AppError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }
  return session.sessionId;
}

const totp = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'));

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
    })
    .refine((value) => value.newPassword !== value.currentPassword, {
      message: 'Choose a password different from the current one',
      path: ['newPassword'],
    }),
  roles: ROLES,
  handler: async (input, ctx) =>
    changePassword(
      ctx,
      { currentPassword: input.currentPassword, newPassword: input.newPassword },
      await currentSessionId(),
    ),
  successMessage: 'Password changed. Your other sessions were signed out.',
  revalidate: [PATH],
});

/** Starts enrolment: the secret is returned once, to the user's own browser. */
export const beginMfaAction = createAction({
  schema: z.object({}),
  roles: ROLES,
  handler: (_input, ctx) => beginMfaEnrolment(ctx),
});

export const confirmMfaAction = createAction({
  schema: z.object({ code: totp }),
  roles: ROLES,
  handler: (input, ctx) => confirmMfaEnrolment(ctx, input.code),
  successMessage: 'Two-factor authentication is on',
  revalidate: [PATH],
});

export const disableMfaAction = createAction({
  schema: z.object({
    password: z.string().min(1, 'Enter your password').max(128),
    code: totp,
  }),
  roles: ROLES,
  handler: (input, ctx) => disableMfa(ctx, input),
  successMessage: 'Two-factor authentication is off',
  revalidate: [PATH],
});

export const signOutOtherSessionsAction = createAction({
  schema: z.object({}),
  roles: ROLES,
  handler: async (_input, ctx) => revokeOtherOwnSessions(ctx, await currentSessionId()),
  successMessage: (count) =>
    count === 0
      ? 'No other session was open'
      : `${count} other session${count === 1 ? '' : 's'} signed out`,
  revalidate: [PATH],
});
