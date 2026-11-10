import { z } from 'zod';

import type { KycStatus, RiskLevel, Role, UserStatus } from '@/generated/prisma/enums';

import { assessUserRisk } from './aml/engine';
import { emailSchema, passwordSchema, revokeAllSessions } from './auth/service';
import { writeAudit } from './audit';
import { hashPassword } from './crypto';
import { type Prisma, db } from './db';
import { AppError, isUniqueViolation } from './errors';
import { notify } from './notifications';
import {
  type ActionContext,
  STAFF_ROLES,
  assertAnyPermission,
  assertPermission,
  requireUserActor,
} from './rbac';

/**
 * Back-office user management (phases 1–2): customer search, the customer 360° view, account
 * status, staff accounts. Password hashes and MFA secrets are never selected.
 */

const LIST_SELECT = {
  id: true,
  email: true,
  phone: true,
  fullName: true,
  role: true,
  status: true,
  countryCode: true,
  kycTier: true,
  kycStatus: true,
  riskLevel: true,
  riskScore: true,
  mfaEnabled: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  partnerId: true,
} as const satisfies Prisma.UserSelect;

export interface UserSearchFilter {
  /** Name, e-mail or phone fragment. */
  readonly search?: string;
  readonly role?: Role;
  readonly status?: UserStatus;
  readonly kycStatus?: KycStatus;
  readonly riskLevel?: RiskLevel;
  readonly countryCode?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

/** Customer / staff search. Requires `users:read`. */
export async function searchUsers(ctx: ActionContext, filter: UserSearchFilter = {}) {
  assertPermission(ctx, 'users:read');
  const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), 100);
  const page = Math.max(filter.page ?? 1, 1);
  const search = filter.search?.trim();
  const where: Prisma.UserWhereInput = {
    ...(filter.role ? { role: filter.role } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.kycStatus ? { kycStatus: filter.kycStatus } : {}),
    ...(filter.riskLevel ? { riskLevel: filter.riskLevel } : {}),
    ...(filter.countryCode ? { countryCode: filter.countryCode } : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search.replace(/[\s().-]/g, '') } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: LIST_SELECT,
    }),
    db.user.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

/** Customer 360°: profile, wallets, KYC cases, recent transfers, alerts. Requires `users:read`. */
export async function getUserDetail(ctx: ActionContext, userId: string) {
  assertPermission(ctx, 'users:read');
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      ...LIST_SELECT,
      dateOfBirth: true,
      addressLine: true,
      city: true,
      occupation: true,
      riskFactors: true,
      riskAssessedAt: true,
      pepMatch: true,
      sanctionsMatch: true,
      failedLoginCount: true,
      country: { select: { code: true, name: true, currency: true } },
      partner: { select: { id: true, name: true, code: true, type: true, status: true } },
      wallets: {
        include: { ledgerAccount: { select: { balance: true } } },
        orderBy: { createdAt: 'asc' },
      },
      kycCases: {
        orderBy: { submittedAt: 'desc' },
        select: {
          id: true,
          status: true,
          targetTier: true,
          vendor: true,
          vendorDecision: true,
          submittedAt: true,
          decidedAt: true,
        },
      },
      beneficiaries: {
        where: { archivedAt: null },
        select: { id: true, fullName: true, method: true, countryCode: true, accountNumber: true },
      },
    },
  });
  if (!user) throw new AppError('NOT_FOUND', 'User not found');
  const [transfers, alerts, sessions] = await Promise.all([
    db.transfer.findMany({
      where: { OR: [{ senderUserId: userId }, { recipientUserId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    db.amlAlert.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    db.session.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return {
    user: {
      ...user,
      wallets: user.wallets.map(({ ledgerAccount, ...wallet }) => ({
        ...wallet,
        balance: ledgerAccount.balance,
      })),
    },
    transfers,
    alerts,
    activeSessions: sessions,
  };
}

/**
 * Suspends, reactivates or closes an account. Suspending / closing signs the user out
 * everywhere. An actor cannot change their own status. Requires `users:write`.
 */
export async function setUserStatus(
  ctx: ActionContext,
  userId: string,
  status: UserStatus,
  reason: string,
) {
  assertPermission(ctx, 'users:write');
  const note = z.string().trim().min(3, 'Give a reason').max(500).parse(reason);
  if (ctx.actor.type === 'USER' && ctx.actor.id === userId) {
    throw new AppError('FORBIDDEN', 'You cannot change the status of your own account');
  }
  const updated = await db.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!before) throw new AppError('NOT_FOUND', 'User not found');
    const after = await tx.user.update({
      where: { id: userId },
      data: { status },
      select: LIST_SELECT,
    });
    await writeAudit(tx, ctx, {
      action: 'user.status',
      resourceType: 'user',
      resourceId: userId,
      before: { status: before.status },
      after: { status, reason: note },
    });
    return after;
  });
  if (status !== 'ACTIVE') await revokeAllSessions(userId);
  return updated;
}

/** Clears a login lockout. Requires `users:write`. */
export async function unlockUser(ctx: ActionContext, userId: string): Promise<void> {
  assertPermission(ctx, 'users:write');
  await db.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id: userId },
      data: { lockedUntil: null, failedLoginCount: 0 },
    });
    if (result.count === 0) throw new AppError('NOT_FOUND', 'User not found');
    await writeAudit(tx, ctx, { action: 'user.unlock', resourceType: 'user', resourceId: userId });
  });
}

