/**
 * Canonical RBAC catalogue for BI-Rem — the single source of truth for permission keys and
 * system roles. `@bi-rem/db` re-exports this module (the seed upserts every entry into the
 * `permissions` table and reconciles the system roles against it), the API guards endpoints
 * with these keys (`@Permissions('users:read')`) and the portals build their permission UI
 * from the same list, so adding a permission here is all that is needed to make it available
 * to the whole platform.
 *
 * Permission keys follow the `resource:action` convention enforced by `PermissionsGuard`.
 * Keep this module free of runtime dependencies so that it can be consumed by the API, the
 * portals and the seed alike.
 */

export const PERMISSION_RESOURCES = [
  'users',
  'roles',
  'permissions',
  'audit',
  'notifications',
  'notification-templates',
  'notification-preferences',
  'settings',
  'feature-flags',
  'api-keys',
  'customers',
  'kyc',
  'transactions',
  'treasury',
  'reports',
  'system',
  'profile',
  'transfers',
  'beneficiaries',
] as const;

export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];

type PermissionKeyShape = `${PermissionResource}:${string}`;

/**
 * Every permission the platform knows about, with a human-readable description that is
 * stored in `permissions.description` and shown in the admin portal.
 */
export const PERMISSIONS = {
  // --- Identity & access (admin realm) ---------------------------------------------------
  'users:read': 'View admin users and their roles',
  'users:write': 'Create and update admin users',
  'users:delete': 'Soft-delete admin users',
  'users:suspend': 'Suspend or reactivate admin users',
  'users:unlock': 'Unlock accounts locked after failed logins and reset MFA',
  'roles:read': 'View roles and their permissions',
  'roles:write': 'Create and update non-system roles',
  'roles:delete': 'Delete non-system roles',
  'roles:assign': 'Assign roles to or remove roles from users',
  'permissions:read': 'View the permission catalogue',
  'api-keys:read': 'View API keys (metadata only, never the secret)',
  'api-keys:write': 'Create API keys',
  'api-keys:revoke': 'Revoke API keys',

  // --- Audit & observability ------------------------------------------------------------
  'audit:read': 'Search and view audit log entries',
  'audit:export': 'Export audit log entries',
  'reports:read': 'View operational and compliance reports',
  'reports:export': 'Export reports',
  'system:read': 'View system health, metrics and job status',
  'system:maintenance': 'Toggle maintenance mode and run maintenance jobs',

  // --- Notifications --------------------------------------------------------------------
  'notifications:read': 'View notification history and delivery status',
  'notifications:send': 'Send ad-hoc notifications to users',
  'notifications:retry': 'Retry failed notifications',
  'notifications:cancel': 'Cancel pending notifications',
  'notification-templates:read': 'View notification templates',
  'notification-templates:write': 'Create and update notification templates',
  'notification-templates:delete': 'Delete notification templates',
  'notification-preferences:read': 'View own notification preferences',
  'notification-preferences:write': 'Update own notification preferences',

  // --- Platform configuration -----------------------------------------------------------
  'settings:read': 'View non-secret settings',
  'settings:read-secrets': 'Reveal secret settings values',
  'settings:write': 'Update settings',
  'feature-flags:read': 'View feature flags',
  'feature-flags:write': 'Create and update feature flags',
  'feature-flags:delete': 'Delete feature flags',

  // --- Customers & compliance -----------------------------------------------------------
  'customers:read': 'View customer accounts',
  'customers:write': 'Update customer account details',
  'customers:suspend': 'Suspend or reactivate customer accounts',
  'customers:delete': 'Soft-delete customer accounts (GDPR erasure)',
  'customers:export': 'Export customer data',
  'kyc:read': 'View KYC submissions and status',
  'kyc:review': 'Pick up and annotate KYC cases',
  'kyc:approve': 'Approve KYC cases',
  'kyc:reject': 'Reject KYC cases',
  'kyc:override': 'Override an automated KYC decision',
  'kyc:submit': 'Submit own KYC documents (customer self-service)',

  // --- Money movement (admin side; detailed in later phases) ---------------------------
  'transactions:read': 'View transactions across all customers',
  'transactions:review': 'Hold, release or flag transactions',
  'transactions:reverse': 'Reverse or refund transactions',
  'treasury:read': 'View float balances, FX rates and liquidity',
  'treasury:write': 'Update FX rates, fees and corridor configuration',
  'treasury:approve': 'Approve treasury movements and settlement batches',

  // --- Customer self-service ------------------------------------------------------------
  'profile:read': 'View own profile',
  'profile:write': 'Update own profile and security settings',
  'transfers:read': 'View own transfers',
  'transfers:create': 'Initiate transfers',
  'beneficiaries:read': 'View own beneficiaries',
  'beneficiaries:write': 'Add, update or remove own beneficiaries',
} as const satisfies Record<PermissionKeyShape, string>;

export type PermissionKey = keyof typeof PERMISSIONS;

/** Alias kept for callers that predate the catalogue merge. */
export type Permission = PermissionKey;

/** All permission keys, in catalogue order. */
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as readonly PermissionKey[];

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

/** `resource:action`, lowercase kebab-case on both sides. */
export const PERMISSION_PATTERN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && PERMISSION_KEY_SET.has(value);
}

/** Same check as {@link isPermissionKey}, under the name the portals were written against. */
export function isPermission(value: string): value is PermissionKey {
  return PERMISSION_KEY_SET.has(value);
}

export function parsePermission(permission: PermissionKey): { resource: string; action: string } {
  const [resource, action] = permission.split(':') as [string, string];
  return { resource, action };
}

