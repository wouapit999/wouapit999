import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuditLogService } from '../audit/audit-log.service.js';
import type { ResolvedPermissions } from './permission-cache.js';
import type { PermissionResolverService } from './permission-resolver.service.js';
import { PermissionsGuard } from './permissions.guard.js';

class UsersController {
  @Permissions('users:read')
  list(): void {}

  @Permissions('users:write', 'roles:assign')
  createWithRoles(): void {}

  @AnyPermission('audit:read', 'audit:export')
  exportAudit(): void {}

  open(): void {}

  @Public()
  @Permissions('users:read')
  publicButPrivileged(): void {}
}

function user(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    type: 'USER',
    id: 'u1',
    userId: 'u1',
    apiKeyId: null,
    realm: 'ADMIN',
    email: 'a@b.c',
    roles: [],
    permissions: [],
    sessionId: 's1',
    ...overrides,
  };
}

function apiKey(scopes: string[]): AuthenticatedPrincipal {
  return user({
    type: 'API_KEY',
    id: 'k1',
    userId: null,
    apiKeyId: 'k1',
    permissions: scopes,
    sessionId: null,
  });
}

function context(
  handler: (...args: never[]) => unknown,
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => UsersController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let resolve: jest.Mock<(userId: string) => Promise<ResolvedPermissions>>;
  let record: jest.Mock;
  let guard: PermissionsGuard;
  let resolved: ResolvedPermissions;

  beforeEach(() => {
    resolved = { roles: ['ADMIN'], permissions: ['users:read', 'audit:export'] };
    resolve = jest.fn(async () => resolved);
    record = jest.fn(async () => null);
    guard = new PermissionsGuard(
      new Reflector(),
      { resolve } as unknown as PermissionResolverService,
      { record } as unknown as AuditLogService,
    );
  });

  it('allows routes without permission metadata', async () => {
    await expect(guard.canActivate(context(UsersController.prototype.open, {}))).resolves.toBe(
      true,
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('allows a user holding the required permission and memoises the resolved set per request', async () => {
    const request: Record<string, unknown> = { method: 'GET', user: user() };
    await expect(guard.canActivate(context(UsersController.prototype.list, request))).resolves.toBe(
      true,
    );
    await expect(guard.canActivate(context(UsersController.prototype.list, request))).resolves.toBe(
      true,
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(request.permissionSet).toBeInstanceOf(Set);
  });

  it('requires every permission for @Permissions (AND) and audits denials of mutating requests', async () => {
    const request = { method: 'POST', originalUrl: '/v1/users', user: user() };
    await expect(
      guard.canActivate(context(UsersController.prototype.createWithRoles, request)),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authorization.denied', outcome: 'DENIED' }),
    );
  });

  it('accepts any permission for @AnyPermission (OR)', async () => {
    await expect(
      guard.canActivate(
        context(UsersController.prototype.exportAudit, { method: 'GET', user: user() }),
      ),
    ).resolves.toBe(true);
    resolved = { roles: [], permissions: ['users:read'] };
    await expect(
      guard.canActivate(
        context(UsersController.prototype.exportAudit, { method: 'GET', user: user() }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(record).not.toHaveBeenCalled();
  });

  it('lets SUPER_ADMIN through regardless of explicit permissions', async () => {
    resolved = { roles: ['SUPER_ADMIN'], permissions: [] };
    await expect(
      guard.canActivate(
        context(UsersController.prototype.createWithRoles, { method: 'POST', user: user() }),
      ),
    ).resolves.toBe(true);
  });

  it('checks API-key scopes with wildcard support and never hits the resolver', async () => {
    await expect(
      guard.canActivate(
        context(UsersController.prototype.list, { method: 'GET', user: apiKey(['users:*']) }),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        context(UsersController.prototype.createWithRoles, { method: 'POST', user: apiKey(['*']) }),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        context(UsersController.prototype.list, { method: 'GET', user: apiKey(['audit:read']) }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects anonymous callers on protected routes but not on @Public() ones', async () => {
    await expect(
      guard.canActivate(context(UsersController.prototype.list, { method: 'GET' })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      guard.canActivate(context(UsersController.prototype.publicButPrivileged, { method: 'GET' })),
    ).resolves.toBe(true);
  });
});
