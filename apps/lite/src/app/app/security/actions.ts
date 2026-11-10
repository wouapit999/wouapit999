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
import { revokeOtherOwnSessions, revokeOwnSession } from '@/server/auth/own-sessions';
import { getSession } from '@/server/auth/session';
import { AppError } from '@/server/errors';

/**
 * Security actions of the signed-in customer: password, TOTP two-factor and sessions. Every
 * service call acts on the actor's own account only; secrets are never echoed back or logged.
 */

async function currentSessionId(): Promise<string> {
  const session = await getSession();
  if (!session) {
    throw new AppError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }
  return session.sessionId;
}

const passwordFormSchema = z
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
  });

/** Changes the password and signs out every other session. */
export const changePasswordAction = createAction({
  schema: passwordFormSchema,
  roles: ['CUSTOMER'],
  handler: async (input, ctx) =>
    changePassword(
      ctx,
      { currentPassword: input.currentPassword, newPassword: input.newPassword },
      await currentSessionId(),
    ),
  successMessage: 'Password changed. Your other sessions have been signed out.',
  revalidate: ['/app/security'],
});

/**
 * Starts two-factor enrolment. The secret is returned once, to the customer's own browser, so
 * it can be added to an authenticator app; it is stored encrypted and never readable again.
 */
export const beginMfaAction = createAction({
  schema: z.object({}),
  roles: ['CUSTOMER'],
  handler: (_input, ctx) => beginMfaEnrolment(ctx),
});

const totpCode = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'));

export const confirmMfaAction = createAction({
  schema: z.object({ code: totpCode }),
  roles: ['CUSTOMER'],
  handler: (input, ctx) => confirmMfaEnrolment(ctx, input.code),
  successMessage: 'Two-factor authentication is on.',
  revalidate: ['/app/security', '/app/profile', '/app'],
});

export const disableMfaAction = createAction({
  schema: z.object({
    password: z.string().min(1, 'Enter your password').max(128),
    code: totpCode,
  }),
  roles: ['CUSTOMER'],
  handler: (input, ctx) => disableMfa(ctx, input),
  successMessage: 'Two-factor authentication is off.',
  revalidate: ['/app/security', '/app/profile', '/app'],
});

/** Ends one of the customer's other sessions (the service refuses anybody else's). */
export const revokeSessionAction = createAction({
  schema: z.object({ id: z.uuid() }),
  roles: ['CUSTOMER'],
  handler: async (input, ctx) => {
    if (input.id === (await currentSessionId())) {
      throw new AppError('VALIDATION', 'Use “Sign out” to end the session you are using now.');
    }
    await revokeOwnSession(ctx, input.id);
  },
  successMessage: 'Session signed out',
  revalidate: ['/app/security'],
});

export const revokeOtherSessionsAction = createAction({
  schema: z.object({}),
  roles: ['CUSTOMER'],
  handler: async (_input, ctx) => revokeOtherOwnSessions(ctx, await currentSessionId()),
  successMessage: (count) =>
    count === 0
      ? 'There was no other session.'
      : `${count} other session${count === 1 ? '' : 's'} signed out.`,
  revalidate: ['/app/security'],
});
