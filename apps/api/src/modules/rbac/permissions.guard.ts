import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { hasPermission, type PermissionKey } from '@bi-rem/db';

import type { AuthenticatedPrincipal, AuthenticatedRequest } from '../../common/auth/principal.js';
import {
  ANY_PERMISSION_KEY,
  PERMISSIONS_KEY,
} from '../../common/decorators/permissions.decorator.js';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { ApiException } from '../../common/errors/api-exception.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { PermissionResolverService } from './permission-resolver.service.js';

export const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

/**
 * Enforces `@Permissions()` (AND) and `@AnyPermission()` (OR). Runs after the auth guard.
 * Users get their permission set resolved from the database (cached); API keys are checked
 * against their scopes, which may contain `resource:*` or `*` wildcards. SUPER_ADMIN bypasses.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionResolverService,
    private readonly auditLog: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required =
      this.reflector.getAllAndOverride<PermissionKey[] | undefined>(PERMISSIONS_KEY, targets) ?? [];
    const anyOf =
      this.reflector.getAllAndOverride<PermissionKey[] | undefined>(ANY_PERMISSION_KEY, targets) ??
      [];
    if (required.length === 0 && anyOf.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const principal = request.user;
    if (!principal) {
      const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
        IS_PUBLIC_KEY,
        targets,
      );
      if (isPublic) return true;
      throw ApiException.unauthenticated();
    }

    const granted = await this.grantedPermissions(principal, request);
    if (granted === 'ALL') return true;

    const allRequired = required.every((permission) => hasPermission(granted, permission));
    const anySatisfied =
      anyOf.length === 0 || anyOf.some((permission) => hasPermission(granted, permission));
    if (allRequired && anySatisfied) return true;

    if (request.method !== 'GET') {
      await this.auditLog.record({
        action: 'authorization.denied',
        resourceType: context.getClass().name.replace(/Controller$/, '') || 'Route',
        outcome: 'DENIED',
        metadata: {
          method: request.method,
          path: request.originalUrl,
          required,
          anyOf,
        },
      });
    }
    throw ApiException.forbidden();
  }

  private async grantedPermissions(
    principal: AuthenticatedPrincipal,
    request: AuthenticatedRequest,
  ): Promise<ReadonlySet<string> | 'ALL'> {
    if (principal.type === 'API_KEY') {
      return new Set(principal.permissions);
    }
    if (request.permissionSet) return request.permissionSet;
    if (!principal.userId) return new Set<string>();
    const resolved = await this.resolver.resolve(principal.userId);
    if (resolved.roles.includes(SUPER_ADMIN_ROLE)) return 'ALL';
    const set: ReadonlySet<string> = new Set(resolved.permissions);
    request.permissionSet = set;
    return set;
  }
}
