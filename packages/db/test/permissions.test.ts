import { describe, expect, it } from 'vitest';

import {
  hasPermission,
  isPermissionKey,
  isSystemRoleName,
  PERMISSION_KEYS,
  PERMISSION_RESOURCES,
  PERMISSIONS,
  permissionsForResource,
  readOnlyPermissions,
  SYSTEM_ROLE_LIST,
  SYSTEM_ROLE_NAMES,
  SYSTEM_ROLES,
} from '../src/permissions.js';

const PERMISSION_KEY_PATTERN = /^[a-z][a-z-]*:[a-z][a-z-]*$/;

describe('PERMISSIONS catalogue', () => {
  it('uses the resource:action convention with a known resource', () => {
    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
      const resource = key.slice(0, key.indexOf(':'));
      expect(PERMISSION_RESOURCES).toContain(resource);
    }
  });

  it('has a non-empty description for every permission', () => {
    for (const key of PERMISSION_KEYS) {
      expect(PERMISSIONS[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('contains no duplicate keys', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('covers every declared resource with at least one permission', () => {
    for (const resource of PERMISSION_RESOURCES) {
      expect(permissionsForResource(resource).length).toBeGreaterThan(0);
    }
  });

  it('exposes the baseline permissions the API guards depend on', () => {
    for (const required of [
      'users:read',
      'users:write',
      'roles:read',
      'roles:write',
      'permissions:read',
      'audit:read',
      'notifications:read',
      'settings:read',
      'feature-flags:read',
      'api-keys:read',
      'customers:read',
      'kyc:read',
    ]) {
      expect(isPermissionKey(required)).toBe(true);
    }
  });

  it('readOnlyPermissions returns only :read keys', () => {
    const readOnly = readOnlyPermissions();
    expect(readOnly.length).toBeGreaterThan(0);
    expect(readOnly.every((key) => key.endsWith(':read'))).toBe(true);
  });
});

describe('SYSTEM_ROLES', () => {
  it('defines exactly the expected role names', () => {
    expect([...SYSTEM_ROLE_NAMES].sort()).toEqual(
      [
        'SUPER_ADMIN',
        'ADMIN',
        'COMPLIANCE_OFFICER',
        'SUPPORT_AGENT',
        'TREASURY_MANAGER',
        'VIEWER',
        'CUSTOMER',
      ].sort(),
    );
    expect(Object.keys(SYSTEM_ROLES).sort()).toEqual([...SYSTEM_ROLE_NAMES].sort());
    expect(SYSTEM_ROLE_LIST.map((role) => role.name)).toEqual([...SYSTEM_ROLE_NAMES]);
  });

  it('references only known permissions and has no duplicates', () => {
    for (const role of SYSTEM_ROLE_LIST) {
      expect(role.name).toBe(SYSTEM_ROLES[role.name].name);
      expect(role.permissions.length).toBeGreaterThan(0);
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
      for (const permission of role.permissions) {
        expect(isPermissionKey(permission)).toBe(true);
      }
    }
  });

  it('grants SUPER_ADMIN every permission', () => {
    expect([...SYSTEM_ROLES.SUPER_ADMIN.permissions].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('keeps privileged actions away from VIEWER and SUPPORT_AGENT', () => {
    for (const role of [SYSTEM_ROLES.VIEWER, SYSTEM_ROLES.SUPPORT_AGENT]) {
      expect(role.permissions).not.toContain('settings:read-secrets');
      expect(role.permissions).not.toContain('system:maintenance');
      expect(role.permissions).not.toContain('roles:write');
      expect(role.permissions).not.toContain('api-keys:write');
      expect(role.permissions).not.toContain('transactions:reverse');
    }
    expect(SYSTEM_ROLES.VIEWER.permissions.every((key) => key.endsWith(':read'))).toBe(true);
  });

  it('scopes CUSTOMER to the customer realm and self-service permissions only', () => {
    const customer = SYSTEM_ROLES.CUSTOMER;
    expect(customer.realm).toBe('CUSTOMER');
    for (const permission of customer.permissions) {
      expect(permission.startsWith('users:')).toBe(false);
      expect(permission.startsWith('roles:')).toBe(false);
      expect(permission.startsWith('settings:')).toBe(false);
      expect(permission.startsWith('audit:')).toBe(false);
    }
    expect(customer.permissions).toContain('kyc:submit');
    expect(customer.permissions).not.toContain('kyc:approve');
    for (const role of SYSTEM_ROLE_LIST.filter((r) => r.name !== 'CUSTOMER')) {
      expect(role.realm).toBe('ADMIN');
    }
  });

  it('isSystemRoleName recognises only system roles', () => {
    expect(isSystemRoleName('ADMIN')).toBe(true);
    expect(isSystemRoleName('admin')).toBe(false);
    expect(isSystemRoleName(null)).toBe(false);
  });
});

describe('hasPermission', () => {
  it('matches exact keys', () => {
    expect(hasPermission(['users:read'], 'users:read')).toBe(true);
    expect(hasPermission(['users:read'], 'users:write')).toBe(false);
  });

  it('supports resource and global wildcards', () => {
    expect(hasPermission(['users:*'], 'users:delete')).toBe(true);
    expect(hasPermission(['users:*'], 'roles:read')).toBe(false);
    expect(hasPermission(['*'], 'system:maintenance')).toBe(true);
    expect(hasPermission(new Set<string>(), 'users:read')).toBe(false);
  });
});
