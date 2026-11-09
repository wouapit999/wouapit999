import { z } from 'zod';

import { USER_STATUSES } from '../constants/realms.js';
import { strongPasswordSchema, userRealmSchema } from './auth.js';
import {
  countryCodeSchema,
  createListQuerySchema,
  e164PhoneSchema,
  emailSchema,
  hasAnyDefinedField,
  isoDateTimeSchema,
  localeSchema,
  personNameSchema,
  uuidSchema,
} from './common.js';

export const userStatusSchema = z.enum(USER_STATUSES);

/** Read model exposed to both portals. Never includes credentials or MFA secrets. */
export const userProfileSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  emailVerifiedAt: isoDateTimeSchema.nullable(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  countryCode: countryCodeSchema.nullable(),
  locale: localeSchema,
  realm: userRealmSchema,
  status: userStatusSchema,
  mfaEnabled: z.boolean(),
  roles: z.array(z.string()),
  lastLoginAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/** Self-service profile update (customer or admin editing their own account). */
export const updateProfileSchema = z
  .object({
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    phone: e164PhoneSchema.nullable().optional(),
    countryCode: countryCodeSchema.optional(),
    locale: localeSchema.optional(),
  })
  .strict()
  .refine(hasAnyDefinedField, { error: 'At least one field must be provided' });
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

/**
 * Admin-created accounts. When `password` is omitted the API sends an invitation with a
 * set-password link, which is the recommended flow for ADMIN-realm users.
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
    status: userStatusSchema.default('PENDING_VERIFICATION'),
    roleIds: z.array(uuidSchema).max(50).default([]),
    password: strongPasswordSchema.optional(),
    sendInvitation: z.boolean().default(true),
  })
  .strict()
  .refine((value) => value.roleIds.length === new Set(value.roleIds).size, {
    error: 'Role ids must be unique',
    path: ['roleIds'],
  });
export type AdminCreateUserInput = z.input<typeof adminCreateUserSchema>;
export type AdminCreateUserDto = z.infer<typeof adminCreateUserSchema>;

export const adminUpdateUserSchema = z
  .object({
    email: emailSchema.optional(),
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    phone: e164PhoneSchema.nullable().optional(),
    countryCode: countryCodeSchema.nullable().optional(),
    locale: localeSchema.optional(),
    status: userStatusSchema.optional(),
  })
  .strict()
  .refine(hasAnyDefinedField, { error: 'At least one field must be provided' });
export type AdminUpdateUserDto = z.infer<typeof adminUpdateUserSchema>;

export const updateUserStatusSchema = z
  .object({
    status: userStatusSchema,
    /** Required when suspending or locking, for the audit trail. */
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine(
    (value) => !(['SUSPENDED', 'LOCKED', 'DEACTIVATED'].includes(value.status) && !value.reason),
    {
      error: 'A reason is required when suspending, locking or deactivating a user',
      path: ['reason'],
    },
  );
export type UpdateUserStatusDto = z.infer<typeof updateUserStatusSchema>;

export const USER_SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'email',
  'lastName',
  'lastLoginAt',
  'status',
] as const;

export const listUsersQuerySchema = createListQuerySchema(USER_SORTABLE_FIELDS, 'createdAt')
  .extend({
    realm: userRealmSchema.optional(),
    status: userStatusSchema.optional(),
    countryCode: countryCodeSchema.optional(),
    roleId: uuidSchema.optional(),
    /** Free-text match on email, first or last name. */
    search: z.string().trim().min(1).max(100).optional(),
    mfaEnabled: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    createdFrom: isoDateTimeSchema.optional(),
    createdTo: isoDateTimeSchema.optional(),
  })
  .refine(
    (value) =>
      !value.createdFrom ||
      !value.createdTo ||
      new Date(value.createdFrom) <= new Date(value.createdTo),
    { error: 'createdFrom must be before createdTo', path: ['createdTo'] },
  );
export type ListUsersQueryInput = z.input<typeof listUsersQuerySchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
