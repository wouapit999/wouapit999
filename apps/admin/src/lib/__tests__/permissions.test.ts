import { PERMISSION_KEYS } from '@bi-rem/shared/constants';
import { describe, expect, it } from 'vitest';

import {
  canAccessSection,
  collectActions,
  effectivePermissions,
  groupPermissionsByResource,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  humanizeResource,
  toPermissionSet,
} from '@/lib/permissions';

describe('permission helpers', () => {
  const granted = toPermissionSet(['users:read', 'audit:read', 'system:health']);

  it('checks single, all and any permissions', () => {
    expect(hasPermission(granted, 'users:read')).toBe(true);
    expect(hasPermission(granted, 'users:write')).toBe(false);
    expect(hasAllPermissions(granted, ['users:read', 'audit:read'])).toBe(true);
    expect(hasAllPermissions(granted, ['users:read', 'users:write'])).toBe(false);
    expect(hasAnyPermission(granted, ['users:write', 'audit:read'])).toBe(true);
    expect(hasAnyPermission(granted, [])).toBe(false);
    expect(hasAllPermissions(granted, [])).toBe(true);
  });

  it('opens a section when any of its read permissions is held', () => {
    expect(canAccessSection(granted, 'dashboard')).toBe(true);
    expect(canAccessSection(granted, 'users')).toBe(true);
    expect(canAccessSection(granted, 'roles')).toBe(false);
    expect(canAccessSection(toPermissionSet(['api-keys:read']), 'settings')).toBe(true);
    expect(canAccessSection(toPermissionSet([]), 'settings')).toBe(false);
  });

  it('groups permissions by resource in canonical order', () => {
    const groups = groupPermissionsByResource([
      'roles:write',
      'users:read',
      'users:write',
      'roles:read',
    ]);
    expect(groups.map((group) => group.resource)).toEqual(['users', 'roles']);
    expect(groups[0]?.permissions).toEqual(['users:read', 'users:write']);
    expect(groups[1]?.permissions).toEqual(['roles:read', 'roles:write']);
    expect(groups[0]?.label).toBe('Users');
  });

  it('appends unknown permission codes after the known ones', () => {
    const groups = groupPermissionsByResource(['zeta:read', 'users:read', 'alpha:write']);
    expect(groups.map((group) => group.resource)).toEqual(['users', 'alpha', 'zeta']);
  });

  it('groups API-catalogue permissions and wildcard scopes without throwing', () => {
    const groups = groupPermissionsByResource(['users:suspend', 'users:read', '*', 'audit:*']);
    expect(groups.map((group) => group.resource)).toEqual(['users', '*', 'audit']);
    expect(groups[0]?.permissions).toEqual(['users:read', 'users:suspend']);
    expect(collectActions(groups)).toEqual(['read', 'suspend', '*']);
    expect(hasPermission(toPermissionSet(['users:suspend']), 'users:suspend')).toBe(true);
  });

  it('collects matrix columns in first-seen order', () => {
    const groups = groupPermissionsByResource(PERMISSION_KEYS);
    const actions = collectActions(groups);
    expect(actions.slice(0, 5)).toEqual(['read', 'write', 'delete', 'suspend', 'unlock']);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('computes the union of role permissions for the preview', () => {
    const union = effectivePermissions([
      { permissions: ['users:read', 'audit:read'] },
      { permissions: ['users:read', 'users:write'] },
    ]);
    expect(union).toEqual(['users:read', 'users:write', 'audit:read']);
    expect(effectivePermissions([])).toEqual([]);
  });

  it('humanizes resource names', () => {
    expect(humanizeResource('notification-templates')).toBe('Notification templates');
    expect(humanizeResource('api-keys')).toBe('Api keys');
  });
});
