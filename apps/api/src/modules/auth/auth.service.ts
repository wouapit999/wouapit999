import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, RefreshToken, User, UserRealm } from '@bi-rem/db';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import { RequestContext } from '../../common/context/request-context.js';
import { ApiException } from '../../common/errors/api-exception.js';
import type { AppConfig } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { PermissionResolverService } from '../rbac/permission-resolver.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  DEFAULT_LOCKOUT_MINUTES,
  DEFAULT_MAX_FAILED_LOGINS,
  INVITE_TTL_SECONDS,
  MFA_CHALLENGE_TTL_SECONDS,
  PASSWORD_RESET_TTL_SECONDS,
  SETTING_LOCKOUT_MINUTES,
  SETTING_MAX_FAILED_LOGINS,
} from './auth.constants.js';
import type {
  ChangePasswordDto,
  LoginDto,
  LogoutDto,
  MfaDisableDto,
  MfaEnableDto,
  MfaVerifyDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RefreshTokenDto,
  RegisterDto,
} from './dto/auth.dto.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
  deviceName?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
  methods: ['TOTP'];
}

export type LoginResult = AuthTokens | MfaChallenge;

export interface CurrentUserView {
  id: string;
  email: string;
  realm: UserRealm;
  firstName: string;
  lastName: string;
  phone: string | null;
  countryCode: string;
  locale: string;
  status: User['status'];
  mfaEnabled: boolean;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  roles: string[];
  permissions: string[];
  createdAt: Date;
}

export interface MfaSetupView {
  secret: string;
  otpauthUri: string;
}

const CUSTOMER_ROLE = 'CUSTOMER';
const REGISTRATION_FLAG = 'auth.registration.open';
/** Upper bound on the refresh-token family walk, to stay safe on corrupted chains. */
const MAX_FAMILY_WALK = 500;

