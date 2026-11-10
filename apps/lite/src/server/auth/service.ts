import { z } from 'zod';

import type { Role } from '@/generated/prisma/enums';

import { writeAudit } from '../audit';
import {
  decryptSecret,
  dummyPasswordHash,
  encryptSecret,
  hashPassword,
  verifyPassword,
} from '../crypto';
import { db, withTransaction } from '../db';
import { getEnv } from '../env';
import { AppError, isUniqueViolation } from '../errors';
import { notify } from '../notifications';
import { RATE_LIMITS, enforceRateLimit } from '../rate-limit';
import { type ActionContext, type UserActor, requireUserActor } from '../rbac';
import { ensureUserWallet } from '../wallets';
import { SESSION_TTL_SECONDS, signSessionToken, verifySessionToken } from './token';
import { generateTotpSecret, totpAuthUri, verifyTotp } from './totp';

/**
 * Authentication: registration, password login with lockout, sessions, TOTP MFA.
 * Pure domain code (no `next/*` imports) — cookies live in `./session`.
 */

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export interface RequestMeta {
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
}

/** The user shape exposed to pages and actions — never includes hashes or secrets. */
export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly role: Role;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  readonly countryCode: string | null;
  readonly kycTier: 'TIER_0' | 'TIER_1' | 'TIER_2';
  readonly kycStatus: 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly mfaEnabled: boolean;
  readonly partnerId: string | null;
  readonly createdAt: Date;
}

const SESSION_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  status: true,
  countryCode: true,
  kycTier: true,
  kycStatus: true,
  riskLevel: true,
  mfaEnabled: true,
  partnerId: true,
  createdAt: true,
} as const;

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one digit');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid e-mail address').max(254));

