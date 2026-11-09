import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import type { AppConfig } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthService } from '../auth/auth.service.js';
import type { PasswordService } from '../auth/password.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { OutboxService } from '../outbox/outbox.service.js';
import type { PermissionResolverService } from '../rbac/permission-resolver.service.js';
import type { UserRolesService } from '../rbac/user-roles.service.js';
import { UsersService } from './users.service.js';

const SUPER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

const config = {
  get: (key: string) =>
    key === 'ADMIN_PORTAL_URL' ? 'http://localhost:3001' : 'http://localhost:3000',
} as unknown as ConfigService<AppConfig, true>;

interface FakeUser {
  id: string;
  realm: 'ADMIN' | 'CUSTOMER';
  email: string;
  phone: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'LOCKED' | 'PENDING' | 'DELETED';
  deletedAt: Date | null;
  roles: Array<{ role: { name: string } }>;
  [key: string]: unknown;
}

function fakeUser(id: string, roleNames: string[], overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id,
    realm: 'ADMIN',
    email: `${id.slice(0, 4)}@example.com`,
    emailVerifiedAt: null,
    firstName: 'Test',
    lastName: 'User',
    phone: null,
    countryCode: 'SN',
    locale: 'en',
    status: 'ACTIVE',
    mfaEnabled: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    roles: roleNames.map((name) => ({ role: { name } })),
    ...overrides,
  };
}

function principal(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    type: 'USER',
    id: ACTOR_ID,
    userId: ACTOR_ID,
    apiKeyId: null,
    realm: 'ADMIN',
    email: 'ops@example.com',
    roles: [],
    permissions: [],
    sessionId: 's1',
    ...overrides,
  };
}

function harness(actorRoles: string[]) {
  const users: FakeUser[] = [
    fakeUser(SUPER_ID, ['SUPER_ADMIN']),
    fakeUser(ADMIN_ID, ['ADMIN']),
    fakeUser(ACTOR_ID, actorRoles),
  ];
  const update = jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    const user = users.find((u) => u.id === args.where.id)!;
    Object.assign(user, args.data);
    return user;
  });
  const revokeSessions = jest.fn(async () => ({ count: 0 }));
  const prisma = {
    client: {
      user: {
        findFirst: jest.fn(
          async (args: { where: { id: string } }) =>
            users.find((u) => u.id === args.where.id) ?? null,
        ),
        findUnique: jest.fn(async () => null),
        update,
      },
      userRole: { count: jest.fn(async () => 5) },
      refreshToken: { updateMany: revokeSessions },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma.client)),
    },
  };
  const resolve = jest.fn(async () => ({ roles: actorRoles, permissions: [] }));
  const service = new UsersService(
    prisma as unknown as PrismaService,
    { hash: jest.fn(async () => 'hash') } as unknown as PasswordService,
    { inviteToken: jest.fn(async () => 'invite') } as unknown as AuthService,
    { send: jest.fn(async () => ({})) } as unknown as NotificationService,
    { publish: jest.fn(async () => ({})) } as unknown as OutboxService,
    { resolve, invalidate: jest.fn(async () => undefined) } as unknown as PermissionResolverService,
    { assertMayGrant: jest.fn(async () => undefined) } as unknown as UserRolesService,
    config,
  );
  return { service, users, update, revokeSessions, resolve };
}

describe('UsersService hierarchy guard (SUPER_ADMIN targets)', () => {
  let admin: ReturnType<typeof harness>;

  beforeEach(() => {
    admin = harness(['ADMIN']);
  });

  it('refuses an ADMIN re-pointing a SUPER_ADMIN e-mail (password-reset takeover vector)', async () => {
    await expect(
      admin.service.update(SUPER_ID, { email: 'attacker@evil.example' }, principal()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(admin.update).not.toHaveBeenCalled();
    expect(admin.users[0]!.email).not.toBe('attacker@evil.example');
  });

  it('refuses an ADMIN suspending or deleting a SUPER_ADMIN', async () => {
    await expect(admin.service.suspend(SUPER_ID, 'because', principal())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(admin.service.softDelete(SUPER_ID, 'because', principal())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(admin.users[0]!.status).toBe('ACTIVE');
    expect(admin.revokeSessions).not.toHaveBeenCalled();
  });

  it('refuses service accounts whatever their scopes', async () => {
    const apiKey = principal({
      type: 'API_KEY',
      id: 'k1',
      userId: null,
      apiKeyId: 'k1',
      permissions: ['*'],
      sessionId: null,
    });
    await expect(
      admin.service.update(SUPER_ID, { firstName: 'Mallory' }, apiKey),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(admin.resolve).not.toHaveBeenCalled();
  });

  it('still lets an ADMIN manage non-super-admin accounts', async () => {
    const view = await admin.service.update(ADMIN_ID, { firstName: 'Fatou' }, principal());
    expect(view.firstName).toBe('Fatou');
    const suspended = await admin.service.suspend(ADMIN_ID, 'policy', principal());
    expect(suspended.status).toBe('SUSPENDED');
    expect(admin.revokeSessions).toHaveBeenCalledTimes(1);
  });

  it('lets a SUPER_ADMIN user manage another SUPER_ADMIN', async () => {
    const root = harness(['SUPER_ADMIN']);
    const view = await root.service.update(SUPER_ID, { email: 'new@example.com' }, principal());
    expect(view.email).toBe('new@example.com');
    expect(view.emailVerifiedAt).toBeNull();
  });
});
