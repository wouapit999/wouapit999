import { Injectable, Logger } from '@nestjs/common';
import { type AuditActorType, type AuditLog, type AuditOutcome, type Prisma } from '@bi-rem/db';

import { RequestContext } from '../../common/context/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { redact } from './redact.js';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: AuditOutcome;
  actorUserId?: string | null;
  actorType?: AuditActorType;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends an audit row. Fills actor, ip, user agent and correlation id from the request
   * context when not supplied. Redacts `before`/`after`. Never throws: audit failures are
   * logged, because a failing audit write must not turn a successful business operation into
   * an error after the fact (the row is still attempted in a transaction when `tx` is given).
   */
  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<AuditLog | null> {
    const context = RequestContext.current();
    const actor = context?.actor;
    const data: Prisma.AuditLogUncheckedCreateInput = {
      action: entry.action.slice(0, 128),
      resourceType: entry.resourceType.slice(0, 64),
      resourceId: entry.resourceId?.slice(0, 128) ?? null,
      outcome: entry.outcome,
      actorUserId: entry.actorUserId !== undefined ? entry.actorUserId : (actor?.userId ?? null),
      actorType: entry.actorType ?? (actor?.type === 'API_KEY' ? 'API_KEY' : 'USER'),
      before: toJson(redact(entry.before)),
      after: toJson(redact(entry.after)),
      metadata: toJson({
        ...(entry.metadata ?? {}),
        ...(actor?.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}),
        ...(actor?.realm ? { actorRealm: actor.realm } : {}),
      }),
      ip: (entry.ip ?? context?.ip ?? null)?.slice(0, 45) ?? null,
      userAgent: (entry.userAgent ?? context?.userAgent ?? null)?.slice(0, 512) ?? null,
      correlationId: (entry.correlationId ?? context?.correlationId ?? null)?.slice(0, 128) ?? null,
    };
    try {
      const client = tx ?? this.prisma.client;
      return await client.auditLog.create({ data });
    } catch (error) {
      this.logger.error({ err: error, action: entry.action }, 'Failed to write audit log');
      return null;
    }
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return undefined;
  return value;
}