/** Internal signal: another request rotated the same refresh token first. */
class RotationLostError extends Error {
  constructor() {
    super('refresh token already rotated');
    this.name = 'RotationLostError';
  }
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly customerPortalUrl: string;
  private readonly adminPortalUrl: string;
  private readonly appName: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly notifications: NotificationService,
    private readonly outbox: OutboxService,
    private readonly auditLog: AuditLogService,
    private readonly permissions: PermissionResolverService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly settings: SettingsService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.customerPortalUrl = config.get('CUSTOMER_PORTAL_URL', { infer: true });
    this.adminPortalUrl = config.get('ADMIN_PORTAL_URL', { infer: true });
    this.appName = config.get('APP_NAME', { infer: true });
  }

  // --- Registration ---------------------------------------------------------------------

  async register(dto: RegisterDto, meta: SessionMeta): Promise<AuthTokens> {
    if (
      !(await this.featureFlags.isEnabled(REGISTRATION_FLAG, {
        realm: 'CUSTOMER',
        countryCode: dto.countryCode,
      }))
    ) {
      throw ApiException.forbidden('Registration is currently closed');
    }
    const existing = await this.prisma.client.user.findUnique({
      where: { realm_email: { realm: 'CUSTOMER', email: dto.email } },
      select: { id: true },
    });
    if (existing) throw ApiException.conflict('An account with this email already exists');
    if (dto.phone) {
      const phoneTaken = await this.prisma.client.user.findUnique({
        where: { phone: dto.phone },
        select: { id: true },
      });
      if (phoneTaken)
        throw ApiException.conflict('An account with this phone number already exists');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          realm: 'CUSTOMER',
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone ?? null,
          countryCode: dto.countryCode,
          locale: dto.locale,
          status: 'ACTIVE',
        },
      });
      const customerRole = await tx.role.findUnique({ where: { name: CUSTOMER_ROLE } });
      if (customerRole) {
        await tx.userRole.create({ data: { userId: created.id, roleId: customerRole.id } });
      } else {
        this.logger.warn('CUSTOMER role missing: run the database seed');
      }
      await this.outbox.publish(
        {
          aggregateType: 'User',
          aggregateId: created.id,
          eventType: 'user.registered',
          payload: { userId: created.id, realm: created.realm, countryCode: created.countryCode },
        },
        tx,
      );
      return created;
    });
    RequestContext.setResourceId(user.id);

    void this.notifications
      .send({
        userId: user.id,
        channel: 'EMAIL',
        templateKey: 'welcome',
        variables: { portalUrl: this.customerPortalUrl },
      })
      .catch((error: unknown) =>
        this.logger.warn({ err: error, userId: user.id }, 'Welcome e-mail failed'),
      );

    return this.issueSession(user, meta);
  }

  // --- Login / MFA ----------------------------------------------------------------------

  async login(dto: LoginDto, meta: SessionMeta): Promise<LoginResult> {
    return this.authenticate(dto.realm, dto.email, dto.password, {
      ...meta,
      deviceName: dto.deviceName ?? null,
    });
  }

  async authenticate(
    realm: UserRealm,
    email: string,
    password: string,
    meta: SessionMeta,
  ): Promise<LoginResult> {
    const user = await this.prisma.client.user.findUnique({
      where: { realm_email: { realm, email } },
    });
    if (!user || user.deletedAt || user.status === 'DELETED') {
      await this.passwords.burn(password);
      throw ApiException.invalidCredentials();
    }
    this.assertLoginAllowed(user);

    const valid = await this.passwords.verify(user.passwordHash, password);
    if (!valid) {
      await this.registerFailedAttempt(user);
      throw ApiException.invalidCredentials();
    }

    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.prisma.client.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.passwords.hash(password) },
      });
    }

    if (user.mfaEnabled && user.mfaSecret) {
      // Bound to the login state so a challenge token cannot be replayed once a session was issued.
      const mfaToken = await this.tokens.signPurposeToken(
        user.id,
        'mfa',
        MFA_CHALLENGE_TTL_SECONDS,
        this.mfaChallengeFingerprint(user),
      );
      await this.auditLog.record({
        action: 'auth.login.mfa-pending',
        resourceType: 'User',
        resourceId: user.id,
        outcome: 'SUCCESS',
        actorUserId: user.id,
      });
      return { mfaRequired: true, mfaToken, methods: ['TOTP'] };
    }

    return this.completeLogin(user, meta);
  }

  async verifyMfa(dto: MfaVerifyDto, meta: SessionMeta): Promise<AuthTokens> {
    const claims = await this.tokens.verifyPurposeToken(dto.mfaToken, 'mfa');
    const user = await this.prisma.client.user.findFirst({
      where: { id: claims.sub, deletedAt: null },
    });
    if (!user || !user.mfaEnabled || !user.mfaSecret)
      throw ApiException.unauthenticated('Invalid token');
    if (claims.fp !== this.mfaChallengeFingerprint(user)) {
      throw ApiException.unauthenticated('This login challenge has already been used');
    }
    this.assertLoginAllowed(user);
    if (!this.mfa.verify(user.id, user.mfaSecret, dto.code)) {
      await this.registerFailedAttempt(user);
      throw ApiException.mfaInvalid();
    }
    return this.completeLogin(user, meta);
  }

  private async completeLogin(user: User, meta: SessionMeta): Promise<AuthTokens> {
    const now = new Date();
    const refreshed = await this.prisma.client.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
    });
    const tokens = await this.issueSession(refreshed, meta);
    await this.outbox.publish({
      aggregateType: 'User',
      aggregateId: user.id,
      eventType: 'user.login_succeeded',
      payload: { userId: user.id, realm: user.realm, at: now.toISOString(), ip: meta.ip ?? null },
    });
    return tokens;
  }

  /** Creates the refresh-token session row and signs the matching access token. */
  async issueSession(user: User, meta: SessionMeta): Promise<AuthTokens> {
    const { roles, permissions } = await this.permissions.resolve(user.id);
    const refresh = this.tokens.generateRefreshToken();
    const session = await this.prisma.client.refreshToken.create({
      data: {
        tokenHash: refresh.hash,
        userId: user.id,
        expiresAt: refresh.expiresAt,
        ip: meta.ip?.slice(0, 45) ?? null,
        userAgent:
          [meta.deviceName, meta.userAgent].filter(Boolean).join(' | ').slice(0, 512) || null,
      },
    });
    const principal = this.toPrincipal(user, roles, permissions, session.id);
    RequestContext.setActor(principal);
    RequestContext.setResourceId(user.id);
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      realm: user.realm,
      email: user.email,
      roles,
      permissions,
      sid: session.id,
    });
    return {
      accessToken,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }

  // --- Refresh rotation -----------------------------------------------------------------

  async refresh(dto: RefreshTokenDto, meta: SessionMeta): Promise<AuthTokens> {
    const hash = this.tokens.hashToken(dto.refreshToken);
    const current = await this.prisma.client.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });
    if (!current) throw ApiException.tokenRevoked('Refresh token is invalid');

    if (current.revokedAt || current.replacedByTokenId) {
      // A rotated or revoked token was presented again: assume theft and kill the whole family.
      await this.handleRefreshReuse(current);
    }
    if (current.expiresAt.getTime() <= Date.now()) {
      await this.prisma.client.refreshToken.update({
        where: { id: current.id },
        data: { revokedAt: new Date() },
      });
      throw ApiException.tokenExpired('Refresh token has expired');
    }
    const user = current.user;
    if (user.deletedAt || user.status === 'DELETED') throw ApiException.tokenRevoked();
    this.assertLoginAllowed(user);

    const { roles, permissions } = await this.permissions.resolve(user.id);
    const next = this.tokens.generateRefreshToken();
    // Losing the race against a concurrent rotation of the same token is treated as reuse too.
    const session =
      (await this.rotate(current, next, meta)) ?? (await this.handleRefreshReuse(current));
    RequestContext.setActor(this.toPrincipal(user, roles, permissions, session.id));
    RequestContext.setResourceId(user.id);
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      realm: user.realm,
      email: user.email,
      roles,
      permissions,
      sid: session.id,
    });
    return {
      accessToken,
      refreshToken: next.token,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }

  /**
   * Atomically marks `current` as rotated and creates its successor. The guarded `updateMany`
   * only succeeds for the first of several concurrent rotations of the same token; the losers
   * get `null` (the successor row they created is rolled back with the transaction).
   */
  private async rotate(
    current: RefreshToken,
    next: ReturnType<TokenService['generateRefreshToken']>,
    meta: SessionMeta,
  ): Promise<RefreshToken | null> {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.refreshToken.create({
          data: {
            tokenHash: next.hash,
            userId: current.userId,
            expiresAt: next.expiresAt,
            ip: meta.ip?.slice(0, 45) ?? current.ip,
            userAgent: meta.userAgent?.slice(0, 512) ?? current.userAgent,
          },
        });
        const rotated = await tx.refreshToken.updateMany({
          where: { id: current.id, revokedAt: null, replacedByTokenId: null },
          data: { revokedAt: new Date(), replacedByTokenId: created.id },
        });
        if (rotated.count !== 1) throw new RotationLostError();
        return created;
      });
    } catch (error) {
      if (error instanceof RotationLostError) return null;
      throw error;
    }
  }

  /** Revokes the whole token family, records the incident and rejects the request. */
  private async handleRefreshReuse(current: RefreshToken): Promise<never> {
    const revoked = await this.revokeFamily(current);
    await this.auditLog.record({
      action: 'auth.refresh.reuse-detected',
      resourceType: 'RefreshToken',
      resourceId: current.id,
      outcome: 'DENIED',
      actorUserId: current.userId,
      metadata: { revokedSessions: revoked },
    });
    this.logger.warn(
      { userId: current.userId, tokenId: current.id },
      'Refresh token reuse detected',
    );
    throw ApiException.tokenRevoked('Refresh token reuse detected; all sessions were revoked');
  }

  /** Revokes every token linked to `start` through the rotation chain (both directions). */
  private async revokeFamily(start: RefreshToken): Promise<number> {
    const ids = new Set<string>([start.id]);
    let cursor: RefreshToken | null = start;
    for (let i = 0; cursor?.replacedByTokenId && i < MAX_FAMILY_WALK; i += 1) {
      const nextId: string = cursor.replacedByTokenId;
      if (ids.has(nextId)) break;
      ids.add(nextId);
      cursor = await this.prisma.client.refreshToken.findUnique({ where: { id: nextId } });
    }
    let predecessor = await this.prisma.client.refreshToken.findUnique({
      where: { replacedByTokenId: start.id },
    });
    for (let i = 0; predecessor && i < MAX_FAMILY_WALK; i += 1) {
      if (ids.has(predecessor.id)) break;
      ids.add(predecessor.id);
      predecessor = await this.prisma.client.refreshToken.findUnique({
        where: { replacedByTokenId: predecessor.id },
      });
    }
    const result = await this.prisma.client.refreshToken.updateMany({
      where: { id: { in: [...ids] }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  // --- Logout ---------------------------------------------------------------------------

  async logout(
    principal: AuthenticatedPrincipal,
    dto: LogoutDto,
  ): Promise<{ revokedSessions: number }> {
    if (!principal.userId) return { revokedSessions: 0 };
    const where: Prisma.RefreshTokenWhereInput = { userId: principal.userId, revokedAt: null };
    if (dto.allDevices) {
      // whole user
    } else if (dto.refreshToken) {
      where.tokenHash = this.tokens.hashToken(dto.refreshToken);
    } else if (principal.sessionId) {
      where.id = principal.sessionId;
    } else {
      return { revokedSessions: 0 };
    }
    const result = await this.prisma.client.refreshToken.updateMany({
      where,
      data: { revokedAt: new Date() },
    });
    return { revokedSessions: result.count };
  }

  // --- Current user ---------------------------------------------------------------------

  async me(principal: AuthenticatedPrincipal): Promise<CurrentUserView> {
    if (!principal.userId) throw ApiException.forbidden('API keys have no user profile');
    const user = await this.prisma.client.user.findFirst({
      where: { id: principal.userId, deletedAt: null },
    });
    if (!user) throw ApiException.notFound('User not found');
    const { roles, permissions } = await this.permissions.resolve(user.id);
    return {
      id: user.id,
      email: user.email,
      realm: user.realm,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      countryCode: user.countryCode,
      locale: user.locale,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      emailVerifiedAt: user.emailVerifiedAt,
      lastLoginAt: user.lastLoginAt,
      roles,
      permissions,
      createdAt: user.createdAt,
    };
  }

  // --- Password reset / change ------------------------------------------------------------

  /** Always resolves (and takes comparable time) so e-mail enumeration is not possible. */
  async requestPasswordReset(dto: PasswordResetRequestDto): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { realm_email: { realm: dto.realm, email: dto.email } },
    });
    if (!user || user.deletedAt || user.status === 'DELETED' || user.status === 'SUSPENDED') {
      await this.passwords.burn(dto.email);
      return;
    }
    const token = await this.tokens.signPurposeToken(
      user.id,
      'password_reset',
      PASSWORD_RESET_TTL_SECONDS,
      this.tokens.credentialFingerprint(user.passwordHash),
    );
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
        expiresInMinutes: PASSWORD_RESET_TTL_SECONDS / 60,
      },
    });
    RequestContext.setResourceId(user.id);
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto): Promise<void> {
    const claims = await this.tokens
      .verifyPurposeToken(dto.token, 'password_reset')
      .catch(async (error: unknown) => {
        // Invitation links reuse the reset flow with a longer TTL.
        if (error instanceof ApiException && error.code === 'UNAUTHENTICATED') {
          return this.tokens.verifyPurposeToken(dto.token, 'invite');
        }
        throw error;
      });
    const user = await this.prisma.client.user.findFirst({
      where: { id: claims.sub, deletedAt: null },
    });
    if (!user) throw ApiException.unauthenticated('Invalid token');
    if (claims.fp !== this.tokens.credentialFingerprint(user.passwordHash)) {
      throw ApiException.unauthenticated('This reset link has already been used');
    }
    const passwordHash = await this.passwords.hash(dto.password);
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
          ...(user.status === 'PENDING' ? { status: 'ACTIVE', emailVerifiedAt: new Date() } : {}),
        },
      }),
      this.prisma.client.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    RequestContext.setResourceId(user.id);
  }

  /** Issues an invitation token for admin-created accounts (set-password link, 24 h). */
  inviteToken(user: Pick<User, 'id' | 'passwordHash'>): Promise<string> {
    return this.tokens.signPurposeToken(
      user.id,
      'invite',
      INVITE_TTL_SECONDS,
      this.tokens.credentialFingerprint(user.passwordHash),
    );
  }

  async changePassword(principal: AuthenticatedPrincipal, dto: ChangePasswordDto): Promise<void> {
    if (!principal.userId) throw ApiException.forbidden('API keys cannot change passwords');
    const user = await this.prisma.client.user.findFirst({
      where: { id: principal.userId, deletedAt: null },
    });
    if (!user) throw ApiException.notFound('User not found');
    if (!(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw ApiException.invalidCredentials('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw ApiException.badRequest('New password must differ from the current password');
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({ where: { id: user.id }, data: { passwordHash } }),
      // Sign out every other device; the current session keeps working.
      this.prisma.client.refreshToken.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
          ...(principal.sessionId ? { id: { not: principal.sessionId } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // --- MFA enrolment --------------------------------------------------------------------

  async setupMfa(principal: AuthenticatedPrincipal): Promise<MfaSetupView> {
    const user = await this.requireUser(principal);
    if (user.mfaEnabled)
      throw ApiException.conflict('MFA is already enabled; disable it before re-enrolling');
    const enrolment = this.mfa.enrol(user.id, user.email);
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { mfaSecret: enrolment.encryptedSecret, mfaEnabled: false },
    });
    return { secret: enrolment.secret, otpauthUri: enrolment.otpauthUri };
  }

  async enableMfa(
    principal: AuthenticatedPrincipal,
    dto: MfaEnableDto,
  ): Promise<{ mfaEnabled: true }> {
    const user = await this.requireUser(principal);
    if (user.mfaEnabled) throw ApiException.conflict('MFA is already enabled');
    if (!user.mfaSecret)
      throw ApiException.badRequest('Start enrolment with /auth/mfa/setup first');
    if (!this.mfa.verify(user.id, user.mfaSecret, dto.code)) throw ApiException.mfaInvalid();
    await this.prisma.client.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    return { mfaEnabled: true };
  }

  async disableMfa(
    principal: AuthenticatedPrincipal,
    dto: MfaDisableDto,
  ): Promise<{ mfaEnabled: false }> {
    const user = await this.requireUser(principal);
    if (!user.mfaEnabled || !user.mfaSecret) throw ApiException.badRequest('MFA is not enabled');
    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      throw ApiException.invalidCredentials('Password is incorrect');
    }
    if (!this.mfa.verify(user.id, user.mfaSecret, dto.code)) throw ApiException.mfaInvalid();
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecret: null },
    });
    return { mfaEnabled: false };
  }

  // --- Helpers --------------------------------------------------------------------------

  private async requireUser(principal: AuthenticatedPrincipal): Promise<User> {
    if (!principal.userId) throw ApiException.forbidden('This endpoint requires a user session');
    const user = await this.prisma.client.user.findFirst({
      where: { id: principal.userId, deletedAt: null },
    });
    if (!user) throw ApiException.notFound('User not found');
    return user;
  }

  private assertLoginAllowed(user: User): void {
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw ApiException.accountLocked(
        `Account is locked until ${user.lockedUntil.toISOString()} after too many failed attempts`,
      );
    }
    switch (user.status) {
      case 'SUSPENDED':
        throw ApiException.accountSuspended();
      case 'LOCKED':
        throw ApiException.accountLocked('Account is locked; contact support');
      case 'DELETED':
        throw ApiException.invalidCredentials();
      case 'ACTIVE':
      case 'PENDING':
        return;
    }
  }

  private async registerFailedAttempt(user: User): Promise<void> {
    const [maxFailed, lockoutMinutes] = await Promise.all([
      this.settings.getNumber(SETTING_MAX_FAILED_LOGINS, DEFAULT_MAX_FAILED_LOGINS),
      this.settings.getNumber(SETTING_LOCKOUT_MINUTES, DEFAULT_LOCKOUT_MINUTES),
    ]);
    const attempts = user.failedLoginAttempts + 1;
    const lock = attempts >= maxFailed;
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: lock
        ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + lockoutMinutes * 60_000) }
        : { failedLoginAttempts: attempts },
    });
    if (lock) {
      await this.auditLog.record({
        action: 'auth.account.locked',
        resourceType: 'User',
        resourceId: user.id,
        outcome: 'DENIED',
        actorUserId: user.id,
        metadata: { attempts, lockoutMinutes },
      });
      this.logger.warn(
        { userId: user.id, attempts },
        'Account locked after repeated failed logins',
      );
    }
  }

  /** Changes whenever a session is issued or the password changes, invalidating pending MFA challenges. */
  private mfaChallengeFingerprint(user: Pick<User, 'lastLoginAt' | 'passwordHash'>): string {
    return this.tokens.credentialFingerprint(
      `${user.lastLoginAt?.toISOString() ?? 'never'}:${user.passwordHash}`,
    );
  }

  private toPrincipal(
    user: User,
    roles: string[],
    permissions: string[],
    sessionId: string,
  ): AuthenticatedPrincipal {
    return {
      type: 'USER',
      id: user.id,
      userId: user.id,
      apiKeyId: null,
      realm: user.realm,
      email: user.email,
      roles,
      permissions,
      sessionId,
    };
  }
}
