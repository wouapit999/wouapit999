import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  adminCreateUserSchema,
  adminUpdateUserSchema,
  apiErrorResponseSchema,
  assignRolesSchema,
  auditExportQuerySchema,
  auditLogQuerySchema,
  auditLogSchema,
  buildPaginationMeta,
  changePasswordSchema,
  createApiResponseSchema,
  createApiResultSchema,
  createPaginatedSchema,
  createRoleSchema,
  emailSchema,
  featureFlagEvaluationSchema,
  listNotificationsQuerySchema,
  listUsersQuerySchema,
  loginResponseSchema,
  loginSchema,
  mfaVerifySchema,
  notificationTemplateUpsertSchema,
  paginationQuerySchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  problemDetailsSchema,
  refreshTokenSchema,
  registerSchema,
  sendNotificationSchema,
  strongPasswordSchema,
  updateNotificationPreferencesSchema,
  updateProfileSchema,
  updateRoleSchema,
  updateUserStatusSchema,
  upsertFeatureFlagSchema,
  upsertSettingSchema,
  userProfileSchema,
  zodIssuesToFieldErrors,
} from '../index.js';

const UUID = '6f1c2a4e-9d2b-4c7a-8f3e-1a2b3c4d5e6f';
const UUID_2 = '0b7e9c1d-3f4a-4b5c-9d6e-7f8a9b0c1d2e';
const NOW = '2026-11-09T10:00:00.000Z';
const STRONG = 'Correct-Horse-9-Battery';

function expectRejects<T extends z.ZodType>(
  schema: T,
  input: unknown,
  pathOrMessage?: string | RegExp,
): void {
  const result = schema.safeParse(input);
  expect(result.success, JSON.stringify(input)).toBe(false);
  if (!result.success && pathOrMessage !== undefined) {
    const haystack = result.error.issues
      .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
      .join('\n');
    if (typeof pathOrMessage === 'string') {
      expect(haystack).toContain(pathOrMessage);
    } else {
      expect(haystack).toMatch(pathOrMessage);
    }
  }
}

