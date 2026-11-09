import { PERMISSION_PATTERN } from '@bi-rem/shared/constants';
import {
  auditOutcomeSchema,
  countryCodeSchema,
  createPaginatedSchema,
  e164PhoneSchema,
  emailSchema,
  featureFlagKeySchema,
  isoDateTimeSchema,
  localeSchema,
  mfaChallengeSchema,
  notificationChannelSchema,
  permissionRecordSchema as sharedPermissionRecordSchema,
  personNameSchema,
  roleNameSchema,
  settingKeySchema,
  settingValueSchema,
  userProfileSchema as sharedUserProfileSchema,
  userRealmSchema,
  uuidSchema,
} from '@bi-rem/shared/schemas';
import { PASSWORD_MAX_LENGTH } from '@bi-rem/shared/schemas';
import { z } from 'zod';

/**
 * Wire and form schemas for the admin portal.
 *
 * Shared DTO schemas from `@bi-rem/shared` are reused wherever the NestJS API (`apps/api`) and
 * the shared package agree. Where the API's actual DTOs / view models differ from the shared
 * draft (the API is the source of truth: it validates bodies with `forbidNonWhitelisted`, so an
 * extra field is a 400, and it returns Prisma rows that lack some fields the shared read models
 * declare), the exact shapes are defined here and documented in the README's contract table.
 */

// --- Auth -------------------------------------------------------------------------------------

export const loginFormSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: 'Required' }).max(PASSWORD_MAX_LENGTH),
});
export type LoginFormValues = z.infer<typeof loginFormSchema>;

/**
 * User read model (`UserView`). `countryCode` and `locale` are stored as free text (the API
 * defaults new accounts to `SN`, which the shared country enum does not list yet), so they are
 * validated as short strings here instead of the shared enums; the UI resolves names leniently.
 */