/** Recomputes a customer's risk score on demand. Requires `aml:write` or `users:write`. */
export async function recalculateUserRisk(ctx: ActionContext, userId: string) {
  assertAnyPermission(ctx, ['aml:write', 'users:write']);
  const profile = await assessUserRisk(db, userId);
  await writeAudit(db, ctx, {
    action: 'user.risk.recalculate',
    resourceType: 'user',
    resourceId: userId,
    after: { score: profile.score, level: profile.level },
  });
  return profile;
}

export const staffUserSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(STAFF_ROLES),
  password: passwordSchema,
});

/** Creates a back-office account. Requires `users:write` (ADMIN only). */
export async function createStaffUser(ctx: ActionContext, input: z.infer<typeof staffUserSchema>) {
  assertPermission(ctx, 'users:write');
  const data = staffUserSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          fullName: data.fullName,
          role: data.role,
          passwordHash,
          kycStatus: 'NONE',
        },
        select: LIST_SELECT,
      });
      await notify(tx, {
        userId: user.id,
        type: 'account.welcome',
        title: 'Welcome to the BI-Rem back office',
        body: 'Turn on two-factor authentication from the Security page.',
        href: '/admin/security',
      });
      await writeAudit(tx, ctx, {
        action: 'user.staff.create',
        resourceType: 'user',
        resourceId: user.id,
        after: { email: user.email, role: user.role },
      });
      return user;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('CONFLICT', 'An account with this e-mail already exists', {
        fieldErrors: { email: ['Already registered'] },
      });
    }
    throw error;
  }
}

/** Changes the role of a staff account (never a customer/partner, never one's own). */
export async function setStaffRole(
  ctx: ActionContext,
  userId: string,
  role: (typeof STAFF_ROLES)[number],
) {
  assertPermission(ctx, 'users:write');
  const actor = requireUserActor(ctx);
  if (actor.id === userId) throw new AppError('FORBIDDEN', 'You cannot change your own role');
  const updated = await db.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!before) throw new AppError('NOT_FOUND', 'User not found');
    if (!(STAFF_ROLES as readonly Role[]).includes(before.role)) {
      throw new AppError('INVALID_STATE', 'Only staff accounts can be given a staff role');
    }
    const after = await tx.user.update({
      where: { id: userId },
      data: { role },
      select: LIST_SELECT,
    });
    await writeAudit(tx, ctx, {
      action: 'user.role',
      resourceType: 'user',
      resourceId: userId,
      before: { role: before.role },
      after: { role },
    });
    return after;
  });
  // The role is embedded in the session token: force a fresh login.
  await revokeAllSessions(userId);
  return updated;
}
