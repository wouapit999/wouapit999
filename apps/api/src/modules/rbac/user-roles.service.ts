import { Injectable } from '@nestjs/common';
import { SYSTEM_ROLES, isSystemRoleName } from '@bi-rem/db';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import { RequestContext } from '../../common/context/request-context.js';
import { ApiException } from '../../common/errors/api-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PermissionResolverService } from './permission-resolver.service.js';
import { SUPER_ADMIN_ROLE } from './permissions.guard.js';

export interface UserRolesView {
  userId: string;
  roles: Array<{ id: string; name: string; isSystem: boolean }>;
}

@Injectable()
export class UserRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionResolverService,
  ) {}

  async get(userId: string): Promise<UserRolesView> {
    await this.requireUser(userId);
    return this.view(userId);
  }

  /** Replaces the user's role set with exactly `roleIds`. */
  async replace(
    userId: string,
    roleIds: string[],
    actor: AuthenticatedPrincipal,
  ): Promise<UserRolesView> {
    const assignedById = actor.userId;
    const user = await this.requireUser(userId);
    const roles = await this.prisma.client.role.findMany({ where: { id: { in: roleIds } } });
    if (roles.length !== new Set(roleIds).size)
      throw ApiException.notFound('One or more roles do not exist');
    for (const role of roles) this.assertRealmCompatible(role.name, user.realm);

    const before = await this.view(userId);
    const hadSuperAdmin = before.roles.some((role) => role.name === SUPER_ADMIN_ROLE);
    const keepsSuperAdmin = roles.some((role) => role.name === SUPER_ADMIN_ROLE);
    if (hadSuperAdmin && !keepsSuperAdmin) await this.assertNotLastSuperAdmin(userId);
    if (hadSuperAdmin !== keepsSuperAdmin) await this.assertMayGrant([SUPER_ADMIN_ROLE], actor);
    else
      await this.assertMayGrant(
        roles
          .filter((role) => !before.roles.some((held) => held.id === role.id))
          .map((role) => role.name),
        actor,
      );
    RequestContext.recordBefore(before);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId, roleId: { notIn: roleIds } } });
      for (const role of roles) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId, roleId: role.id } },
          update: {},
          create: { userId, roleId: role.id, assignedById },
        });
      }
    });
    await this.resolver.invalidate(userId);
    const after = await this.view(userId);
    RequestContext.recordAfter(after);
    return after;
  }

  async assign(
    userId: string,
    roleId: string,
    actor: AuthenticatedPrincipal,
  ): Promise<UserRolesView> {
    const assignedById = actor.userId;
    const user = await this.requireUser(userId);
    const role = await this.prisma.client.role.findUnique({ where: { id: roleId } });
    if (!role) throw ApiException.notFound('Role not found');
    this.assertRealmCompatible(role.name, user.realm);
    await this.assertMayGrant([role.name], actor);
    RequestContext.recordBefore(await this.view(userId));
    await this.prisma.client.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId, assignedById },
    });
    await this.resolver.invalidate(userId);
    const after = await this.view(userId);
    RequestContext.recordAfter(after);
    return after;
  }

  async unassign(
    userId: string,
    roleId: string,
    actor: AuthenticatedPrincipal,
  ): Promise<UserRolesView> {
    await this.requireUser(userId);
    const role = await this.prisma.client.role.findUnique({ where: { id: roleId } });
    if (!role) throw ApiException.notFound('Role not found');
    if (role.name === SUPER_ADMIN_ROLE) {
      await this.assertNotLastSuperAdmin(userId);
      await this.assertMayGrant([SUPER_ADMIN_ROLE], actor);
    }
    RequestContext.recordBefore(await this.view(userId));
    await this.prisma.client.userRole.deleteMany({ where: { userId, roleId } });
    await this.resolver.invalidate(userId);
    const after = await this.view(userId);
    RequestContext.recordAfter(after);
    return after;
  }

  /**
   * Granting (or removing) SUPER_ADMIN is reserved to SUPER_ADMIN users: otherwise any holder of
   * `roles:assign` or `users:write` could escalate to unrestricted access. Service accounts
   * (API keys) can never touch SUPER_ADMIN membership.
   */
  async assertMayGrant(roleNames: readonly string[], actor: AuthenticatedPrincipal): Promise<void> {
    if (!roleNames.includes(SUPER_ADMIN_ROLE)) return;
    if (actor.type !== 'USER' || !actor.userId) {
      throw ApiException.forbidden('Only a SUPER_ADMIN user can change SUPER_ADMIN membership');
    }
    const { roles } = await this.resolver.resolve(actor.userId);
    if (!roles.includes(SUPER_ADMIN_ROLE)) {
      throw ApiException.forbidden('Only a SUPER_ADMIN user can change SUPER_ADMIN membership');
    }
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw ApiException.notFound('User not found');
    return user;
  }

  private assertRealmCompatible(roleName: string, realm: 'ADMIN' | 'CUSTOMER'): void {
    const roleRealm = isSystemRoleName(roleName) ? SYSTEM_ROLES[roleName].realm : 'ADMIN';
    if (roleRealm !== realm) {
      throw ApiException.conflict(`Role ${roleName} cannot be assigned to a ${realm} user`);
    }
  }

  /** The platform must always keep at least one active SUPER_ADMIN. */
  private async assertNotLastSuperAdmin(userId: string): Promise<void> {
    const others = await this.prisma.client.userRole.count({
      where: {
        role: { name: SUPER_ADMIN_ROLE },
        userId: { not: userId },
        user: { deletedAt: null, status: 'ACTIVE' },
      },
    });
    if (others === 0) throw ApiException.conflict('Cannot remove the last active SUPER_ADMIN');
  }

  private async view(userId: string): Promise<UserRolesView> {
    const assignments = await this.prisma.client.userRole.findMany({
      where: { userId },
      select: { role: { select: { id: true, name: true, isSystem: true } } },
      orderBy: { role: { name: 'asc' } },
    });
    return { userId, roles: assignments.map((assignment) => assignment.role) };
  }
}