/** Returns the permission keys that belong to a resource (e.g. `users:*`). */
export function permissionsForResource(resource: PermissionResource): PermissionKey[] {
  return PERMISSION_KEYS.filter((key) => key.startsWith(`${resource}:`));
}

/** Returns every `resource:read` permission in the catalogue. */
export function readOnlyPermissions(): PermissionKey[] {
  return PERMISSION_KEYS.filter((key) => key.endsWith(':read'));
}

/**
 * Checks whether a set of granted scopes satisfies a required permission. Granted scopes
 * may contain wildcards (`users:*` or `*`), which is how API-key scopes are expressed.
 * Role-based permissions in the database are always concrete keys.
 */
export function hasPermission(granted: Iterable<string>, required: PermissionKey): boolean {
  const separator = required.indexOf(':');
  const resourceWildcard = `${required.slice(0, separator)}:*`;
  for (const scope of granted) {
    if (scope === required || scope === resourceWildcard || scope === '*') {
      return true;
    }
  }
  return false;
}

// -----------------------------------------------------------------------------------------
// System roles
// -----------------------------------------------------------------------------------------

export const SYSTEM_ROLE_NAMES = [
  'SUPER_ADMIN',
  'ADMIN',
  'COMPLIANCE_OFFICER',
  'SUPPORT_AGENT',
  'TREASURY_MANAGER',
  'VIEWER',
  'CUSTOMER',
] as const;

export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

/** Alias kept for callers that predate the catalogue merge. */
export type SystemRole = SystemRoleName;

/** Mirrors the `UserRealm` Prisma enum without importing the generated client. */
export type RoleRealm = 'ADMIN' | 'CUSTOMER';

export interface SystemRoleDefinition {
  readonly name: SystemRoleName;
  readonly description: string;
  /** Realm whose users may hold this role. */
  readonly realm: RoleRealm;
  readonly permissions: readonly PermissionKey[];
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

export const SYSTEM_ROLES: Readonly<Record<SystemRoleName, SystemRoleDefinition>> = {
  SUPER_ADMIN: {
    name: 'SUPER_ADMIN',
    realm: 'ADMIN',
    description: 'Unrestricted access to every resource, including secrets and maintenance.',
    permissions: PERMISSION_KEYS,
  },
  ADMIN: {
    name: 'ADMIN',
    realm: 'ADMIN',
    description:
      'Day-to-day platform administration: users, roles, configuration, customers and notifications.',
    permissions: unique([
      ...permissionsForResource('users'),
      ...permissionsForResource('roles'),
      'permissions:read',
      ...permissionsForResource('api-keys'),
      'audit:read',
      'audit:export',
      'reports:read',
      'reports:export',
      'system:read',
      ...permissionsForResource('notifications'),
      ...permissionsForResource('notification-templates'),
      'settings:read',
      'settings:write',
      ...permissionsForResource('feature-flags'),
      ...permissionsForResource('customers'),
      'kyc:read',
      'kyc:review',
      'transactions:read',
      'treasury:read',
    ]),
  },
  COMPLIANCE_OFFICER: {
    name: 'COMPLIANCE_OFFICER',
    realm: 'ADMIN',
    description: 'KYC/AML case handling, customer risk actions and audit review.',
    permissions: unique([
      'users:read',
      'customers:read',
      'customers:suspend',
      'customers:export',
      'kyc:read',
      'kyc:review',
      'kyc:approve',
      'kyc:reject',
      'kyc:override',
      'transactions:read',
      'transactions:review',
      'audit:read',
      'audit:export',
      'reports:read',
      'reports:export',
      'notifications:read',
    ]),
  },
  SUPPORT_AGENT: {
    name: 'SUPPORT_AGENT',
    realm: 'ADMIN',
    description:
      'First-line customer support: look up customers, unlock accounts, resend messages.',
    permissions: unique([
      'users:read',
      'customers:read',
      'customers:write',
      'kyc:read',
      'transactions:read',
      'notifications:read',
      'notifications:send',
      'notifications:retry',
      'notification-templates:read',
      'feature-flags:read',
      'audit:read',
    ]),
  },
  TREASURY_MANAGER: {
    name: 'TREASURY_MANAGER',
    realm: 'ADMIN',
    description: 'Float, FX and settlement management.',
    permissions: unique([
      ...permissionsForResource('treasury'),
      'transactions:read',
      'transactions:reverse',
      'customers:read',
      'reports:read',
      'reports:export',
      'settings:read',
      'audit:read',
    ]),
  },
  VIEWER: {
    name: 'VIEWER',
    realm: 'ADMIN',
    description: 'Read-only access to every admin resource (no secrets).',
    permissions: readOnlyPermissions().filter(
      (key) =>
        !key.startsWith('profile:') &&
        !key.startsWith('transfers:') &&
        !key.startsWith('beneficiaries:') &&
        key !== 'notification-preferences:read',
    ),
  },
  CUSTOMER: {
    name: 'CUSTOMER',
    realm: 'CUSTOMER',
    description: 'Default role for customer-portal accounts (self-service only).',
    permissions: unique([
      ...permissionsForResource('profile'),
      ...permissionsForResource('transfers'),
      ...permissionsForResource('beneficiaries'),
      'kyc:submit',
      ...permissionsForResource('notification-preferences'),
    ]),
  },
};

export const SYSTEM_ROLE_LIST: readonly SystemRoleDefinition[] = SYSTEM_ROLE_NAMES.map(
  (name) => SYSTEM_ROLES[name],
);

export function isSystemRoleName(value: unknown): value is SystemRoleName {
  return typeof value === 'string' && (SYSTEM_ROLE_NAMES as readonly string[]).includes(value);
}
