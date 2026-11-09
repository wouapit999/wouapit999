import { z } from 'zod';

import { USER_REALMS } from '../constants/realms.js';
import {
  countryCodeSchema,
  e164PhoneSchema,
  emailSchema,
  localeSchema,
  personNameSchema,
} from './common.js';

export const userRealmSchema = z.enum(USER_REALMS);

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Strong password rule: 12–128 chars, mixed case, a digit and a symbol, no leading/trailing
 * whitespace. Length is checked on the raw string so passphrases with inner spaces are allowed.
 */
export const strongPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  .max(PASSWORD_MAX_LENGTH, { error: `Password must be at most ${PASSWORD_MAX_LENGTH} characters` })
  .refine((value) => value.trim() === value, {
    error: 'Password cannot start or end with whitespace',
  })
  .refine((value) => /[a-z]/.test(value), { error: 'Password must contain a lowercase letter' })
  .refine((value) => /[A-Z]/.test(value), { error: 'Password must contain an uppercase letter' })
  .refine((value) => /\d/.test(value), { error: 'Password must contain a digit' })
  .refine((value) => /[^\p{L}\p{N}\s]/u.test(value), { error: 'Password must contain a symbol' });

/** Login/current-password fields are only bounded, never evaluated for strength. */
const existingPasswordSchema = z.string().min(1, { error: 'Required' }).max(PASSWORD_MAX_LENGTH);

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { error: 'Code must be 6 digits' });

/** Recovery codes: 10 alphanumerics, optionally hyphenated in the middle. */
export const recoveryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{5}-?[A-Z0-9]{5}$/, { error: 'Invalid recovery code' });

export const registerSchema = z
  .object({
    email: emailSchema,
    password: strongPasswordSchema,
    firstName: personNameSchema,
    lastName: personNameSchema,
    phone: e164PhoneSchema.optional(),
    countryCode: countryCodeSchema,
    locale: localeSchema.default('en'),
    acceptTerms: z.literal(true, { error: 'You must accept the terms of service' }),
    marketingOptIn: z.boolean().default(false),
  })
  .strict();
export type RegisterInput = z.input<typeof registerSchema>;
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: emailSchema,
    password: existingPasswordSchema,
    realm: userRealmSchema.default('CUSTOMER'),
    /** Optional client fingerprint used to label refresh-token sessions. */
    deviceName: z.string().trim().max(100).optional(),
  })
  .strict();
export type LoginInput = z.input<typeof loginSchema>;
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().min(20).max(4096),
  })
  .strict();
export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;

export const logoutSchema = z
  .object({
    refreshToken: z.string().min(20).max(4096).optional(),
    allDevices: z.boolean().default(false),
  })
  .strict();
export type LogoutDto = z.infer<typeof logoutSchema>;

/** Second step of login when MFA is enabled: short-lived challenge token + TOTP or recovery code. */
export const mfaVerifySchema = z
  .object({
    mfaToken: z.string().min(20).max(4096),
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
  })
  .strict()
  .refine((value) => (value.code === undefined) !== (value.recoveryCode === undefined), {
    error: 'Provide either a TOTP code or a recovery code',
    path: ['code'],
  });
export type MfaVerifyDto = z.infer<typeof mfaVerifySchema>;

/** Confirms TOTP enrolment by proving possession of the newly provisioned secret. */
export const mfaEnableSchema = z
  .object({
    code: totpCodeSchema,
  })
  .strict();
export type MfaEnableDto = z.infer<typeof mfaEnableSchema>;

export const mfaDisableSchema = z
  .object({
    password: existingPasswordSchema,
    code: totpCodeSchema,
  })
  .strict();
export type MfaDisableDto = z.infer<typeof mfaDisableSchema>;

export const passwordResetRequestSchema = z
  .object({
    email: emailSchema,
    realm: userRealmSchema.default('CUSTOMER'),
  })
  .strict();
export type PasswordResetRequestDto = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z
  .object({
    token: z.string().min(20).max(4096),
    password: strongPasswordSchema,
  })
  .strict();
export type PasswordResetConfirmDto = z.infer<typeof passwordResetConfirmSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: existingPasswordSchema,
    newPassword: strongPasswordSchema,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    error: 'New password must differ from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const verifyEmailSchema = z
  .object({
    token: z.string().min(20).max(4096),
  })
  .strict();
export type VerifyEmailDto = z.infer<typeof verifyEmailSchema>;

// --- Responses -------------------------------------------------------------------------------

export const authTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  /** Access-token lifetime in seconds. */
  expiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const mfaChallengeSchema = z.object({
  mfaRequired: z.literal(true),
  mfaToken: z.string().min(1),
  methods: z.array(z.enum(['TOTP', 'RECOVERY_CODE'])).min(1),
});
export type MfaChallenge = z.infer<typeof mfaChallengeSchema>;

export const loginResponseSchema = z.union([authTokensSchema, mfaChallengeSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const mfaSetupResponseSchema = z.object({
  secret: z.string().min(16),
  otpauthUri: z.string().startsWith('otpauth://'),
  recoveryCodes: z.array(z.string()).min(1),
});
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;

/** Claims embedded in the JWT access token. */
export const accessTokenClaimsSchema = z.object({
  sub: z.uuid(),
  realm: userRealmSchema,
  email: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  sid: z.uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
