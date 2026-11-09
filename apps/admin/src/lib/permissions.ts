import { PERMISSION_KEYS, type PermissionKey, parsePermission } from '@bi-rem/shared/constants';

/**
 * Permission helpers for the permission-aware UI. The current admin's effective permissions are
 * the union of their roles' permissions, delivered by `GET /v1/auth/me`. Everything here is a
 * pure function so it can be unit-tested and reused by server components.
 *
 * The catalogue the portal checks against is the shared one (`PERMISSION_KEYS`), which is also
 * what the API guards with and what the seed writes to the `permissions` table.
 */

/** Every permission code the portal may check. */
export type PermissionCode = PermissionKey;

export type PermissionSet = ReadonlySet<string>;

export function toPermissionSet(permissions: Iterable<string>): PermissionSet {
  return new Set(permissions);
}

export function hasPermission(granted: PermissionSet, required: PermissionCode): boolean {
  return granted.has(required);
}

export function hasAllPermissions(
  granted: PermissionSet,
  required: readonly PermissionCode[],
): boolean {
  return required.every((permission) => granted.has(permission));
}

export function hasAnyPermission(
  granted: PermissionSet,
  required: readonly PermissionCode[],
): boolean {
  return required.some((permission) => granted.has(permission));
}

/** Permissions required to open each section of the portal (read access). */
export const SECTION_PERMISSIONS = {
  dashboard: [] as readonly PermissionCode[],
  users: ['users:read'] as readonly PermissionCode[],
  roles: ['roles:read'] as readonly PermissionCode[],
  audit: ['audit:read'] as readonly PermissionCode[],
  templates: ['notification-templates:read'] as readonly PermissionCode[],
  settings: ['feature-flags:read', 'settings:read', 'api-keys:read'] as readonly PermissionCode[],
} as const;

export type SectionKey = keyof typeof SECTION_PERMISSIONS;

/** A section is visible when the admin holds at least one of its read permissions. */
export function canAccessSection(granted: PermissionSet, section: SectionKey): boolean {
  const required = SECTION_PERMISSIONS[section];
  return required.length === 0 || hasAnyPermission(granted, required);
}

export interface PermissionGroup {
  resource: string;
  /** Human-readable resource label, e.g. `notification-templates` → `Notification templates`. */
  label: string;
  /** Permission codes; may include table rows not (yet) present in the shared catalogue. */
  permissions: string[];
}

export function humanizeResource(resource: string): string {
  const spaced = resource.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Groups permission codes by resource, preserving the canonical order from `PERMISSION_KEYS` so
 * the matrix renders identically everywhere. Unknown codes (rows added server-side before the
 * shared package is updated) are appended at the end, grouped by their own resource.
 */
export function groupPermissionsByResource(codes: Iterable<string>): PermissionGroup[] {
  const known = new Set<string>(PERMISSION_KEYS);
  const requested = new Set(codes);
  const ordered: string[] = [
    ...PERMISSION_KEYS.filter((permission) => requested.has(permission)),
    ...[...requested].filter((code) => !known.has(code)).sort(),
  ];

  const groups = new Map<string, PermissionGroup>();
  for (const code of ordered) {
    const { resource } = splitPermission(code);
    let group = groups.get(resource);
    if (!group) {
      group = { resource, label: humanizeResource(resource), permissions: [] };
      groups.set(resource, group);
    }
    group.permissions.push(code);
  }
  return [...groups.values()];
}

/** `resource:action` → parts; codes without a colon (e.g. the `*` API-key scope) are one group. */
export function splitPermission(code: string): { resource: string; action: string } {
  if (!code.includes(':')) return { resource: code, action: code };
  return parsePermission(code as PermissionKey);
}

/** All action names appearing across the given groups, in first-seen order (matrix columns). */
export function collectActions(groups: readonly PermissionGroup[]): string[] {
  const actions: string[] = [];
  for (const group of groups) {
    for (const permission of group.permissions) {
      const { action } = splitPermission(permission);
      if (!actions.includes(action)) actions.push(action);
    }
  }
  return actions;
}

/** Union of the permissions granted by a set of roles (preview for role assignment). */
export function effectivePermissions(
  roles: ReadonlyArray<{ permissions: readonly string[] }>,
): string[] {
  const union = new Set<string>();
  for (const role of roles) {
    for (const permission of role.permissions) union.add(permission);
  }
  return groupPermissionsByResource(union).flatMap((group) => group.permissions);
}
