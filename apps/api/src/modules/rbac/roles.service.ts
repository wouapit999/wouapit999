import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  type PermissionKey,
  type Prisma,
  SYSTEM_ROLES,
  isPermissionKey,
  isSystemRoleName,
} from '@bi-rem/db';

import { RequestContext } from '../../common/context/request-context.js';
import { ApiException } from '../../common/errors/api-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateRoleDto, UpdateRoleDto } from './dto/role.dto.js';
import { PermissionResolverService } from './permission-resolver.service.js';
import { SUPER_ADMIN_ROLE } from './permissions.guard.js';

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  realm: 'ADMIN' | 'CUSTOMER' | null;
  permissions: string[];
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PermissionView {
  id: string | null;
  key: string;
  description: string | null;
}

type RoleRow = Prisma.RoleGetPayload<{
  include: {
    permissions: { select: { permission: { select: { key: true } } } };
    _count: { select: { users: true } };
  };
}>;

const ROLE_INCLUDE = {
  permissions: { select: { permission: { select: { key: true } } } },
  _count: { select: { users: true } },
} as const;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionResolverService,
  ) {}

  async list(): Promise<RoleView[]> {
    const roles = await this.prisma.client.role.findMany({
      include: ROLE_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return roles.map(toRoleView);
  }

  async get(id: string): Promise<RoleView> {
    const role = await this.prisma.client.role.findUnique({ where: { id }, include: ROLE_INCLUDE });
    if (!role) throw ApiException.notFound('Role not found');
    return toRoleView(role);
  }

  async create(dto: CreateRoleDto): Promise<RoleView> {
    if (isSystemRoleName(dto.name)) {
      throw ApiException.conflict(`${dto.name} is a reserved system role name`);
    }
    const existing = await this.prisma.client.role.findUnique({ where: { name: dto.name } });
    if (existing) throw ApiException.conflict(`Role ${dto.name} already exists`);

    const role = await this.prisma.client.$transaction(async (tx) => {
      const permissionIds = await this.ensurePermissions(tx, dto.permissions);
      return tx.role.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
        },
        include: ROLE_INCLUDE,
      });
    });
    RequestContext.setResourceId(role.id);
    return toRoleView(role);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<RoleView> {
    const current = await this.prisma.client.role.findUnique({
      where: { id },
      include: ROLE_INCLUDE,
    });
    if (!current) throw ApiException.notFound('Role not found');
    if (current.isSystem && dto.name && dto.name !== current.name) {
      throw ApiException.conflict('System roles cannot be renamed');
    }
    if (current.isSystem && current.name === SUPER_ADMIN_ROLE && dto.permissions) {
      throw ApiException.conflict('SUPER_ADMIN permissions cannot be changed');
    }
    if (dto.name && dto.name !== current.name) {
      if (isSystemRoleName(dto.name))
        throw ApiException.conflict(`${dto.name} is a reserved system role name`);
      const clash = await this.prisma.client.role.findUnique({ where: { name: dto.name } });
      if (clash) throw ApiException.conflict(`Role ${dto.name} already exists`);
    }
    RequestContext.recordBefore(toRoleView(current));

    const role = await this.prisma.client.$transaction(async (tx) => {
      if (dto.permissions) {
        const permissionIds = await this.ensurePermissions(tx, dto.permissions);
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (permissionIds.length) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
          });
        }
      }
      return tx.role.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        },
        include: ROLE_INCLUDE,
      });
    });
    await this.resolver.invalidateAll();
    const view = toRoleView(role);
    RequestContext.recordAfter(view);
    return view;
  }

  async remove(id: string): Promise<void> {
    const role = await this.prisma.client.role.findUnique({ where: { id }, include: ROLE_INCLUDE });
    if (!role) throw ApiException.notFound('Role not found');
    if (role.isSystem) throw ApiException.conflict('System roles cannot be deleted');
    RequestContext.recordBefore(toRoleView(role));
    await this.prisma.client.role.delete({ where: { id } });
    await this.resolver.invalidateAll();
  }

  /** Catalogue view: every known permission key, with the database id when the row exists. */
  async listPermissions(): Promise<PermissionView[]> {
    const rows = await this.prisma.client.permission.findMany({ orderBy: { key: 'asc' } });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const keys = new Set<string>([...Object.keys(PERMISSIONS), ...byKey.keys()]);
    return [...keys].sort().map((key) => {
      const row = byKey.get(key);
      return {
        id: row?.id ?? null,
        key,
        description: row?.description ?? (isPermissionKey(key) ? PERMISSIONS[key] : null),
      };
    });
  }

  /** Returns permission row ids for the keys, creating catalogue entries that were not seeded yet. */
  private async ensurePermissions(
    tx: Prisma.TransactionClient,
    keys: PermissionKey[],
  ): Promise<string[]> {
    if (keys.length === 0) return [];
    const existing = await tx.permission.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(existing.map((row) => [row.key, row.id]));
    for (const key of keys) {
      if (!byKey.has(key)) {
        const created = await tx.permission.create({
          data: { key, description: PERMISSIONS[key] },
        });
        byKey.set(key, created.id);
      }
    }
    return keys.map((key) => byKey.get(key)!);
  }
}

export function toRoleView(role: RoleRow): RoleView {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    realm: isSystemRoleName(role.name)
      ? SYSTEM_ROLES[role.name].realm
      : role.isSystem
        ? null
        : 'ADMIN',
    permissions: role.permissions.map((entry) => entry.permission.key).sort(),
    userCount: role._count.users,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
