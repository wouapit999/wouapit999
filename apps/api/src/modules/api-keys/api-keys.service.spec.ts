import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { ApiKey } from '@bi-rem/db';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import type { AppConfig } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { PermissionResolverService } from '../rbac/permission-resolver.service.js';
import { API_KEY_PREFIX, ApiKeysService } from './api-keys.service.js';

const config = {
  get: (key: string) =>
    key === 'ENCRYPTION_KEY' ? Buffer.alloc(32, 7).toString('base64') : undefined,
} as unknown as ConfigService<AppConfig, true>;

function actor(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    type: 'USER',
    id: 'u1',
    userId: 'u1',
    apiKeyId: null,
    realm: 'ADMIN',
    email: 'ops@example.com',
    roles: [],
    permissions: [],
    sessionId: 's1',
    ...overrides,
  };
}

function harness(resolved: { roles: string[]; permissions: string[] }) {
  const rows: ApiKey[] = [];
  const prisma = {
    client: {
      apiKey: {
        create: jest.fn(
          async (args: {
            data: Omit<ApiKey, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt' | 'revokedAt'>;
          }) => {
            const row: ApiKey = {
              id: `k-${rows.length + 1}`,
              lastUsedAt: null,
              revokedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...args.data,
            };
            rows.push(row);
            return row;
          },
        ),
        findUnique: jest.fn(
          async (args: { where: { keyHash?: string; id?: string } }) =>
            rows.find((row) =>
              args.where.keyHash ? row.keyHash === args.where.keyHash : row.id === args.where.id,
            ) ?? null,
        ),
        update: jest.fn(async () => ({})),
      },
    },
  };
  const resolver = {
    resolve: jest.fn(async () => resolved),
  } as unknown as PermissionResolverService;
  const service = new ApiKeysService(
    prisma as unknown as PrismaService,
    new CryptoService(config),
    resolver,
  );
  return { service, rows };
}

describe('ApiKeysService', () => {
  let admin: ReturnType<typeof harness>;

  beforeEach(() => {
    admin = harness({ roles: ['ADMIN'], permissions: ['users:read', 'users:write', 'audit:read'] });
  });

  it('stores only the hash and returns the plaintext once, usable for authentication', async () => {
    const created = await admin.service.create(
      { name: 'reporting', scopes: ['users:read'] },
      actor(),
    );
    expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(admin.rows[0]!.keyHash).not.toContain(created.key);
    expect(admin.rows[0]!.prefix).toBe(created.key.slice(0, 16));
    const principal = await admin.service.authenticate(created.key);
    expect(principal).toMatchObject({
      type: 'API_KEY',
      apiKeyId: created.id,
      permissions: ['users:read'],
    });
    expect(await admin.service.authenticate(`${API_KEY_PREFIX}wrong`)).toBeNull();
  });

  it('refuses scopes the creator does not hold, wildcards included', async () => {
    await expect(
      admin.service.create({ name: 'x', scopes: ['settings:read-secrets'] }, actor()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(admin.service.create({ name: 'x', scopes: ['*'] }, actor())).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    // users:* needs every users permission; this actor lacks users:delete etc.
    await expect(
      admin.service.create({ name: 'x', scopes: ['users:*'] }, actor()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      admin.service.create({ name: 'x', scopes: ['nope:read'] }, actor()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(admin.rows).toHaveLength(0);
  });

  it('lets SUPER_ADMIN mint any scope and rejects service accounts as creators', async () => {
    const root = harness({ roles: ['SUPER_ADMIN'], permissions: [] });
    const created = await root.service.create(
      { name: 'automation', scopes: ['*', 'audit:*'] },
      actor(),
    );
    expect(created.scopes).toEqual(['*', 'audit:*']);
    const apiKey = actor({ type: 'API_KEY', userId: null, apiKeyId: 'k0', permissions: ['*'] });
    await expect(
      root.service.create({ name: 'chain', scopes: ['users:read'] }, apiKey),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects expired and revoked keys', async () => {
    const created = await admin.service.create(
      {
        name: 'temp',
        scopes: ['audit:read'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      actor(),
    );
    admin.rows[0]!.expiresAt = new Date(Date.now() - 1);
    expect(await admin.service.authenticate(created.key)).toBeNull();
    admin.rows[0]!.expiresAt = null;
    admin.rows[0]!.revokedAt = new Date();
    expect(await admin.service.authenticate(created.key)).toBeNull();
  });
});
