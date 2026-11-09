import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import {
  PERMISSION_CACHE,
  PERMISSION_CACHE_TTL_SECONDS,
  type PermissionCacheStore,
  type ResolvedPermissions,
} from './permission-cache.js';

/** Resolves a user's effective role names and permission keys (user_roles → role_permissions). */
@Injectable()
export class PermissionResolverService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PERMISSION_CACHE) private readonly cache: PermissionCacheStore,
  ) {}

  async resolve(userId: string): Promise<ResolvedPermissions> {
    const cached = await this.cache.get(userId);
    if (cached) return cached;
    const resolved = await this.load(userId);
    await this.cache.set(userId, resolved, PERMISSION_CACHE_TTL_SECONDS);
    return resolved;
  }

  async load(userId: string): Promise<ResolvedPermissions> {
    const assignments = await this.prisma.client.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            name: true,
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });
    const roles = new Set<string>();
    const permissions = new Set<string>();
    for (const assignment of assignments) {
      roles.add(assignment.role.name);
      for (const rolePermission of assignment.role.permissions) {
        permissions.add(rolePermission.permission.key);
      }
    }
    return { roles: [...roles].sort(), permissions: [...permissions].sort() };
  }

  invalidate(userId: string): Promise<void> {
    return this.cache.invalidate(userId);
  }

  invalidateAll(): Promise<void> {
    return this.cache.invalidateAll();
  }
}
