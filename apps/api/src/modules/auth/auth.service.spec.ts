import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { RefreshToken, User } from '@bi-rem/db';

import type { AppConfig } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditEntry, AuditLogService } from '../audit/audit-log.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { OutboxService } from '../outbox/outbox.service.js';
import type { PermissionResolverService } from '../rbac/permission-resolver.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import { AuthService } from './auth.service.js';
import type { MfaService } from './mfa.service.js';
import type { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

const CONFIG: Record<string, unknown> = {
  jwtAccessTtlSeconds: 900,
  jwtRefreshTtlSeconds: 3600,
  JWT_ACCESS_SECRET: 'access-secret-access-secret-access-secret-1234',
  JWT_REFRESH_SECRET: 'refresh-secret-refresh-secret-refresh-secret-1234',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  CUSTOMER_PORTAL_URL: 'http://localhost:3000',
  ADMIN_PORTAL_URL: 'http://localhost:3001',
  APP_NAME: 'BI-Rem',
};
const config = { get: (key: string) => CONFIG[key] } as unknown as ConfigService<AppConfig, true>;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    realm: 'CUSTOMER',
    email: 'awa@example.com',
    phone: null,
    passwordHash: 'hash:correct-horse',
    status: 'ACTIVE',
    firstName: 'Awa',
    lastName: 'Diop',
    locale: 'en',
    countryCode: 'SN',
    mfaEnabled: false,
    mfaSecret: null,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

/** Minimal in-memory stand-in for the user and refresh_tokens tables. */
class FakeDb {
  users: User[] = [];
  tokens: RefreshToken[] = [];
  private seq = 0;

  readonly client = {
    user: {
      findUnique: jest.fn(
        async (args: { where: { realm_email?: { realm: string; email: string }; id?: string } }) =>
          this.users.find((u) =>
            args.where.realm_email
              ? u.realm === args.where.realm_email.realm && u.email === args.where.realm_email.email
              : u.id === args.where.id,
          ) ?? null,
      ),
      findFirst: jest.fn(
        async (args: { where: { id: string } }) =>
          this.users.find((u) => u.id === args.where.id) ?? null,
      ),
      update: jest.fn(async (args: { where: { id: string }; data: Partial<User> }) => {
        const user = this.users.find((u) => u.id === args.where.id)!;
        Object.assign(user, args.data);
        return user;
      }),
    },
    refreshToken: {
      create: jest.fn(async (args: { data: Partial<RefreshToken> }) => {
        const row: RefreshToken = {
          id: `tok-${++this.seq}`,
          tokenHash: '',
          userId: '',
          expiresAt: new Date(),
          revokedAt: null,
          replacedByTokenId: null,
          ip: null,
          userAgent: null,
          createdAt: new Date(),
          ...args.data,
        };
        this.tokens.push(row);
        return row;
      }),
      findUnique: jest.fn(
        async (args: {
          where: { tokenHash?: string; id?: string; replacedByTokenId?: string };
          include?: unknown;
        }) => {
          const row = this.tokens.find((t) =>
            args.where.tokenHash !== undefined
              ? t.tokenHash === args.where.tokenHash
              : args.where.id !== undefined
                ? t.id === args.where.id
                : t.replacedByTokenId === args.where.replacedByTokenId,
          );
          if (!row) return null;
          return args.include ? { ...row, user: this.users.find((u) => u.id === row.userId) } : row;
        },
      ),
      update: jest.fn(async (args: { where: { id: string }; data: Partial<RefreshToken> }) => {
        const row = this.tokens.find((t) => t.id === args.where.id)!;
        Object.assign(row, args.data);
        return row;
      }),
      updateMany: jest.fn(
        async (args: {
          where: {
            id?: string | { in: string[] };
            userId?: string;
            tokenHash?: string;
            revokedAt?: null;
            replacedByTokenId?: null;
          };
          data: Partial<RefreshToken>;
        }) => {
          let count = 0;
          for (const row of this.tokens) {
            const idOk =
              !args.where.id ||
              (typeof args.where.id === 'string'
                ? row.id === args.where.id
                : args.where.id.in.includes(row.id));
            const hashOk = !args.where.tokenHash || row.tokenHash === args.where.tokenHash;
            const userOk = !args.where.userId || row.userId === args.where.userId;
            const revokedOk = !('revokedAt' in args.where) || row.revokedAt === null;
            const replacedOk =
              !('replacedByTokenId' in args.where) || row.replacedByTokenId === null;
            if (idOk && hashOk && userOk && revokedOk && replacedOk) {
              Object.assign(row, args.data);
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(this.client)
        : Promise.all(arg as Array<Promise<unknown>>),
    ),
  };
}

interface Harness {
  service: AuthService;
  db: FakeDb;
  tokens: TokenService;
  audit: jest.Mock<(entry: AuditEntry) => Promise<null>>;
  verify: jest.Mock<(hash: string, password: string) => Promise<boolean>>;
  burn: jest.Mock<(password: string) => Promise<void>>;
  mfaVerify: jest.Mock<(userId: string, secret: string, code: string) => boolean>;
}

function harness(): Harness {
  const db = new FakeDb();
  const crypto = new CryptoService(config);
  const tokens = new TokenService(
    new JwtService({ secret: CONFIG.JWT_ACCESS_SECRET as string }),
    crypto,
    config,
  );
  const verify = jest.fn<(hash: string, password: string) => Promise<boolean>>(
    async (hash, password) => hash === `hash:${password}`,
  );
  const burn = jest.fn<(password: string) => Promise<void>>(async () => undefined);
  const passwords = {
    hash: async (p: string) => `hash:${p}`,
    verify,
    burn,
    needsRehash: () => false,
  } as unknown as PasswordService;
  const audit = jest.fn<(entry: AuditEntry) => Promise<null>>(async () => null);
  const mfaVerify = jest.fn<(userId: string, secret: string, code: string) => boolean>(() => false);
  const service = new AuthService(
    db as unknown as PrismaService,
    passwords,
    tokens,
    { enrol: jest.fn(), verify: mfaVerify } as unknown as MfaService,
    { send: jest.fn(async () => ({ status: 'QUEUED' })) } as unknown as NotificationService,
    { publish: jest.fn(async () => ({})) } as unknown as OutboxService,
    { record: audit } as unknown as AuditLogService,
    {
      resolve: jest.fn(async () => ({ roles: ['CUSTOMER'], permissions: ['profile:read'] })),
    } as unknown as PermissionResolverService,
    { isEnabled: jest.fn(async () => true) } as unknown as FeatureFlagsService,
    {
      getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
    } as unknown as SettingsService,
    config,
  );
  return { service, db, tokens, audit, verify, burn, mfaVerify };
}

const META = { ip: '127.0.0.1', userAgent: 'jest' };

describe('AuthService login + lockout', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    h.db.users.push(makeUser());
  });

  it('rejects unknown accounts with INVALID_CREDENTIALS after burning a hash (timing)', async () => {
    await expect(
      h.service.login({ email: 'nobody@example.com', password: 'x', realm: 'CUSTOMER' }, META),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(h.burn).toHaveBeenCalledWith('x');
    expect(h.verify).not.toHaveBeenCalled();
  });

  it('counts failed attempts and locks the account for 15 minutes on the fifth failure', async () => {
    const user = h.db.users[0]!;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(
        h.service.login({ email: user.email, password: 'wrong', realm: 'CUSTOMER' }, META),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(user.failedLoginAttempts).toBe(attempt);
      expect(user.lockedUntil).toBeNull();
    }
    const before = Date.now();
    await expect(
      h.service.login({ email: user.email, password: 'wrong', realm: 'CUSTOMER' }, META),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).not.toBeNull();
    const lockMs = user.lockedUntil!.getTime() - before;
    expect(lockMs).toBeGreaterThan(14 * 60_000);
    expect(lockMs).toBeLessThanOrEqual(15 * 60_000 + 1_000);
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.account.locked', outcome: 'DENIED' }),
    );

    // While locked even the correct password is refused and never verified.
    h.verify.mockClear();
    await expect(
      h.service.login({ email: user.email, password: 'correct-horse', realm: 'CUSTOMER' }, META),
    ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(h.verify).not.toHaveBeenCalled();
  });

  it('lets a user in once the lock has expired and resets the counters', async () => {
    const user = h.db.users[0]!;
    user.failedLoginAttempts = 3;
    user.lockedUntil = new Date(Date.now() - 1_000);
    const result = await h.service.login(
      { email: user.email, password: 'correct-horse', realm: 'CUSTOMER' },
      META,
    );
    expect('accessToken' in result).toBe(true);
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
    expect(user.lastLoginAt).toBeInstanceOf(Date);
  });

  it('refuses suspended accounts and realm mismatches', async () => {
    h.db.users[0]!.status = 'SUSPENDED';
    await expect(
      h.service.login(
        { email: 'awa@example.com', password: 'correct-horse', realm: 'CUSTOMER' },
        META,
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    h.db.users[0]!.status = 'ACTIVE';
    await expect(
      h.service.login(
        { email: 'awa@example.com', password: 'correct-horse', realm: 'ADMIN' },
        META,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('issues an MFA challenge instead of tokens when TOTP is enabled', async () => {
    Object.assign(h.db.users[0]!, { mfaEnabled: true, mfaSecret: 'enc' });
    const result = await h.service.login(
      { email: 'awa@example.com', password: 'correct-horse', realm: 'CUSTOMER' },
      META,
    );
    expect(result).toMatchObject({ mfaRequired: true, methods: ['TOTP'] });
    expect(h.db.tokens).toHaveLength(0);
    const claims = await h.tokens.verifyPurposeToken(
      (result as { mfaToken: string }).mfaToken,
      'mfa',
    );
    expect(claims.sub).toBe(h.db.users[0]!.id);
  });

  it('accepts a challenge token once: completing the login invalidates it', async () => {
    Object.assign(h.db.users[0]!, { mfaEnabled: true, mfaSecret: 'enc' });
    const challenge = await h.service.login(
      { email: 'awa@example.com', password: 'correct-horse', realm: 'CUSTOMER' },
      META,
    );
    if (!('mfaToken' in challenge)) throw new Error('expected challenge');

    // Wrong code: counted as a failed attempt, token stays usable.
    await expect(
      h.service.verifyMfa({ mfaToken: challenge.mfaToken, code: '000000' }, META),
    ).rejects.toMatchObject({ code: 'MFA_INVALID' });
    expect(h.db.users[0]!.failedLoginAttempts).toBe(1);

    h.mfaVerify.mockReturnValue(true);
    const tokens = await h.service.verifyMfa(
      { mfaToken: challenge.mfaToken, code: '123456' },
      META,
    );
    expect('accessToken' in tokens).toBe(true);
    expect(h.db.tokens).toHaveLength(1);

    // Replaying the same challenge after a session was issued must not mint a second session.
    await expect(
      h.service.verifyMfa({ mfaToken: challenge.mfaToken, code: '123456' }, META),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(h.db.tokens).toHaveLength(1);
  });
});

describe('AuthService refresh rotation', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    h.db.users.push(makeUser());
  });

  it('stores only the hash of the refresh token and binds the access token to the session', async () => {
    const result = await h.service.login(
      { email: 'awa@example.com', password: 'correct-horse', realm: 'CUSTOMER' },
      META,
    );
    if (!('accessToken' in result)) throw new Error('expected tokens');
    expect(h.db.tokens).toHaveLength(1);
    const row = h.db.tokens[0]!;
    expect(row.tokenHash).toBe(h.tokens.hashToken(result.refreshToken));
    expect(row.tokenHash).not.toBe(result.refreshToken);
    const claims = new JwtService({ secret: CONFIG.JWT_ACCESS_SECRET as string }).verify<{
      sid: string;
      sub: string;
      roles: string[];
    }>(result.accessToken);
    expect(claims.sid).toBe(row.id);
    expect(claims.sub).toBe(h.db.users[0]!.id);
    expect(claims.roles).toEqual(['CUSTOMER']);
    expect(result.expiresIn).toBe(900);
  });

  it('rotates: the old token is revoked and linked to its successor', async () => {
    const first = await h.service.login(
      { email: 'awa@example.com', password: 'correct-horse', realm: 'CUSTOMER' },
      META,
    );
    if (!('refreshToken' in first)) throw new Error('expected tokens');
    const second = await h.service.refresh({ refreshToken: first.refreshToken }, META);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    const [oldRow, newRow] = h.db.tokens;
    expect(oldRow!.revokedAt).toBeInstanceOf(Date);
    expect(oldRow!.replacedByTokenId).toBe(newRow!.id);
    expect(newRow!.revokedAt).toBeNull();
    expect(newRow!.tokenHash).toBe(h.tokens.hashToken(second.refreshToken));
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const first = await h.service.login(
      { email: 'awa@example.com', password: 'correct-horse', realm: 'CUSTOMER' },
      META,
    );
    if (!('refreshToken' in first)) throw new Error('expected tokens');
    const second = await h.service.refresh({ refreshToken: first.refreshToken }, META);
    const third = await h.service.refresh({ refreshToken: second.refreshToken }, META);
    // An unrelated session of the same user must survive.
    const other = await h.service.login(
      { email: 'awa@example.com', password: 'correct-horse', realm: 'CUSTOMER' },
      META,
    );
    if (!('refreshToken' in other)) throw new Error('expected tokens');

    await expect(
      h.service.refresh({ refreshToken: first.refreshToken }, META),
    ).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });

    const family = h.db.tokens.slice(0, 3);
    expect(family.every((row) => row.revokedAt instanceof Date)).toBe(true);
    const otherRow = h.db.tokens.find(
      (row) => row.tokenHash === h.tokens.hashToken(other.refreshToken),
    )!;
    expect(otherRow.revokedAt).toBeNull();
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.refresh.reuse-detected', outcome: 'DENIED' }),
    );
    // The latest (now revoked) token of the family cannot be used either.
    await expect(
      h.service.refresh({ refreshToken: third.refreshToken }, META),
    ).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
  });

  it('treats a lost concurrent rotation of the same token as reuse', async () => {
    const first = await h.service.login(
      { email: 'awa@example.com', password: 'correct-horse', realm: 'CUSTOMER' },
      META,
    );
    if (!('refreshToken' in first)) throw new Error('expected tokens');
    // Simulate another request rotating the row between our read and our guarded update.
    const original = h.db.client.refreshToken.updateMany.getMockImplementation()!;
    h.db.client.refreshToken.updateMany.mockImplementationOnce(async (args) => {
      h.db.tokens[0]!.replacedByTokenId = 'tok-elsewhere';
      h.db.tokens[0]!.revokedAt = new Date();
      return original(args);
    });
    await expect(
      h.service.refresh({ refreshToken: first.refreshToken }, META),
    ).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    expect(h.db.tokens[0]!.revokedAt).toBeInstanceOf(Date);
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.refresh.reuse-detected' }),
    );
  });

  it('rejects unknown and expired refresh tokens', async () => {
    await expect(
      h.service.refresh({ refreshToken: 'definitely-not-a-token-value' }, META),
    ).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    const login = await h.service.login(
      { email: 'awa@example.com', password: 'correct-horse', realm: 'CUSTOMER' },
      META,
    );
    if (!('refreshToken' in login)) throw new Error('expected tokens');
    h.db.tokens[0]!.expiresAt = new Date(Date.now() - 1);
    await expect(
      h.service.refresh({ refreshToken: login.refreshToken }, META),
    ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(h.db.tokens[0]!.revokedAt).toBeInstanceOf(Date);
  });

  it('logout revokes the current session, a given token, or every device', async () => {
    const a = await h.service.login(
      { email: 'awa@example.com', password: 'correct-horse', realm: 'CUSTOMER' },
      META,
    );
    const b = await h.service.login(
      { email: 'awa@example.com', password: 'correct-horse', realm: 'CUSTOMER' },
      META,
    );
    const c = await h.service.login(
      { email: 'awa@example.com', password: 'correct-horse', realm: 'CUSTOMER' },
      META,
    );
    if (!('refreshToken' in a) || !('refreshToken' in b) || !('refreshToken' in c))
      throw new Error('expected tokens');
    const principal = {
      type: 'USER' as const,
      id: 'u',
      userId: h.db.users[0]!.id,
      apiKeyId: null,
      realm: 'CUSTOMER' as const,
      email: null,
      roles: [],
      permissions: [],
      sessionId: h.db.tokens[0]!.id,
    };
    expect(await h.service.logout(principal, { allDevices: false })).toEqual({
      revokedSessions: 1,
    });
    expect(
      await h.service.logout(principal, { refreshToken: b.refreshToken, allDevices: false }),
    ).toEqual({ revokedSessions: 1 });
    expect(await h.service.logout(principal, { allDevices: true })).toEqual({ revokedSessions: 1 });
    expect(h.db.tokens.every((row) => row.revokedAt instanceof Date)).toBe(true);
  });
});

describe('AuthService password reset', () => {
  it('issues a single-use token bound to the current password hash', async () => {
    const h = harness();
    const user = makeUser();
    h.db.users.push(user);
    await h.service.requestPasswordReset({ email: user.email, realm: 'CUSTOMER' });
    const send = (h.service as unknown as { notifications: { send: jest.Mock } }).notifications
      .send;
    expect(send).toHaveBeenCalledTimes(1);
    const variables = (send.mock.calls[0]![0] as { variables: { resetUrl: string } }).variables;
    const token = decodeURIComponent(new URL(variables.resetUrl).searchParams.get('token')!);
    await h.service.confirmPasswordReset({ token, password: 'N3w-Password-Strong!' });
    expect(user.passwordHash).toBe('hash:N3w-Password-Strong!');
    // Second use fails because the fingerprint no longer matches.
    await expect(
      h.service.confirmPasswordReset({ token, password: 'An0ther-Password!!' }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('does not reveal whether an account exists', async () => {
    const h = harness();
    await expect(
      h.service.requestPasswordReset({ email: 'ghost@example.com', realm: 'CUSTOMER' }),
    ).resolves.toBeUndefined();
    expect(h.burn).toHaveBeenCalled();
  });
});