export const userProfileSchema = sharedUserProfileSchema.extend({
  countryCode: z.string().trim().min(2).max(3).nullable(),
  locale: z.string().trim().min(2).max(10),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/**
 * `GET /v1/auth/me` (`CurrentUserView`): the profile plus role names and the effective
 * (role-union) permission codes. Unlike `UserView` it carries no `updatedAt`.
 */
export const adminMeSchema = userProfileSchema.omit({ updatedAt: true }).extend({
  updatedAt: isoDateTimeSchema.optional(),
  permissions: z.array(z.string()),
});
export type AdminMe = z.infer<typeof adminMeSchema>;

/**
 * Login/refresh response (`AuthTokens`): `{ accessToken, refreshToken, tokenType, expiresIn }`.
 * `expiresIn` drives the access-cookie lifetime; `user` is accepted for forward compatibility.
 */
export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenType: z.literal('Bearer').optional(),
  expiresIn: z.number().int().positive().optional(),
  user: userProfileSchema.optional(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const loginResultSchema = z.union([authSessionSchema, mfaChallengeSchema]);
export type LoginResult = z.infer<typeof loginResultSchema>;

export function isMfaChallenge(result: LoginResult): result is z.infer<typeof mfaChallengeSchema> {
  return 'mfaRequired' in result && result.mfaRequired;
}

/** Body of the BFF login response: tokens never leave the server. */
export const bffSessionResponseSchema = z.object({
  ok: z.literal(true),
  user: userProfileSchema.nullable(),
});
export type BffSessionResponse = z.infer<typeof bffSessionResponseSchema>;

export const bffOkSchema = z.object({ ok: z.literal(true) });

// --- Users ------------------------------------------------------------------------------------

export const paginatedUsersSchema = createPaginatedSchema(userProfileSchema);
export type PaginatedUsers = z.infer<typeof paginatedUsersSchema>;

/**
 * `POST /v1/users` body (`AdminCreateUserDto`). The shared `adminCreateUserSchema` also carries a
 * `status` field the API does not whitelist, so the accepted subset is spelled out here. The
 * password is never set from the portal: the API generates one and e-mails an invitation.
 */
export const adminCreateUserSchema = z
  .object({
    email: emailSchema,
    realm: userRealmSchema,
    firstName: personNameSchema,
    lastName: personNameSchema,
    phone: e164PhoneSchema.optional(),
    countryCode: countryCodeSchema.optional(),
    locale: localeSchema.default('en'),
    roleIds: z.array(uuidSchema).max(50).default([]),
    sendInvitation: z.boolean().default(true),
  })
  .strict()
  .refine((value) => value.roleIds.length === new Set(value.roleIds).size, {
    error: 'Role ids must be unique',
    path: ['roleIds'],
  });
export type AdminCreateUserDto = z.infer<typeof adminCreateUserSchema>;

/**
 * `POST /v1/users/:id/suspend` and `POST /v1/users/:id/reactivate` (`StatusReasonDto`): both
 * require a reason, which the API stores on the audit row.
 */
export const statusReasonSchema = z.object({
  reason: z.string().trim().min(3, { error: 'Give at least 3 characters' }).max(500),
});
export type StatusReasonDto = z.infer<typeof statusReasonSchema>;
/** @deprecated alias kept for readability at call sites that only suspend. */
export const suspendUserSchema = statusReasonSchema;
export type SuspendUserDto = StatusReasonDto;

/** `PUT /v1/users/:id/roles` answers with the user's new role set, not the profile. */
export const userRolesViewSchema = z.object({
  userId: uuidSchema,
  roles: z.array(z.object({ id: uuidSchema, name: z.string(), isSystem: z.boolean() })),
});
export type UserRolesView = z.infer<typeof userRolesViewSchema>;

// --- RBAC -------------------------------------------------------------------------------------

/**
 * Role bodies accept any well-formed `resource:action` code rather than the closed
 * `permissionSchema` enum: the matrix also lists rows that exist in the `permissions` table but
 * were added server-side ahead of a portal release, and the API rejects unknown codes with a
 * field error that the form displays.
 */
export const permissionCodeSchema = z
  .string()
  .regex(PERMISSION_PATTERN, { error: 'Permissions look like resource:action' });

const uniqueStrings = (values: readonly string[]) => values.length === new Set(values).size;

export const createRoleSchema = z
  .object({
    name: roleNameSchema,
    description: z.string().trim().max(500).optional(),
    permissions: z.array(permissionCodeSchema).max(200).default([]),
  })
  .strict()
  .refine((value) => uniqueStrings(value.permissions), {
    error: 'Permissions must be unique',
    path: ['permissions'],
  });
export type CreateRoleDto = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: roleNameSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    permissions: z.array(permissionCodeSchema).max(200).optional(),
  })
  .strict()
  .refine((value) => value.permissions === undefined || uniqueStrings(value.permissions), {
    error: 'Permissions must be unique',
    path: ['permissions'],
  });
export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;

/**
 * `GET /v1/permissions` (`PermissionView`): `{ id | null, key, description }`. `id` is null for
 * catalogue entries that exist in code but have not been seeded into the table yet.
 */
export const permissionRecordSchema = z.object({
  id: uuidSchema.nullable(),
  key: permissionCodeSchema,
  description: z.string().nullable(),
});
export type PermissionRecord = z.infer<typeof permissionRecordSchema>;
export const permissionsListSchema = z.array(permissionRecordSchema);
/** Shared draft of the same record, exported so tests can assert the deliberate divergence. */
export { sharedPermissionRecordSchema };

/** `GET /v1/roles` (`RoleView`); the shared `roleSchema` plus the realm the role belongs to. */
export const roleSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  realm: userRealmSchema.nullable().optional(),
  permissions: z.array(z.string()),
  userCount: z.number().int().min(0).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Role = z.infer<typeof roleSchema>;
export const rolesListSchema = z.array(roleSchema);

// --- Audit ------------------------------------------------------------------------------------

export const auditActorTypeSchema = z.enum(['USER', 'SYSTEM', 'API_KEY']);

/**
 * `GET /v1/audit` items (`AuditLogView`). Differs from the shared `auditLogSchema`: the actor
 * kind is `actorType` (no `apiKeyId`), there is a free-form `metadata` member and
 * `correlationId` may be null for rows written outside an HTTP request.
 */
export const auditEntrySchema = z.object({
  id: uuidSchema,
  actorId: uuidSchema.nullable(),
  actorEmail: z.string().nullable(),
  actorRealm: userRealmSchema.nullable(),
  actorType: auditActorTypeSchema.default('USER'),
  action: z.string(),
  resource: z.string(),
  resourceId: z.string().nullable(),
  outcome: auditOutcomeSchema,
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  metadata: z.unknown().nullable().optional(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  correlationId: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const paginatedAuditSchema = createPaginatedSchema(auditEntrySchema);
export type PaginatedAudit = z.infer<typeof paginatedAuditSchema>;

/** Dotted lowercase action name, e.g. `users.update` (mirrors `AuditQueryDto`). */
export const auditActionFilterSchema = z
  .string()
  .trim()
  .max(128)
  .regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/, {
    error: 'Use dotted lowercase, e.g. users.update',
  });

/** PascalCase entity name, e.g. `User` (mirrors `AuditQueryDto`). */
export const auditResourceFilterSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[A-Z][A-Za-z0-9]*$/, { error: 'Use the PascalCase entity name, e.g. User' });

/**
 * Audit filter form. Empty strings mean "no filter"; the query-string names (`actorId`,
 * `resource`, …) are exactly those `AuditQueryDto` whitelists.
 */
export const auditFilterSchema = z.object({
  actorId: z.union([z.literal(''), uuidSchema]),
  resource: z.union([z.literal(''), auditResourceFilterSchema]),
  resourceId: z.string().trim().max(128),
  action: z.union([z.literal(''), auditActionFilterSchema]),
  from: z.string(),
  to: z.string(),
});
export type AuditFilterValues = z.infer<typeof auditFilterSchema>;

// --- Feature flags ----------------------------------------------------------------------------

export const FLAG_RULE_ATTRIBUTES = [
  'userId',
  'realm',
  'countryCode',
  'emailDomain',
  'role',
] as const;
export const FLAG_RULE_OPERATORS = ['eq', 'in', 'not_in'] as const;

/** Targeting rule stored on a flag (`FeatureFlagRuleDto`). */
export const featureFlagRuleSchema = z.object({
  attribute: z.enum(FLAG_RULE_ATTRIBUTES),
  op: z.enum(FLAG_RULE_OPERATORS),
  value: z.union([z.string(), z.array(z.string())]).optional(),
});
export type FeatureFlagRule = z.infer<typeof featureFlagRuleSchema>;

/** `GET /v1/feature-flags` items: the Prisma `FeatureFlag` row. */
export const featureFlagSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  enabled: z.boolean(),
  rolloutPercentage: z.number().int().min(0).max(100),
  /** Unknown rule shapes written by newer API versions are kept as-is for display counts. */
  rules: z.array(z.unknown()).default([]),
  description: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type FeatureFlag = z.infer<typeof featureFlagSchema>;
export const featureFlagsListSchema = z.array(featureFlagSchema);

/** `PUT /v1/feature-flags/:key` body (`UpsertFeatureFlagDto`): a full replacement. */
export const upsertFeatureFlagSchema = z
  .object({
    enabled: z.boolean(),
    description: z.string().trim().max(500).optional(),
    rolloutPercentage: z.number().int().min(0).max(100).default(100),
    rules: z.array(featureFlagRuleSchema).max(50).default([]),
  })
  .strict();
export type UpsertFeatureFlagDto = z.infer<typeof upsertFeatureFlagSchema>;
export { featureFlagKeySchema };

// --- Settings ---------------------------------------------------------------------------------

/** `GET /v1/settings` items (`SettingView`): secret values are returned as `null`. */
export const settingSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  value: settingValueSchema.nullable(),
  isSecret: z.boolean(),
  description: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Setting = z.infer<typeof settingSchema>;
export const settingsListSchema = z.array(settingSchema);

/** `PUT /v1/settings/:key` body (`UpsertSettingDto`); the key travels in the path. */
export const upsertSettingSchema = z
  .object({
    value: settingValueSchema,
    description: z.string().trim().max(500).optional(),
    isSecret: z.boolean().default(false),
  })
  .strict();
export type UpsertSettingDto = z.infer<typeof upsertSettingSchema>;
export { settingKeySchema };

// --- API keys ---------------------------------------------------------------------------------

/** Scope grammar accepted by `CreateApiKeyDto`: `resource:action`, `resource:*` or `*`. */
export const apiKeyScopeSchema = z.string().regex(/^(\*|[a-z][a-z0-9-]*:(\*|[a-z][a-z0-9-]*))$/, {
  error: 'Scopes look like resource:action, resource:* or *',
});

/** `GET /v1/api-keys` items (`ApiKeyView`); the hash is never returned. */
export const apiKeySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  /** First characters of the key, shown so operators can match a key to a client. */
  prefix: z.string(),
  scopes: z.array(z.string()),
  expiresAt: isoDateTimeSchema.nullable(),
  lastUsedAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
  createdById: uuidSchema,
  createdAt: isoDateTimeSchema,
});
export type ApiKey = z.infer<typeof apiKeySchema>;
export const apiKeysListSchema = z.array(apiKeySchema);

