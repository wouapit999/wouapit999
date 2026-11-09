// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  adminCreateUserSchema,
  adminMeSchema,
  auditEntrySchema,
  auditFilterSchema,
  createApiKeySchema,
  createRoleSchema,
  createdApiKeySchema,
  featureFlagSchema,
  loginResultSchema,
  notificationTemplateSchema,
  notificationTemplateUpsertSchema,
  permissionRecordSchema,
  settingSchema,
  sharedPermissionRecordSchema,
  upsertFeatureFlagSchema,
  upsertSettingSchema,
  userRolesViewSchema,
} from '@/lib/schemas';

/**
 * Fixtures mirror the view models returned by `apps/api` (CurrentUserView, AuditLogView,
 * PermissionView, Prisma rows for flags/settings/templates, ApiKeyView). These tests pin the
 * portal to what the API actually sends, not to the shared package's draft read models.
 */
const now = '2026-01-01T00:00:00.000Z';
const uuid = '2c1e0f48-8c0d-4fd9-9d5f-1f4b0a9b0a11';

describe('wire schemas match the API view models', () => {
  it('accepts GET /v1/auth/me without updatedAt and keeps permissions', () => {
    const me = adminMeSchema.parse({
      id: uuid,
      email: 'ops@bi-rem.test',
      realm: 'ADMIN',
      firstName: 'Awa',
      lastName: 'Diop',
      phone: null,
      countryCode: 'SN',
      locale: 'en',
      status: 'ACTIVE',
      mfaEnabled: false,
      emailVerifiedAt: now,
      lastLoginAt: null,
      roles: ['ADMIN'],
      permissions: ['users:read', 'users:suspend'],
      createdAt: now,
    });
    expect(me.permissions).toContain('users:suspend');
    expect(me.updatedAt).toBeUndefined();
  });

  it('accepts audit rows with actorType/metadata and a null correlation id', () => {
    const entry = auditEntrySchema.parse({
      id: uuid,
      actorId: null,
      actorEmail: null,
      actorRealm: null,
      actorType: 'API_KEY',
      action: 'users.update',
      resource: 'User',
      resourceId: uuid,
      outcome: 'SUCCESS',
      before: { a: 1 },
      after: { a: 2 },
      metadata: null,
      ip: null,
      userAgent: null,
      correlationId: null,
      createdAt: now,
    });
    expect(entry.actorType).toBe('API_KEY');
  });

  it('only allows the audit filter names and formats AuditQueryDto whitelists', () => {
    expect(
      auditFilterSchema.safeParse({
        actorId: uuid,
        resource: 'User',
        resourceId: '',
        action: 'users.update',
        from: '',
        to: '',
      }).success,
    ).toBe(true);
    const bad = auditFilterSchema.safeParse({
      actorId: 'nope',
      resource: 'user',
      resourceId: '',
      action: 'Users.Update',
      from: '',
      to: '',
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.map((issue) => issue.path[0])).toEqual(
        expect.arrayContaining(['actorId', 'resource', 'action']),
      );
    }
  });

  it('reads the permission catalogue as { id | null, key, description }', () => {
    const record = { id: null, key: 'users:suspend', description: 'Suspend admin users' };
    expect(permissionRecordSchema.parse(record)).toEqual(record);
    // The shared draft expects `code` and a non-null id; the API does not send that shape.
    expect(sharedPermissionRecordSchema.safeParse(record).success).toBe(false);
  });

  it('accepts catalogue-only permissions in role bodies and rejects malformed codes', () => {
    expect(
      createRoleSchema.safeParse({ name: 'SUPPORT_LEAD', permissions: ['users:suspend'] }).success,
    ).toBe(true);
    expect(createRoleSchema.safeParse({ name: 'X', permissions: ['users'] }).success).toBe(false);
    expect(
      createRoleSchema.safeParse({ name: 'A_B', permissions: ['users:read', 'users:read'] })
        .success,
    ).toBe(false);
  });

  it('models PUT /v1/users/:id/roles as a role set, not a profile', () => {
    expect(
      userRolesViewSchema.parse({
        userId: uuid,
        roles: [{ id: uuid, name: 'ADMIN', isSystem: true }],
      }).roles,
    ).toHaveLength(1);
  });

  it('never sends a status field when creating a user', () => {
    const dto = adminCreateUserSchema.parse({
      email: 'New.Admin@bi-rem.test',
      realm: 'ADMIN',
      firstName: 'New',
      lastName: 'Admin',
    });
    expect(dto).toEqual({
      email: 'new.admin@bi-rem.test',
      realm: 'ADMIN',
      firstName: 'New',
      lastName: 'Admin',
      locale: 'en',
      roleIds: [],
      sendInvitation: true,
    });
    expect('status' in dto).toBe(false);
  });

  it('accepts Prisma FeatureFlag rows and builds a strict PUT body', () => {
    const flag = featureFlagSchema.parse({
      id: uuid,
      key: 'auth.mfa.totp',
      enabled: true,
      rolloutPercentage: 50,
      rules: [{ attribute: 'realm', op: 'eq', value: 'ADMIN' }],
      description: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(flag.rules).toHaveLength(1);
    expect(upsertFeatureFlagSchema.parse({ enabled: false })).toEqual({
      enabled: false,
      rolloutPercentage: 100,
      rules: [],
    });
    expect(upsertFeatureFlagSchema.safeParse({ enabled: true, realms: ['ADMIN'] }).success).toBe(
      false,
    );
  });

  it('accepts SettingView rows (no updatedBy) and keeps the key out of the PUT body', () => {
    expect(
      settingSchema.parse({
        id: uuid,
        key: 'platform.support-email',
        value: null,
        isSecret: true,
        description: null,
        createdAt: now,
        updatedAt: now,
      }).value,
    ).toBeNull();
    expect(upsertSettingSchema.parse({ value: 5 })).toEqual({ value: 5, isSecret: false });
    expect(upsertSettingSchema.safeParse({ key: 'a.b', value: 1 }).success).toBe(false);
  });

  it('uses scopes for API keys and reads the one-time secret from `key`', () => {
    expect(
      createApiKeySchema.safeParse({ name: 'worker', scopes: ['users:read', 'audit:*'] }).success,
    ).toBe(true);
    expect(
      createApiKeySchema.safeParse({ name: 'worker', permissions: ['users:read'] }).success,
    ).toBe(false);
    const created = createdApiKeySchema.parse({
      id: uuid,
      name: 'worker',
      prefix: 'brk_live_abc',
      scopes: ['*'],
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdById: uuid,
      createdAt: now,
      key: 'brk_live_abcdefghijklmnopqrstuvwxyz',
    });
    expect(created.key.startsWith(created.prefix)).toBe(true);
  });

  it('accepts template rows without category/version and normalises the variables JSON', () => {
    const template = notificationTemplateSchema.parse({
      id: uuid,
      key: 'auth.password-reset',
      channel: 'EMAIL',
      locale: 'en',
      subject: 'Reset',
      body: 'Hi {{firstName}}',
      variables: ['firstName', 42],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    expect(template.variables).toEqual(['firstName']);
    const upsert = notificationTemplateUpsertSchema.safeParse({
      key: 'auth.password-reset',
      channel: 'EMAIL',
      locale: 'en',
      subject: 'Reset',
      body: 'Hi {{firstName}}',
      variables: ['firstName'],
      category: 'SECURITY',
    });
    expect(upsert.success).toBe(false);
  });

  it('understands both login outcomes of POST /v1/auth/admin/login', () => {
    expect(
      loginResultSchema.safeParse({
        accessToken: 'a'.repeat(32),
        refreshToken: 'r'.repeat(32),
        tokenType: 'Bearer',
        expiresIn: 900,
      }).success,
    ).toBe(true);
    expect(
      loginResultSchema.safeParse({
        mfaRequired: true,
        mfaToken: 'm'.repeat(32),
        methods: ['TOTP'],
      }).success,
    ).toBe(true);
  });
});
