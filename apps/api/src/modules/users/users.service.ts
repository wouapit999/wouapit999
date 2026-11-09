import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, User, UserRealm, UserStatus } from '@bi-rem/db';
import { SYSTEM_ROLES, isSystemRoleName } from '@bi-rem/db';
import type { Paginated } from '@bi-rem/shared';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import { RequestContext } from '../../common/context/request-context.js';
import { ApiException } from '../../common/errors/api-exception.js';
import { paginate, toPageArgs } from '../../common/pagination/pagination.js';
import type { AppConfig } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { PasswordService } from '../auth/password.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { PermissionResolverService } from '../rbac/permission-resolver.service.js';
import { SUPER_ADMIN_ROLE } from '../rbac/permissions.guard.js';
import { UserRolesService } from '../rbac/user-roles.service.js';
import type {
  AdminCreateUserDto,
  AdminUpdateUserDto,
  ListUsersQueryDto,
  UpdateProfileDto,
} from './dto/user.dto.js';

export interface UserView {
  id: string;
  realm: UserRealm;
  email: string;
  emailVerifiedAt: Date | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  countryCode: string;
  locale: string;
  status: UserStatus;
  mfaEnabled: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

type UserWithRoles = Prisma.UserGetPayload<{
  include: { roles: { select: { role: { select: { name: true } } } } };
}>;

const USER_INCLUDE = { roles: { select: { role: { select: { name: true } } } } } as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly adminPortalUrl: string;
  private readonly customerPortalUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationService,
    private readonly outbox: OutboxService,
    private readonly permissions: PermissionResolverService,
    private readonly userRoles: UserRolesService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.adminPortalUrl = config.get('ADMIN_PORTAL_URL', { infer: true });
    this.customerPortalUrl = config.get('CUSTOMER_PORTAL_URL', { infer: true });
  }

  // --- Admin: query ------------------------------------------------------------------------

  async list(query: ListUsersQueryDto): Promise<Paginated<UserView>> {
    const where: Prisma.UserWhereInput = {
      ...(query.includeDeleted === 'true' ? {} : { deletedAt: null }),
      ...(query.realm ? { realm: query.realm } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.countryCode ? { countryCode: query.countryCode } : {}),
      ...(query.roleId ? { roles: { some: { roleId: query.roleId } } } : {}),
      ...(query.mfaEnabled ? { mfaEnabled: query.mfaEnabled === 'true' } : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
              ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.client.$transaction([
      this.prisma.client.user.findMany({
        where,
        include: USER_INCLUDE,
        orderBy: { [query.sortBy]: query.sortOrder },
        ...toPageArgs(query),
      }),
      this.prisma.client.user.count({ where }),
    ]);
    return paginate(items.map(toUserView), total, query);
  }

  async get(id: string): Promise<UserView> {
    return toUserView(await this.requireUser(id, true));
  }

  // --- Admin: mutations ----------------------------------------------------------------------

  async create(dto: AdminCreateUserDto, actor: AuthenticatedPrincipal): Promise<UserView> {
    const actorId = actor.userId;
    const clash = await this.prisma.client.user.findUnique({
      where: { realm_email: { realm: dto.realm, email: dto.email } },
      select: { id: true },
    });
    if (clash) throw ApiException.conflict('A user with this email already exists in this realm');
    if (dto.phone) {
      const phoneTaken = await this.prisma.client.user.findUnique({
        where: { phone: dto.phone },
        select: { id: true },
      });
      if (phoneTaken) throw ApiException.conflict('A user with this phone number already exists');
    }
    const roles = dto.roleIds.length
      ? await this.prisma.client.role.findMany({ where: { id: { in: dto.roleIds } } })
      : [];
    if (roles.length !== dto.roleIds.length)
      throw ApiException.notFound('One or more roles do not exist');
    for (const role of roles) {
      const roleRealm = isSystemRoleName(role.name) ? SYSTEM_ROLES[role.name].realm : 'ADMIN';
      if (roleRealm !== dto.realm)
        throw ApiException.conflict(`Role ${role.name} cannot be assigned to a ${dto.realm} user`);
    }
    await this.userRoles.assertMayGrant(
      roles.map((role) => role.name),
      actor,
    );

    const password = dto.password ?? randomBytes(24).toString('base64url');
    const passwordHash = await this.passwords.hash(password);
    const user = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          realm: dto.realm,
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone ?? null,
          countryCode: dto.countryCode,
          locale: dto.locale,
          status: dto.password ? 'ACTIVE' : 'PENDING',
          roles: { create: roles.map((role) => ({ roleId: role.id, assignedById: actorId })) },
        },
        include: USER_INCLUDE,
      });
      await this.outbox.publish(
        {
          aggregateType: 'User',
          aggregateId: created.id,
          eventType: 'user.created',
          payload: { userId: created.id, realm: created.realm, createdBy: actorId },
        },
        tx,
      );
      return created;
    });
    RequestContext.setResourceId(user.id);
    RequestContext.recordAfter(toUserView(user));

    if (dto.sendInvitation) await this.sendInvitation(user);
    return toUserView(user);
  }

  async update(
    id: string,
    dto: AdminUpdateUserDto,
    actor: AuthenticatedPrincipal,
  ): Promise<UserView> {
    const current = await this.requireUser(id);
    await this.assertMayManage(current, actor);
    if (dto.email && dto.email !== current.email) {
      const clash = await this.prisma.client.user.findUnique({
        where: { realm_email: { realm: current.realm, email: dto.email } },
        select: { id: true },
      });
      if (clash) throw ApiException.conflict('A user with this email already exists in this realm');
    }
    if (dto.phone && dto.phone !== current.phone) {
      const phoneTaken = await this.prisma.client.user.findUnique({
        where: { phone: dto.phone },
        select: { id: true },
      });
      if (phoneTaken) throw ApiException.conflict('A user with this phone number already exists');
    }
    RequestContext.recordBefore(toUserView(current));
    const updated = await this.prisma.client.user.update({
      where: { id },
      data: {
        ...(dto.email !== undefined
          ? { email: dto.email, emailVerifiedAt: dto.email === current.email ? undefined : null }
          : {}),
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode } : {}),
        ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
      },
      include: USER_INCLUDE,
    });
    const view = toUserView(updated);
    RequestContext.recordAfter(view);
    return view;
  }

  async suspend(id: string, reason: string, actor: AuthenticatedPrincipal): Promise<UserView> {
    const actorId = actor.userId;
    const current = await this.requireUser(id);
    if (current.id === actorId) throw ApiException.conflict('You cannot suspend your own account');
    await this.assertMayManage(current, actor);
    if (current.status === 'SUSPENDED') return toUserView(current);
    return this.transition(current, 'SUSPENDED', 'user.suspended', { reason, actorId }, true);
  }

  async reactivate(id: string, reason: string, actor: AuthenticatedPrincipal): Promise<UserView> {
    const actorId = actor.userId;
    const current = await this.requireUser(id);
    await this.assertMayManage(current, actor);
    if (current.status !== 'SUSPENDED' && current.status !== 'LOCKED') {
      throw ApiException.conflict(`User is ${current.status}, not suspended or locked`);
    }
    return this.transition(current, 'ACTIVE', 'user.reactivated', { reason, actorId }, false);
  }

  /** Clears a temporary lockout (failed logins) without changing status. */
  async unlock(id: string): Promise<UserView> {
    const current = await this.requireUser(id);
    RequestContext.recordBefore(toUserView(current));
    const updated = await this.prisma.client.user.update({
      where: { id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...(current.status === 'LOCKED' ? { status: 'ACTIVE' } : {}),
      },
      include: USER_INCLUDE,
    });
    const view = toUserView(updated);
    RequestContext.recordAfter(view);
    return view;
  }

  async softDelete(id: string, reason: string, actor: AuthenticatedPrincipal): Promise<void> {
    const actorId = actor.userId;
    const current = await this.requireUser(id);
    if (current.id === actorId) throw ApiException.conflict('You cannot delete your own account');
    await this.assertMayManage(current, actor);
    await this.assertNotLastSuperAdmin(current.id);
    RequestContext.recordBefore(toUserView(current));
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: 'DELETED', deletedAt: now } });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.outbox.publish(
        {
          aggregateType: 'User',
          aggregateId: id,
          eventType: 'user.deleted',
          payload: { userId: id, reason, actorId },
        },
        tx,
      );
    });
    await this.permissions.invalidate(id);
  }

  // --- Self-service --------------------------------------------------------------------------

  async getProfile(userId: string): Promise<UserView> {
    return toUserView(await this.requireUser(userId));
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserView> {
    const current = await this.requireUser(userId);
    if (dto.phone && dto.phone !== current.phone) {
      const phoneTaken = await this.prisma.client.user.findUnique({
        where: { phone: dto.phone },
        select: { id: true },
      });
      if (phoneTaken) throw ApiException.conflict('This phone number is already in use');
    }
    RequestContext.recordBefore(toUserView(current));
    const updated = await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.phone !== undefined
          ? { phone: dto.phone, phoneVerifiedAt: dto.phone === current.phone ? undefined : null }
          : {}),
        ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode } : {}),
        ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
      },
      include: USER_INCLUDE,
    });
    const view = toUserView(updated);
    RequestContext.recordAfter(view);
    return view;
  }

  // --- Helpers -------------------------------------------------------------------------------

  private async transition(
    current: UserWithRoles,
    status: UserStatus,
    eventType: string,
    payload: Record<string, unknown>,
    revokeSessions: boolean,
  ): Promise<UserView> {
    RequestContext.recordBefore(toUserView(current));
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: current.id },
        data: {
          status,
          ...(status === 'ACTIVE' ? { failedLoginAttempts: 0, lockedUntil: null } : {}),
        },
        include: USER_INCLUDE,
      });
      if (revokeSessions) {
        await tx.refreshToken.updateMany({
          where: { userId: current.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.outbox.publish(
        {
          aggregateType: 'User',
          aggregateId: current.id,
          eventType,
          payload: { userId: current.id, ...payload },
        },
        tx,
      );
      return row;
    });
    const view = toUserView(updated);
    RequestContext.recordAfter(view);
    return view;
  }

  private async sendInvitation(user: User): Promise<void> {
    try {
      const token = await this.auth.inviteToken(user);
      const portal = user.realm === 'ADMIN' ? this.adminPortalUrl : this.customerPortalUrl;
      await this.notifications.send({
        userId: user.id,
        channel: 'EMAIL',
        templateKey: 'password-reset',
        force: true,
        sensitive: true,
        variables: {
          resetUrl: `${portal}/reset-password?token=${encodeURIComponent(token)}`,
          code: '',
          expiresInMinutes: 24 * 60,
        },
      });
    } catch (error) {
      this.logger.error({ err: error, userId: user.id }, 'Failed to send invitation');
    }
  }

  /**
   * Accounts that hold SUPER_ADMIN may only be modified by a SUPER_ADMIN user. Otherwise any
   * holder of `users:write` could re-point a super-admin's e-mail and take the account over
   * through a password reset, and `users:suspend` / `users:delete` could lock every
   * super-admin out. Service accounts (API keys) never qualify, whatever their scopes.
   */
  private async assertMayManage(
    target: UserWithRoles,
    actor: AuthenticatedPrincipal,
  ): Promise<void> {
    const targetIsSuperAdmin = target.roles.some(
      (assignment) => assignment.role.name === SUPER_ADMIN_ROLE,
    );
    if (!targetIsSuperAdmin) return;
    if (actor.type !== 'USER' || !actor.userId) {
      throw ApiException.forbidden('Only a SUPER_ADMIN user can modify a SUPER_ADMIN account');
    }
    const { roles } = await this.permissions.resolve(actor.userId);
    if (!roles.includes(SUPER_ADMIN_ROLE)) {
      throw ApiException.forbidden('Only a SUPER_ADMIN user can modify a SUPER_ADMIN account');
    }
  }

  private async requireUser(id: string, includeDeleted = false): Promise<UserWithRoles> {
    const user = await this.prisma.client.user.findFirst({
      where: { id, ...(includeDeleted ? {} : { deletedAt: null }) },
      include: USER_INCLUDE,
    });
    if (!user) throw ApiException.notFound('User not found');
    return user;
  }

  private async assertNotLastSuperAdmin(userId: string): Promise<void> {
    const isSuperAdmin = await this.prisma.client.userRole.count({
      where: { userId, role: { name: 'SUPER_ADMIN' } },
    });
    if (!isSuperAdmin) return;
    const others = await this.prisma.client.userRole.count({
      where: {
        role: { name: 'SUPER_ADMIN' },
        userId: { not: userId },
        user: { deletedAt: null, status: 'ACTIVE' },
      },
    });
    if (others === 0) throw ApiException.conflict('Cannot delete the last active SUPER_ADMIN');
  }
}

export function toUserView(user: UserWithRoles): UserView {
  return {
    id: user.id,
    realm: user.realm,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    countryCode: user.countryCode,
    locale: user.locale,
    status: user.status,
    mfaEnabled: user.mfaEnabled,
    failedLoginAttempts: user.failedLoginAttempts,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
    roles: user.roles.map((assignment) => assignment.role.name).sort(),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    deletedAt: user.deletedAt,
  };
}