/** E.164-ish phone: `+` and 8–15 digits (spaces/dashes tolerated on input). */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s().-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +237 6 99 00 00 01'));

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  phone: phoneSchema.optional(),
  countryCode: z.string().trim().toUpperCase().length(2, 'Choose a country'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
  totpCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code')
    .optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

const actorFor = (user: {
  id: string;
  role: Role;
  email: string;
  partnerId: string | null;
}): UserActor => ({
  type: 'USER',
  id: user.id,
  role: user.role,
  label: user.email,
  partnerId: user.partnerId,
});

const contextFor = (
  user: { id: string; role: Role; email: string; partnerId: string | null },
  meta: RequestMeta,
): ActionContext => ({ actor: actorFor(user), ...meta });

const anonymousContext = (meta: RequestMeta, label: string): ActionContext => ({
  actor: { type: 'SYSTEM', label },
  ...meta,
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Self-service customer registration: creates the user (role CUSTOMER, KYC tier 0) and a wallet
 * in the currency of their country, in one transaction.
 */
export async function registerCustomer(
  input: RegisterInput,
  meta: RequestMeta = {},
): Promise<SessionUser> {
  const data = registerSchema.parse(input);
  if (meta.ip) await enforceRateLimit(`register:ip:${meta.ip}`, RATE_LIMITS.registerPerIp);

  const country = await db.country.findUnique({ where: { code: data.countryCode } });
  if (!country?.enabled) {
    throw new AppError('VALIDATION', 'BI-Rem is not available in this country yet', {
      fieldErrors: { countryCode: ['Choose a supported country'] },
    });
  }
  const passwordHash = await hashPassword(data.password);

  try {
    return await withTransaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          fullName: data.fullName,
          phone: data.phone ?? null,
          countryCode: country.code,
          role: 'CUSTOMER',
        },
        select: SESSION_USER_SELECT,
      });
      await ensureUserWallet(tx, user.id, country.currency);
      await notify(tx, {
        userId: user.id,
        type: 'account.welcome',
        title: 'Welcome to BI-Rem Lite',
        body: 'Verify your identity to raise your limits and send money abroad.',
        href: '/app/kyc',
      });
      await writeAudit(tx, contextFor(user, meta), {
        action: 'auth.register',
        resourceType: 'user',
        resourceId: user.id,
        after: { email: user.email, countryCode: user.countryCode, role: user.role },
      });
      return user;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('CONFLICT', 'An account with this e-mail or phone number already exists', {
        fieldErrors: { email: ['This e-mail or phone number is already registered'] },
      });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export type LoginResult =
  | { status: 'OK'; user: SessionUser; token: string; expiresAt: Date; sessionId: string }
  | { status: 'MFA_REQUIRED' };

const INVALID_CREDENTIALS = 'Incorrect e-mail or password';

async function recordAttempt(
  email: string,
  userId: string | null,
  meta: RequestMeta,
  success: boolean,
  reason: string | null,
): Promise<void> {
  await db.loginAttempt.create({
    data: { email, userId, ip: meta.ip ?? null, success, reason },
  });
}

/**
 * Password (+ TOTP) login. After {@link MAX_FAILED_LOGINS} consecutive failures the account is
 * locked for {@link LOCKOUT_MINUTES} minutes. Attempts are rate limited per IP and per e-mail in
 * the database. Returns `MFA_REQUIRED` when the password is right but a TOTP code is needed.
 */
export async function login(input: LoginInput, meta: RequestMeta = {}): Promise<LoginResult> {
  const data = loginSchema.parse(input);
  if (meta.ip) await enforceRateLimit(`login:ip:${meta.ip}`, RATE_LIMITS.loginPerIp);
  await enforceRateLimit(`login:email:${data.email}`, RATE_LIMITS.loginPerEmail);

  const user = await db.user.findUnique({ where: { email: data.email } });
  const now = new Date();

  if (!user) {
    // Equalise timing so unknown e-mails cannot be told apart from wrong passwords.
    await verifyPassword(data.password, await dummyPasswordHash());
    await recordAttempt(data.email, null, meta, false, 'UNKNOWN_EMAIL');
    throw new AppError('UNAUTHENTICATED', INVALID_CREDENTIALS);
  }

  const ctx = contextFor(user, meta);

  if (user.lockedUntil && user.lockedUntil > now) {
    await recordAttempt(data.email, user.id, meta, false, 'LOCKED');
    await writeAudit(db, ctx, {
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      outcome: 'DENIED',
      metadata: { reason: 'LOCKED' },
    });
    const minutes = Math.max(Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000), 1);
    throw new AppError(
      'UNAUTHENTICATED',
      `This account is temporarily locked after too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    );
  }

  const fail = async (reason: string, message: string): Promise<never> => {
    // Atomic increment; lock when the threshold is reached.
    const updated = await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const locked = updated.failedLoginCount >= MAX_FAILED_LOGINS;
    if (locked) {
      await db.user.update({
        where: { id: user.id },
        data: {
          lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000),
          failedLoginCount: 0,
        },
      });
    }
    await recordAttempt(data.email, user.id, meta, false, reason);
    await writeAudit(db, ctx, {
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      outcome: 'FAILURE',
      metadata: { reason, locked },
    });
    throw new AppError(
      'UNAUTHENTICATED',
      locked
        ? `Too many failed attempts. This account is locked for ${LOCKOUT_MINUTES} minutes.`
        : message,
    );
  };

  if (!(await verifyPassword(data.password, user.passwordHash))) {
    return fail('BAD_PASSWORD', INVALID_CREDENTIALS);
  }

  if (user.status !== 'ACTIVE') {
    await recordAttempt(data.email, user.id, meta, false, user.status);
    await writeAudit(db, ctx, {
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      outcome: 'DENIED',
      metadata: { reason: user.status },
    });
    throw new AppError('FORBIDDEN', 'This account is not active. Please contact support.');
  }

  let mfaVerified = false;
  if (user.mfaEnabled && user.mfaSecretEnc) {
    if (!data.totpCode) return { status: 'MFA_REQUIRED' };
    if (!verifyTotp(decryptSecret(user.mfaSecretEnc), data.totpCode)) {
      return fail('BAD_TOTP', 'The verification code is not valid');
    }
    mfaVerified = true;
  }

  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const session = await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    const created = await tx.session.create({
      data: {
        userId: user.id,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        mfaVerified,
        expiresAt,
      },
    });
    await tx.loginAttempt.create({
      data: { email: data.email, userId: user.id, ip: meta.ip ?? null, success: true },
    });
    await writeAudit(tx, ctx, {
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { sessionId: created.id, mfa: mfaVerified },
    });
    return created;
  });

  const token = await signSessionToken(
    { sub: user.id, sid: session.id, role: user.role },
    expiresAt,
  );
  const sessionUser = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: SESSION_USER_SELECT,
  });
  return { status: 'OK', user: sessionUser, token, expiresAt, sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface ResolvedSession {
  readonly sessionId: string;
  readonly user: SessionUser;
  readonly expiresAt: Date;
  readonly mfaVerified: boolean;
}

/**
 * Verifies the token and loads the live session + user. Returns null for forged, expired or
 * revoked sessions and for users that are no longer ACTIVE.
 */
export async function resolveSession(
  token: string | undefined | null,
): Promise<ResolvedSession | null> {
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const session = await db.session.findUnique({
    where: { id: payload.sid },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
      mfaVerified: true,
      user: { select: SESSION_USER_SELECT },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.userId !== payload.sub || session.user.status !== 'ACTIVE') return null;
  return {
    sessionId: session.id,
    user: session.user,
    expiresAt: session.expiresAt,
    mfaVerified: session.mfaVerified,
  };
}

/** Logout: revokes the session row (idempotent) and audits it. */
export async function logout(sessionId: string, ctx: ActionContext): Promise<void> {
  const result = await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count > 0) {
    await writeAudit(db, ctx, {
      action: 'auth.logout',
      resourceType: 'session',
      resourceId: sessionId,
    });
  }
}

/** Revokes every session of a user (password change, suspension). */
export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const result = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordSchema,
});

/** Changes the signed-in user's password and signs out their other sessions. */
export async function changePassword(
  ctx: ActionContext,
  input: z.infer<typeof changePasswordSchema>,
  currentSessionId?: string,
): Promise<void> {
  const actor = requireUserActor(ctx);
  const data = changePasswordSchema.parse(input);
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(data.currentPassword, user.passwordHash))) {
    throw new AppError('VALIDATION', 'Your current password is not correct', {
      fieldErrors: { currentPassword: ['Incorrect password'] },
    });
  }
  const passwordHash = await hashPassword(data.newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { passwordHash } });
    await writeAudit(tx, ctx, {
      action: 'auth.password.change',
      resourceType: 'user',
      resourceId: actor.id,
    });
  });
  await revokeAllSessions(actor.id, currentSessionId);
}

/** Where each role manages its password and two-factor authentication. */
export function securityPathFor(role: Role): string {
  if (role === 'CUSTOMER') return '/app/profile';
  if (role === 'PARTNER') return '/partner/profile';
  return '/admin/security';
}

// ---------------------------------------------------------------------------
// TOTP multi-factor authentication
// ---------------------------------------------------------------------------

export interface MfaEnrolment {
  /** Base32 secret for manual entry. Shown once; stored encrypted. */
  readonly secret: string;
  readonly otpauthUri: string;
}

/** Starts (or restarts) enrolment: stores an encrypted pending secret, MFA stays off. */
export async function beginMfaEnrolment(ctx: ActionContext): Promise<MfaEnrolment> {
  const actor = requireUserActor(ctx);
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (user.mfaEnabled)
    throw new AppError('INVALID_STATE', 'Two-factor authentication is already on');
  const secret = generateTotpSecret();
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.id },
      data: { mfaSecretEnc: encryptSecret(secret) },
    });
    await writeAudit(tx, ctx, {
      action: 'auth.mfa.enrol.begin',
      resourceType: 'user',
      resourceId: actor.id,
    });
  });
  return { secret, otpauthUri: totpAuthUri(secret, user.email, getEnv().appName) };
}

/** Confirms enrolment with a valid code and switches MFA on. */
export async function confirmMfaEnrolment(ctx: ActionContext, code: string): Promise<void> {
  const actor = requireUserActor(ctx);
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (user.mfaEnabled)
    throw new AppError('INVALID_STATE', 'Two-factor authentication is already on');
  if (!user.mfaSecretEnc) throw new AppError('INVALID_STATE', 'Start the enrolment first');
  if (!verifyTotp(decryptSecret(user.mfaSecretEnc), code)) {
    throw new AppError('VALIDATION', 'The verification code is not valid', {
      fieldErrors: { code: ['Code not recognised — check the time on your phone'] },
    });
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.id },
      data: { mfaEnabled: true, mfaEnabledAt: new Date() },
    });
    await notify(tx, {
      userId: actor.id,
      type: 'security.mfa.enabled',
      title: 'Two-factor authentication is on',
      body: 'You will be asked for a 6-digit code each time you sign in.',
      href: securityPathFor(actor.role),
    });
    await writeAudit(tx, ctx, {
      action: 'auth.mfa.enable',
      resourceType: 'user',
      resourceId: actor.id,
    });
  });
}

/** Switches MFA off after re-checking the password and a current code. */
export async function disableMfa(
  ctx: ActionContext,
  input: { password: string; code: string },
): Promise<void> {
  const actor = requireUserActor(ctx);
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!user.mfaEnabled || !user.mfaSecretEnc) {
    throw new AppError('INVALID_STATE', 'Two-factor authentication is not on');
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError('VALIDATION', 'Your password is not correct', {
      fieldErrors: { password: ['Incorrect password'] },
    });
  }
  if (!verifyTotp(decryptSecret(user.mfaSecretEnc), input.code)) {
    throw new AppError('VALIDATION', 'The verification code is not valid', {
      fieldErrors: { code: ['Code not recognised'] },
    });
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.id },
      data: { mfaEnabled: false, mfaSecretEnc: null, mfaEnabledAt: null },
    });
    await writeAudit(tx, ctx, {
      action: 'auth.mfa.disable',
      resourceType: 'user',
      resourceId: actor.id,
    });
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  phone: phoneSchema.optional(),
  dateOfBirth: z.iso.date('Use the format YYYY-MM-DD').optional(),
  addressLine: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  occupation: z.string().trim().max(100).optional(),
});
export type ProfileInput = z.infer<typeof profileSchema>;

/** Full profile of the signed-in user (no secrets). */
export async function getProfile(ctx: ActionContext) {
  const actor = requireUserActor(ctx);
  return db.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: {
      ...SESSION_USER_SELECT,
      dateOfBirth: true,
      addressLine: true,
      city: true,
      occupation: true,
      riskScore: true,
      riskFactors: true,
      mfaEnabledAt: true,
      lastLoginAt: true,
      country: { select: { code: true, name: true, currency: true, dialCode: true } },
    },
  });
}

/** Updates the signed-in user's own profile; audited with before/after. */
export async function updateProfile(ctx: ActionContext, input: ProfileInput): Promise<void> {
  const actor = requireUserActor(ctx);
  const data = profileSchema.parse(input);
  try {
    await db.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id: actor.id },
        select: {
          fullName: true,
          phone: true,
          dateOfBirth: true,
          addressLine: true,
          city: true,
          occupation: true,
        },
      });
      const after = await tx.user.update({
        where: { id: actor.id },
        data: {
          fullName: data.fullName,
          phone: data.phone ?? null,
          dateOfBirth: data.dateOfBirth ? new Date(`${data.dateOfBirth}T00:00:00Z`) : null,
          addressLine: data.addressLine ?? null,
          city: data.city ?? null,
          occupation: data.occupation ?? null,
        },
        select: {
          fullName: true,
          phone: true,
          dateOfBirth: true,
          addressLine: true,
          city: true,
          occupation: true,
        },
      });
      await writeAudit(tx, ctx, {
        action: 'user.profile.update',
        resourceType: 'user',
        resourceId: actor.id,
        before,
        after,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('CONFLICT', 'This phone number is already used by another account', {
        fieldErrors: { phone: ['Already in use'] },
      });
    }
    throw error;
  }
}

/** Sessions of the signed-in user (security page). */
export async function listSessions(ctx: ActionContext) {
  const actor = requireUserActor(ctx);
  return db.session.findMany({
    where: { userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      ip: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
      mfaVerified: true,
    },
  });
}

export { anonymousContext, contextFor };