/** `POST /v1/api-keys` body (`CreateApiKeyDto`). */
export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(2, { error: 'Give at least 2 characters' }).max(100),
    scopes: z.array(apiKeyScopeSchema).min(1, { error: 'Select at least one permission' }).max(100),
    /** ISO date-time; omitted means the key never expires. */
    expiresAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .refine((value) => uniqueStrings(value.scopes), {
    error: 'Scopes must be unique',
    path: ['scopes'],
  });
export type CreateApiKeyDto = z.infer<typeof createApiKeySchema>;

/** `POST /v1/api-keys` response (`CreatedApiKey`): the view plus the plaintext `key`, once. */
export const createdApiKeySchema = apiKeySchema.extend({ key: z.string().min(1) });
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

// --- Notification templates -------------------------------------------------------------------

/** Template keys as `UpsertTemplateDto` accepts them: dotted lowercase, at most 64 chars. */
export const templateKeySchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/, {
    error: 'Use dotted lowercase, e.g. auth.password-reset',
  });

export const templateVariableSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/, { error: 'Variables are identifiers, e.g. firstName' });

/**
 * `GET /v1/notifications/templates` items: the Prisma `NotificationTemplate` row. `variables` is
 * a JSON column, so anything that is not an array of identifiers is normalised to `[]`.
 */