describe('common schemas', () => {
  it('normalises emails', () => {
    expect(emailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
    expectRejects(emailSchema, 'not-an-email');
    expectRejects(emailSchema, `${'a'.repeat(250)}@example.com`);
  });

  it('strongPasswordSchema enforces every rule', () => {
    expect(strongPasswordSchema.parse(STRONG)).toBe(STRONG);
    expect(strongPasswordSchema.safeParse('long passphrase With Spaces 7!').success).toBe(true);
    expectRejects(strongPasswordSchema, 'Short1!', 'at least 12');
    expectRejects(strongPasswordSchema, 'alllowercase123!', 'uppercase');
    expectRejects(strongPasswordSchema, 'ALLUPPERCASE123!', 'lowercase');
    expectRejects(strongPasswordSchema, 'NoDigitsHere!!', 'digit');
    expectRejects(strongPasswordSchema, 'NoSymbolsHere123', 'symbol');
    expectRejects(strongPasswordSchema, ` ${STRONG}`, 'whitespace');
    expectRejects(strongPasswordSchema, `${STRONG}${'x'.repeat(128)}`, 'at most 128');
  });

  it('coerces pagination query strings and applies defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
    expectRejects(paginationQuerySchema, { page: '0' });
    expectRejects(paginationQuerySchema, { pageSize: '101' });
    expectRejects(paginationQuerySchema, { page: '1.5' });
  });

  it('builds pagination meta', () => {
    expect(buildPaginationMeta(2, 20, 45)).toEqual({
      page: 2,
      pageSize: 20,
      totalItems: 45,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
    expect(buildPaginationMeta(1, 20, 0)).toMatchObject({
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it('validates envelopes', () => {
    const paginated = createPaginatedSchema(userProfileSchema);
    const profile = userProfileSchema.parse({
      id: UUID,
      email: 'ada@example.com',
      emailVerifiedAt: NOW,
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: null,
      countryCode: 'CM',
      locale: 'fr',
      realm: 'CUSTOMER',
      status: 'ACTIVE',
      mfaEnabled: false,
      roles: ['CUSTOMER'],
      lastLoginAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(
      paginated.safeParse({ data: [profile], meta: buildPaginationMeta(1, 20, 1) }).success,
    ).toBe(true);
    expectRejects(paginated, {
      data: [{ ...profile, status: 'NOPE' }],
      meta: buildPaginationMeta(1, 20, 1),
    });

    const ok = createApiResponseSchema(userProfileSchema).parse({ success: true, data: profile });
    expect(ok.data.id).toBe(UUID);

    const err = apiErrorResponseSchema.parse({
      success: false,
      error: { code: 'NOT_FOUND', message: 'User not found', correlationId: 'abc-12345678' },
    });
    expect(err.error.code).toBe('NOT_FOUND');
    expectRejects(apiErrorResponseSchema, {
      success: false,
      error: { code: 'MADE_UP', message: 'x' },
    });

    const result = createApiResultSchema(userProfileSchema);
    expect(result.parse({ success: true, data: profile }).success).toBe(true);
    expect(result.parse(err).success).toBe(false);
  });

  it('validates RFC 9457 problem details with extensions', () => {
    const problem = problemDetailsSchema.parse({
      title: 'Validation failed',
      status: 422,
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'email', message: 'Invalid email address' }],
      correlationId: UUID,
      extra: 'kept',
    });
    expect(problem.type).toBe('about:blank');
    expect(problem.extra).toBe('kept');
    expectRejects(problemDetailsSchema, { title: 'x', status: 99 });
    expectRejects(problemDetailsSchema, { title: '', status: 400 });
    expectRejects(problemDetailsSchema, { title: 'x', status: 400, type: 'not a url' });
  });

  it('maps zod issues to field errors', () => {
    const result = registerSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = zodIssuesToFieldErrors(result.error);
      expect(fields.map((f) => f.path)).toEqual(
        expect.arrayContaining(['email', 'password', 'acceptTerms']),
      );
    }
  });
});

describe('auth schemas', () => {
  const validRegister = {
    email: 'ada@example.com',
    password: STRONG,
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+237655123456',
    countryCode: 'CM',
    acceptTerms: true,
  };

  it('register applies defaults and rejects bad payloads', () => {
    const parsed = registerSchema.parse(validRegister);
    expect(parsed.locale).toBe('en');
    expect(parsed.marketingOptIn).toBe(false);
    expectRejects(registerSchema, { ...validRegister, acceptTerms: false }, 'accept the terms');
    expectRejects(registerSchema, { ...validRegister, phone: '0655123456' }, 'E.164');
    expectRejects(registerSchema, { ...validRegister, countryCode: 'FR' });
    expectRejects(registerSchema, { ...validRegister, firstName: '<script>' });
    expectRejects(registerSchema, { ...validRegister, realm: 'ADMIN' }); // strict: unknown key
  });

  it('login defaults the realm and never evaluates password strength', () => {
    const parsed = loginSchema.parse({ email: 'ADA@example.com', password: 'weak' });
    expect(parsed).toEqual({ email: 'ada@example.com', password: 'weak', realm: 'CUSTOMER' });
    expect(loginSchema.parse({ ...parsed, realm: 'ADMIN' }).realm).toBe('ADMIN');
    expectRejects(loginSchema, { email: 'ada@example.com', password: '' });
    expectRejects(loginSchema, { email: 'ada@example.com', password: 'x', realm: 'ROOT' });
  });

  it('refresh, mfa and password flows', () => {
    expect(refreshTokenSchema.safeParse({ refreshToken: 'r'.repeat(40) }).success).toBe(true);
    expectRejects(refreshTokenSchema, { refreshToken: 'short' });

    expect(mfaVerifySchema.safeParse({ mfaToken: 'm'.repeat(40), code: '123456' }).success).toBe(
      true,
    );
    expect(
      mfaVerifySchema.safeParse({ mfaToken: 'm'.repeat(40), recoveryCode: 'abcde-12345' }).success,
    ).toBe(true);
    expectRejects(
      mfaVerifySchema,
      { mfaToken: 'm'.repeat(40) },
      'either a TOTP code or a recovery code',
    );
    expectRejects(mfaVerifySchema, {
      mfaToken: 'm'.repeat(40),
      code: '123456',
      recoveryCode: 'ABCDE12345',
    });
    expectRejects(mfaVerifySchema, { mfaToken: 'm'.repeat(40), code: '12345' }, '6 digits');

    expect(passwordResetRequestSchema.parse({ email: 'a@b.co' })).toEqual({
      email: 'a@b.co',
      realm: 'CUSTOMER',
    });
    expect(
      passwordResetConfirmSchema.safeParse({ token: 't'.repeat(40), password: STRONG }).success,
    ).toBe(true);
    expectRejects(passwordResetConfirmSchema, { token: 't'.repeat(40), password: 'weak' });

    expect(
      changePasswordSchema.safeParse({ currentPassword: 'old-password', newPassword: STRONG })
        .success,
    ).toBe(true);
    expectRejects(
      changePasswordSchema,
      { currentPassword: STRONG, newPassword: STRONG },
      'must differ',
    );
  });

  it('login response is either tokens or an MFA challenge', () => {
    expect(
      loginResponseSchema.safeParse({
        accessToken: 'a',
        refreshToken: 'r',
        tokenType: 'Bearer',
        expiresIn: 900,
      }).success,
    ).toBe(true);
    expect(
      loginResponseSchema.safeParse({ mfaRequired: true, mfaToken: 'x', methods: ['TOTP'] })
        .success,
    ).toBe(true);
    expectRejects(loginResponseSchema, {
      accessToken: 'a',
      refreshToken: 'r',
      tokenType: 'Basic',
      expiresIn: 900,
    });
  });
});

describe('user schemas', () => {
  it('updateProfile requires at least one field and forbids unknown keys', () => {
    expect(updateProfileSchema.parse({ firstName: 'Grace' })).toEqual({ firstName: 'Grace' });
    expect(updateProfileSchema.parse({ phone: null })).toEqual({ phone: null });
    expectRejects(updateProfileSchema, {}, 'At least one field');
    expectRejects(updateProfileSchema, { email: 'new@example.com' });
  });

  it('admin create/update users', () => {
    const created = adminCreateUserSchema.parse({
      email: 'ops@bi-rem.test',
      realm: 'ADMIN',
      firstName: 'Ops',
      lastName: 'Admin',
      roleIds: [UUID],
    });
    expect(created).toMatchObject({
      locale: 'en',
      status: 'PENDING_VERIFICATION',
      sendInvitation: true,
    });
    expectRejects(adminCreateUserSchema, { ...created, roleIds: [UUID, UUID] }, 'unique');
    expectRejects(adminCreateUserSchema, { ...created, password: 'weak' });
    expectRejects(adminCreateUserSchema, { ...created, realm: 'SYSTEM' });

    expect(adminUpdateUserSchema.parse({ status: 'SUSPENDED' })).toEqual({ status: 'SUSPENDED' });
    expectRejects(adminUpdateUserSchema, {});

    expect(updateUserStatusSchema.safeParse({ status: 'ACTIVE' }).success).toBe(true);
    expectRejects(updateUserStatusSchema, { status: 'SUSPENDED' }, 'reason is required');
    expect(
      updateUserStatusSchema.safeParse({ status: 'SUSPENDED', reason: 'Fraud review' }).success,
    ).toBe(true);
  });

  it('list users query coerces, defaults and restricts sorting', () => {
    const parsed = listUsersQuerySchema.parse({
      page: '2',
      search: ' ada ',
      mfaEnabled: 'true',
      realm: 'ADMIN',
    });
    expect(parsed).toMatchObject({
      page: 2,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      search: 'ada',
      mfaEnabled: true,
      realm: 'ADMIN',
    });
    expectRejects(listUsersQuerySchema, { sortBy: 'passwordHash' });
    expectRejects(
      listUsersQuerySchema,
      { createdFrom: '2026-02-01T00:00:00Z', createdTo: '2026-01-01T00:00:00Z' },
      'createdTo',
    );
    expectRejects(listUsersQuerySchema, { createdFrom: 'yesterday' });
  });
});

describe('rbac schemas', () => {
  it('create/update roles with known permissions only', () => {
    const role = createRoleSchema.parse({
      name: 'SUPPORT_LEAD',
      permissions: ['users:read', 'audit:read'],
    });
    expect(role.permissions).toHaveLength(2);
    expect(createRoleSchema.parse({ name: 'EMPTY' }).permissions).toEqual([]);
    expectRejects(createRoleSchema, { name: 'support lead' }, 'UPPER_SNAKE_CASE');
    expectRejects(createRoleSchema, { name: 'X', permissions: [] });
    expectRejects(createRoleSchema, { name: 'ROLE', permissions: ['users:nuke'] });
    expectRejects(
      createRoleSchema,
      { name: 'ROLE', permissions: ['users:read', 'users:read'] },
      'unique',
    );

    expect(updateRoleSchema.parse({ description: null })).toEqual({ description: null });
    expectRejects(updateRoleSchema, {}, 'At least one field');
  });

  it('assign roles', () => {
    expect(assignRolesSchema.parse({ roleIds: [UUID, UUID_2] }).roleIds).toHaveLength(2);
    expect(assignRolesSchema.parse({ roleIds: [] }).roleIds).toEqual([]);
    expectRejects(assignRolesSchema, { roleIds: [UUID, UUID] }, 'unique');
    expectRejects(assignRolesSchema, { roleIds: ['1'] });
  });
});

describe('audit schemas', () => {
  it('query validation', () => {
    const parsed = auditLogQuerySchema.parse({
      action: 'user.create',
      resource: 'User',
      outcome: 'SUCCESS',
    });
    expect(parsed.sortBy).toBe('createdAt');
    expectRejects(auditLogQuerySchema, { action: 'User.Create' });
    expectRejects(auditLogQuerySchema, { resource: 'user' });
    expectRejects(
      auditLogQuerySchema,
      { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
      'from must be before to',
    );
    expectRejects(auditLogQuerySchema, { sortBy: 'ip' });
    expect(auditExportQuerySchema.parse({}).format).toBe('csv');
    expectRejects(auditExportQuerySchema, { format: 'xlsx' });
  });

  it('read model', () => {
    const entry = auditLogSchema.parse({
      id: UUID,
      actorId: UUID_2,
      actorEmail: 'ops@bi-rem.test',
      actorRealm: 'ADMIN',
      apiKeyId: null,
      action: 'user.update',
      resource: 'User',
      resourceId: UUID,
      outcome: 'SUCCESS',
      before: { status: 'ACTIVE' },
      after: { status: 'SUSPENDED' },
      ip: '10.0.0.1',
      userAgent: 'vitest',
      correlationId: UUID,
      createdAt: NOW,
    });
    expect(entry.outcome).toBe('SUCCESS');
    expectRejects(auditLogSchema, { ...entry, outcome: 'MAYBE' });
  });
});

describe('notification schemas', () => {
  it('preferences: unique pairs, security always on', () => {
    expect(
      updateNotificationPreferencesSchema.safeParse({
        preferences: [
          { channel: 'EMAIL', category: 'MARKETING', enabled: false },
          { channel: 'SMS', category: 'TRANSACTIONAL', enabled: true },
        ],
      }).success,
    ).toBe(true);
    expectRejects(
      updateNotificationPreferencesSchema,
      { preferences: [{ channel: 'EMAIL', category: 'SECURITY', enabled: false }] },
      'cannot be disabled',
    );
    expectRejects(
      updateNotificationPreferencesSchema,
      {
        preferences: [
          { channel: 'EMAIL', category: 'MARKETING', enabled: false },
          { channel: 'EMAIL', category: 'MARKETING', enabled: true },
        ],
      },
      'Duplicate',
    );
    expectRejects(updateNotificationPreferencesSchema, { preferences: [] });
  });

  it('template upsert: subject for email, declared placeholders, sms length', () => {
    const valid = {
      key: 'auth.password-reset',
      channel: 'EMAIL',
      locale: 'fr',
      category: 'SECURITY',
      subject: 'Réinitialisation pour {{firstName}}',
      body: 'Bonjour {{ firstName }}, cliquez: {{resetUrl}}',
      variables: ['firstName', 'resetUrl'],
    };
    const parsed = notificationTemplateUpsertSchema.parse(valid);
    expect(parsed.isActive).toBe(true);
    expectRejects(
      notificationTemplateUpsertSchema,
      { ...valid, subject: undefined },
      'require a subject',
    );
    expectRejects(
      notificationTemplateUpsertSchema,
      { ...valid, variables: ['firstName'] },
      'resetUrl',
    );
    expectRejects(
      notificationTemplateUpsertSchema,
      { ...valid, key: 'PasswordReset' },
      'template key',
    );
    expectRejects(
      notificationTemplateUpsertSchema,
      { ...valid, variables: ['firstName', 'firstName', 'resetUrl'] },
      'unique',
    );
    expectRejects(
      notificationTemplateUpsertSchema,
      { ...valid, channel: 'SMS', subject: undefined, body: 'x'.repeat(1001), variables: [] },
      'SMS',
    );
    expect(
      notificationTemplateUpsertSchema.safeParse({
        ...valid,
        channel: 'SMS',
        subject: undefined,
        body: 'Code: {{code}}',
        variables: ['code'],
      }).success,
    ).toBe(true);
  });

  it('list query and ad-hoc send', () => {
    expect(listNotificationsQuerySchema.parse({ unreadOnly: 'true' }).unreadOnly).toBe(true);
    expectRejects(listNotificationsQuerySchema, { unreadOnly: 'yes' });
    expect(
      sendNotificationSchema.parse({ userId: UUID, templateKey: 'user.welcome', channel: 'EMAIL' })
        .variables,
    ).toEqual({});
    expectRejects(sendNotificationSchema, {
      userId: UUID,
      templateKey: 'user.welcome',
      channel: 'EMAIL',
      variables: { 'bad key': 1 },
    });
  });
});

describe('feature flag & settings schemas', () => {
  it('feature flag upsert', () => {
    const flag = upsertFeatureFlagSchema.parse({ key: 'auth.mfa.totp', enabled: true });
    expect(flag).toMatchObject({
      rolloutPercentage: 100,
      realms: ['CUSTOMER', 'ADMIN'],
      allowUserIds: [],
    });
    expectRejects(upsertFeatureFlagSchema, { key: 'mfa', enabled: true }, 'area.feature');
    expectRejects(upsertFeatureFlagSchema, {
      key: 'auth.mfa',
      enabled: true,
      rolloutPercentage: 101,
    });
    expectRejects(
      upsertFeatureFlagSchema,
      { key: 'auth.mfa', enabled: true, realms: ['ADMIN', 'ADMIN'] },
      'unique',
    );
    expectRejects(upsertFeatureFlagSchema, { key: 'auth.mfa', enabled: 'yes' });
    expect(featureFlagEvaluationSchema.parse({ 'auth.mfa.totp': true })).toEqual({
      'auth.mfa.totp': true,
    });
    expectRejects(featureFlagEvaluationSchema, { BadKey: true });
  });

  it('setting upsert accepts any JSON value', () => {
    expect(upsertSettingSchema.parse({ key: 'auth.max-failed-logins', value: 5 }).isSecret).toBe(
      false,
    );
    expect(
      upsertSettingSchema.safeParse({ key: 'platform.banner', value: { text: 'hi', until: null } })
        .success,
    ).toBe(true);
    expect(
      upsertSettingSchema.safeParse({ key: 'platform.list', value: ['a', 1, true] }).success,
    ).toBe(true);
    expectRejects(upsertSettingSchema, { key: 'platform.banner', value: new Date() });
    expectRejects(upsertSettingSchema, { key: 'Platform', value: 1 }, 'area.name');
    expectRejects(upsertSettingSchema, { key: 'platform.banner', value: 1, extra: true });
  });
});
