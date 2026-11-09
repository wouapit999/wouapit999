import { z } from 'zod';

import { PERMISSION_KEYS } from '../constants/permissions.js';
import { hasAnyDefinedField, isoDateTimeSchema, uuidSchema } from './common.js';

export const permissionSchema = z.enum(PERMISSION_KEYS);

/** Role names are UPPER_SNAKE_CASE identifiers, 2–50 chars (e.g. `SUPPORT_LEAD`). */
export const roleNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{1,49}$/, { error: 'Role name must be UPPER_SNAKE_CASE (2–50 chars)' });

const uniquePermissions = (permissions: readonly string[]) =>
  permissions.length === new Set(permissions).size;

export const createRoleSchema = z
  .object({
    name: roleNameSchema,
    description: z.string().trim().max(500).optional(),
    permissions: z.array(permissionSchema).max(PERMISSION_KEYS.length).default([]),
  })
  .strict()
  .refine((value) => uniquePermissions(value.permissions), {
    error: 'Permissions must be unique',
    path: ['permissions'],
  });
export type CreateRoleInput = z.input<typeof createRoleSchema>;
export type CreateRoleDto = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: roleNameSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    /** Full replacement of the permission set when provided. */
    permissions: z.array(permissionSchema).max(PERMISSION_KEYS.length).optional(),
  })
  .strict()
  .refine(hasAnyDefinedField, { error: 'At least one field must be provided' })
  .refine((value) => value.permissions === undefined || uniquePermissions(value.permissions), {
    error: 'Permissions must be unique',
    path: ['permissions'],
  });
export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;

/** Replaces the set of roles assigned to a user (`PUT /users/:id/roles`). */
export const assignRolesSchema = z
  .object({
    roleIds: z.array(uuidSchema).min(0).max(50),
  })
  .strict()
  .refine((value) => value.roleIds.length === new Set(value.roleIds).size, {
    error: 'Role ids must be unique',
    path: ['roleIds'],
  });
export type AssignRolesDto = z.infer<typeof assignRolesSchema>;

export const permissionRecordSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  description: z.string().nullable(),
});
export type PermissionRecord = z.infer<typeof permissionRecordSchema>;

export const roleSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  /** Built-in roles cannot be deleted or renamed. */
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
  userCount: z.number().int().min(0).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Role = z.infer<typeof roleSchema>;
