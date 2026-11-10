'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createPublicAction } from '@/lib/server-action';
import { emailSchema, login, passwordSchema, phoneSchema, registerCustomer } from '@/server/auth';
import { endSession, setSessionCookie } from '@/server/auth/session';
import { AppError } from '@/server/errors';
import { canAccessPath, homePathForRole } from '@/server/rbac';

/** Only same-origin, absolute-path redirects the user's role may open. */
function safeNext(next: string | undefined, role: Parameters<typeof homePathForRole>[0]): string {
  const home = homePathForRole(role);
  if (!next?.startsWith('/') || next.startsWith('//') || next.includes('\\')) return home;
  const path = next.split(/[?#]/)[0] ?? '';
  const inArea = ['/app', '/admin', '/partner'].some(
    (area) => path === area || path.startsWith(`${area}/`),
  );
  return inArea && canAccessPath(role, path) ? next : home;
}

const loginFormSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
  totpCode: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'))
    .optional(),
  next: z.string().max(200).optional(),
});

/** Sign in. Sets the session cookie and redirects to the area of the user's role. */
export const loginAction = createPublicAction({
  schema: loginFormSchema,
  handler: async (input, meta) => {
    const result = await login(
      { email: input.email, password: input.password, totpCode: input.totpCode },
      meta,
    );
    if (result.status === 'MFA_REQUIRED') {
      throw new AppError('VALIDATION', 'Two-factor authentication is on for this account.', {
        fieldErrors: {
          totpCode: [
            'Enter the 6-digit code from your authenticator app (and your password again)',
          ],
        },
      });
    }
    await setSessionCookie(result.token, result.expiresAt);
    return { path: safeNext(input.next, result.user.role) };
  },
  redirectTo: (result) => result.path,
});

const registerFormSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name').max(120),
    email: emailSchema,
    phone: phoneSchema.optional(),
    countryCode: z.string().trim().toUpperCase().length(2, 'Choose your country'),
    password: passwordSchema,
    confirmPassword: z.string(),
    terms: z.literal('on', 'Please accept the terms to continue'),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'The two passwords do not match',
    path: ['confirmPassword'],
  });

/** Self-service customer registration, then straight into the customer area. */
export const registerAction = createPublicAction({
  schema: registerFormSchema,
  handler: async (input, meta) => {
    await registerCustomer(
      {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        countryCode: input.countryCode,
        password: input.password,
      },
      meta,
    );
    const session = await login({ email: input.email, password: input.password }, meta);
    if (session.status === 'OK') await setSessionCookie(session.token, session.expiresAt);
  },
  redirectTo: '/app',
});

/** Sign out: revokes the session, clears the cookie. Used as a plain `<form action>`. */
export async function logoutAction(): Promise<void> {
  await endSession();
  redirect('/login');
}
