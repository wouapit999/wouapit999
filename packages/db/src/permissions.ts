/**
 * RBAC catalogue entry point for `@bi-rem/db`.
 *
 * The catalogue itself lives in `@bi-rem/shared` (`packages/shared/src/constants/permissions.ts`)
 * so that the API, the portals and this package's seed all read one definition. This module
 * re-exports it under the historical `@bi-rem/db/permissions` path: the seed upserts every key
 * into the `permissions` table and reconciles the system roles against it, so the code stays
 * authoritative over the database contents.
 */
export {
  PERMISSION_RESOURCES,
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_PATTERN,
  isPermissionKey,
  isPermission,
  parsePermission,
  permissionsForResource,
  readOnlyPermissions,
  hasPermission,
  SYSTEM_ROLE_NAMES,
  SYSTEM_ROLES,
  SYSTEM_ROLE_LIST,
  isSystemRoleName,
} from '@bi-rem/shared/constants';

// The `Permission` / `SystemRole` aliases are deliberately not re-exported: `Permission` is the
// name of the Prisma model exported from `@bi-rem/db`, so the key type is `PermissionKey` here.
export type {
  PermissionResource,
  PermissionKey,
  SystemRoleName,
  RoleRealm,
  SystemRoleDefinition,
} from '@bi-rem/shared/constants';
