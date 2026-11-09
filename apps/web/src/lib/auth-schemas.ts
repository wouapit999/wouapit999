import {
  emailSchema,
  loginSchema,
  mfaChallengeSchema,
  passwordResetConfirmSchema,
  registerSchema,
  strongPasswordSchema,
  updateProfileSchema,
  userProfileSchema,
  changePasswordSchema,
} from '@bi-rem/shared/schemas';
import { z } from 'zod';

/**
 * Form and wire schemas built on top of `@bi-rem/shared`. Form schemas describe what the user
 * types; the route handlers re-validate against the shared DTO schemas before forwarding.
 */

export const loginFormSchema = loginSchema.pick({ email: true, password: true });
export type LoginFormValues = z.infer<typeof loginFormSchema>;

export const registerFormSchema = registerSchema
  .omit({ locale: true, marketingOptIn: true, acceptTerms: true })
  .extend({
    phone: z.union([z.literal(''), registerSchema.shape.phone.unwrap()]),
    confirmPassword: z.string().min(1, { error: 'Required' }),
    // A plain boolean keeps the unchecked default type-compatible with the form state.
    acceptTerms: z.boolean().refine((value) => value, {
      error: 'You must accept the terms of service',
    }),
    marketingOptIn: z.boolean(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    error: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type RegisterFormInput = z.input<typeof registerFormSchema>;
export type RegisterFormValues = z.infer<typeof registerFormSchema>;

export const forgotPasswordFormSchema = z.object({ email: emailSchema });
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordFormSchema>;

export const resetPasswordFormSchema = passwordResetConfirmSchema
  .extend({ confirmPassword: z.string().min(1, { error: 'Required' }) })
  .refine((value) => value.password === value.confirmPassword, {
    error: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

export const changePasswordFormSchema = changePasswordSchema
  .extend({ confirmPassword: z.string().min(1, { error: 'Required' }) })
  .refine((value) => value.newPassword === value.confirmPassword, {
    error: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>;

export const profileFormSchema = z.object({
  firstName: updateProfileSchema.shape.firstName.unwrap(),
  lastName: updateProfileSchema.shape.lastName.unwrap(),
  phone: z.union([z.literal(''), updateProfileSchema.shape.phone.unwrap().unwrap()]),
  countryCode: updateProfileSchema.shape.countryCode.unwrap(),
  locale: updateProfileSchema.shape.locale.unwrap(),
});
export type ProfileFormValues = z.infer<typeof profileFormSchema>;

export { strongPasswordSchema, userProfileSchema };

/**
 * The signed-in user as returned by `GET /v1/auth/me` and `GET|PATCH /v1/users/me`. The
 * `/auth/me` view carries `permissions` and omits `updatedAt`, so both are relaxed relative to
 * the shared `userProfileSchema`; unknown members (e.g. admin-only counters) are stripped.
 */
export const sessionUserSchema = userProfileSchema.extend({
  updatedAt: userProfileSchema.shape.updatedAt.optional(),
  permissions: z.array(z.string()).default([]),
});
export type SessionUser = z.output<typeof sessionUserSchema>;

// --- Wire formats -----------------------------------------------------------------------------

/**
 * Login/register/refresh response. The contract returns `{ accessToken, refreshToken, user }`;
 * `expiresIn` is optional so cookie lifetimes can follow the server when it provides them.
 */
export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.number().int().positive().optional(),
  user: userProfileSchema.optional(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const loginResultSchema = z.union([authSessionSchema, mfaChallengeSchema]);
export type LoginResult = z.infer<typeof loginResultSchema>;

export function isMfaChallenge(result: LoginResult): result is z.infer<typeof mfaChallengeSchema> {
  return 'mfaRequired' in result && result.mfaRequired;
}

/** Body of the BFF login/register responses: tokens never leave the server. */
export const bffSessionResponseSchema = z.object({
  ok: z.literal(true),
  user: userProfileSchema.nullable(),
});
export type BffSessionResponse = z.infer<typeof bffSessionResponseSchema>;

export const bffOkSchema = z.object({ ok: z.literal(true) });
