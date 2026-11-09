import { Injectable } from '@nestjs/common';
import type { AuditLog, Prisma } from '@bi-rem/db';
import type { Paginated } from '@bi-rem/shared';

import { ApiException } from '../../common/errors/api-exception.js';
import { paginate, toPageArgs } from '../../common/pagination/pagination.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditQueryDto } from './dto/audit-query.dto.js';

export interface AuditLogView {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRealm: string | null;
  actorType: AuditLog['actorType'];
  action: string;
  resource: string;
  resourceId: string | null;
  outcome: AuditLog['outcome'];
  before: unknown;
  after: unknown;
  metadata: unknown;
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
  createdAt: Date;
}

type AuditLogWithActor = Prisma.AuditLogGetPayload<{
  include: { actorUser: { select: { email: true; realm: true } } };
}>;

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditQueryDto): Promise<Paginated<AuditLogView>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId ? { actorUserId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.resource ? { resourceType: query.resource } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.correlationId ? { correlationId: query.correlationId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.client.$transaction([
      this.prisma.client.auditLog.findMany({
        where,
        orderBy: { createdAt: query.sortOrder },
        include: { actorUser: { select: { email: true, realm: true } } },
        ...toPageArgs(query),
      }),
      this.prisma.client.auditLog.count({ where }),
    ]);
    return paginate(items.map(toView), total, query);
  }

  async get(id: string): Promise<AuditLogView> {
    const row = await this.prisma.client.auditLog.findUnique({
      where: { id },
      include: { actorUser: { select: { email: true, realm: true } } },
    });
    if (!row) throw ApiException.notFound('Audit log entry not found');
    return toView(row);
  }
}

function toView(row: AuditLogWithActor): AuditLogView {
  return {
    id: row.id,
    actorId: row.actorUserId,
    actorEmail: row.actorUser?.email ?? null,
    actorRealm: row.actorUser?.realm ?? null,
    actorType: row.actorType,
    action: row.action,
    resource: row.resourceType,
    resourceId: row.resourceId,
    outcome: row.outcome,
    before: row.before,
    after: row.after,
    metadata: row.metadata,
    ip: row.ip,
    userAgent: row.userAgent,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  };
}
