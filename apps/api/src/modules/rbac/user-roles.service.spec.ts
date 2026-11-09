import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { PermissionResolverService } from './permission-resolver.service.js';
import { UserRolesService } from './user-roles.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROLES = {
  SUPER_ADMIN: { id: 'r-super', name: 'SUPER_ADMIN', isSystem: true },
  ADMIN: { id: 'r-admin', name: 'ADMIN', isSystem: true },
  SUPPORT_AGENT: { id: 'r-support', name: 'SUPPORT_AGENT', isSystem: true },
};

function principal(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    type: 'USER',
    id: 'actor',
    userId: 'actor',
    apiKeyId: null,
    realm: 'ADMIN',
    email: 'ops@example.com',
    roles: [],
    permissions: [],
    sessionId: 's',
    ...overrides,
  };
}

function harness(actorRoles: string[]) {
  const assignments: Array<{ userId: string; roleId: string }> = [];
  const roleList = Object.values(ROLES);
  const prisma = {
    client: {
      user: { findFirst: jest.fn(async () => ({ id: USER_ID, realm: 'ADMIN', deletedAt: null })) },
      role: {
        findUnique: jest.fn(
          async (args: { where: { id: string } }) =>
            roleList.find((r) => r.id === args.where.id) ?? null,
        ),
        findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
          roleList.filter((r) => args.where.id.in.includes(r.id)),
        ),
      },
      userRole: {
        findMany: jest.fn(async (args: { where: { userId: string } }) =>
          assignments
            .filter((a) => a.userId === args.where.userId)
            .map((a) => ({ role: roleList.find((r) => r.id === a.roleId)! })),
        ),
        upsert: jest.fn(
          async (args: { where: { userId_roleId: { userId: string; roleId: string } } }) => {
            const key = args.where.userId_roleId;
            if (!assignments.some((a) => a.userId === key.userId && a.roleId === key.roleId))
              assignments.push({ ...key });
            return {};
          },
        ),
        deleteMany: jest.fn(
          async (args: { where: { userId: string; roleId: string | { notIn: string[] } } }) => {
            for (let i = assignments.length - 1; i >= 0; i -= 1) {
              const a = assignments[i]!;
              const match =
                a.userId === args.where.userId &&
                (typeof args.where.roleId === 'string'
                  ? a.roleId === args.where.roleId
                  : !args.where.roleId.notIn.includes(a.roleId));
              if (match) assignments.splice(i, 1);
            }
            return { count: 0 };
          },
        ),
        count: jest.fn(async () => 5),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma.client)),
    },
  };
  const resolver = {
    resolve: jest.fn(async () => ({ roles: actorRoles, permissions: [] })),
    invalidate: jest.fn(async () => undefined),
  } as unknown as PermissionResolverService;
  const service = new UserRolesService(prisma as unknown as PrismaService, resolver);
  return { service, assignments };
}

describe('UserRolesService SUPER_ADMIN containment', () => {
  let admin: ReturnType<typeof harness>;
  let superAdmin: ReturnType<typeof harness>;

  beforeEach(() => {
    admin = harness(['ADMIN']);
    superAdmin = harness(['SUPER_ADMIN']);
  });

  it('lets an ADMIN assign ordinary roles but not SUPER_ADMIN', async () => {
    const result = await admin.service.assign(USER_ID, ROLES.SUPPORT_AGENT.id, principal());
    expect(result.roles.map((r) => r.name)).toEqual(['SUPPORT_AGENT']);
    await expect(
      admin.service.assign(USER_ID, ROLES.SUPER_ADMIN.id, principal()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(admin.assignments.some((a) => a.roleId === ROLES.SUPER_ADMIN.id)).toBe(false);
  });

  it('lets a SUPER_ADMIN grant SUPER_ADMIN', async () => {
    const result = await superAdmin.service.assign(USER_ID, ROLES.SUPER_ADMIN.id, principal());
    expect(result.roles.map((r) => r.name)).toEqual(['SUPER_ADMIN']);
  });

  it('blocks replace() from adding or removing SUPER_ADMIN for non-super actors', async () => {
    await expect(
      admin.service.replace(USER_ID, [ROLES.ADMIN.id, ROLES.SUPER_ADMIN.id], principal()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await superAdmin.service.replace(USER_ID, [ROLES.SUPER_ADMIN.id], principal());
    expect(superAdmin.assignments.map((a) => a.roleId)).toEqual([ROLES.SUPER_ADMIN.id]);
    // An ADMIN may not strip SUPER_ADMIN either.
    admin.assignments.push({ userId: USER_ID, roleId: ROLES.SUPER_ADMIN.id });
    await expect(
      admin.service.replace(USER_ID, [ROLES.ADMIN.id], principal()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      admin.service.unassign(USER_ID, ROLES.SUPER_ADMIN.id, principal()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('never lets a service account (API key) touch SUPER_ADMIN membership', async () => {
    const apiKey = principal({ type: 'API_KEY', userId: null, apiKeyId: 'k', permissions: ['*'] });
    await expect(
      superAdmin.service.assign(USER_ID, ROLES.SUPER_ADMIN.id, apiKey),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const result = await superAdmin.service.assign(USER_ID, ROLES.ADMIN.id, apiKey);
    expect(result.roles.map((r) => r.name)).toEqual(['ADMIN']);
  });
});