export const notificationTemplateSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  channel: notificationChannelSchema,
  locale: localeSchema,
  subject: z.string().nullable(),
  body: z.string(),
  variables: z
    .unknown()
    .transform((value) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [],
    ),
  isActive: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;
export const templatesListSchema = z.array(notificationTemplateSchema);

/** `PUT /v1/notifications/templates` body (`UpsertTemplateDto`), keyed by key + channel + locale. */
export const notificationTemplateUpsertSchema = z
  .object({
    key: templateKeySchema,
    channel: notificationChannelSchema,
    locale: localeSchema,
    subject: z.string().trim().min(1).max(255).optional(),
    body: z.string().min(1).max(20_000),
    variables: z.array(templateVariableSchema).max(50).default([]),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.channel === 'EMAIL' && !value.subject) {
      ctx.addIssue({
        code: 'custom',
        message: 'Email templates require a subject',
        path: ['subject'],
      });
    }
    if (!uniqueStrings(value.variables)) {
      ctx.addIssue({ code: 'custom', message: 'Variables must be unique', path: ['variables'] });
    }
    const declared = new Set(value.variables);
    for (const match of `${value.subject ?? ''} ${value.body}`.matchAll(
      /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g,
    )) {
      const name = match[1];
      if (name && !declared.has(name)) {
        ctx.addIssue({
          code: 'custom',
          message: `Placeholder "${name}" is not declared in variables`,
          path: ['variables'],
        });
      }
    }
  });
export type NotificationTemplateUpsertDto = z.infer<typeof notificationTemplateUpsertSchema>;

// --- Health -----------------------------------------------------------------------------------

/** `GET /health` (NestJS Terminus). `details` merges `info` and `error` per indicator. */
export const healthIndicatorSchema = z
  .object({ status: z.enum(['up', 'down']) })
  .catchall(z.unknown());

export const healthSchema = z.object({
  status: z.enum(['ok', 'error', 'shutting_down']),
  info: z.record(z.string(), healthIndicatorSchema).nullish(),
  error: z.record(z.string(), healthIndicatorSchema).nullish(),
  details: z.record(z.string(), healthIndicatorSchema).default({}),
});
export type HealthReport = z.infer<typeof healthSchema>;
