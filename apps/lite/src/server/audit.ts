import { type DbOrTx, type Prisma, db } from './db';
import { type ActionContext, assertPermission } from './rbac';

/**
 * Append-only audit trail. Rows can only be inserted — the database rejects UPDATE and DELETE on
 * `audit_logs` with a trigger. Every mutating service function writes one row, inside the same
 * transaction as the change whenever there is one.
 */

export interface AuditEntry {
  /** `resource.verb`, e.g. `transfer.create`, `provider.credentials.rotate`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly outcome?: 'SUCCESS' | 'FAILURE' | 'DENIED';
  readonly before?: unknown;
  readonly after?: unknown;
  readonly metadata?: Record<string, unknown>;
  /** Backdating for the demo seed only. */
  readonly at?: Date;
}

const SENSITIVE_KEY =
  /pass(word)?|secret|token|credential|authorization|api[-_]?key|ciphertext|mfa|otp|hash/i;

/**
 * Makes a value safe to store as JSON: bigint → string, Date → ISO, binary dropped, and any
 * property whose name looks sensitive is replaced by "[redacted]".
 */
export function toAuditJson(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return '[binary]';
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => toAuditJson(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (typeof (value as { toFixed?: unknown }).toFixed === 'function') {
      return (value as { toFixed(): string }).toFixed();
    }
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : toAuditJson(entry, depth + 1);
    }
    return out;
  }
  return null;
}

const jsonOrUndefined = (value: unknown): Prisma.InputJsonValue | undefined =>
  toAuditJson(value) ?? undefined;

/** Inserts one audit row. Pass the transaction client to make it atomic with the change. */
export async function writeAudit(
  client: DbOrTx,
  ctx: ActionContext,
  entry: AuditEntry,
): Promise<void> {
  const { actor } = ctx;
  await client.auditLog.create({
    data: {
      actorType: actor.type,
      actorId: actor.type === 'SYSTEM' ? null : actor.id,
      actorLabel: actor.label,
      actorRole: actor.type === 'USER' ? actor.role : actor.type,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      outcome: entry.outcome ?? 'SUCCESS',
      before: jsonOrUndefined(entry.before),
      after: jsonOrUndefined(entry.after),
      metadata: jsonOrUndefined(entry.metadata),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent?.slice(0, 500) ?? null,
      requestId: ctx.requestId ?? null,
      ...(entry.at ? { createdAt: entry.at } : {}),
    },
  });
}

/**
 * Runs `fn` and records the outcome: SUCCESS with the returned `after` snapshot, or FAILURE /
 * DENIED (FORBIDDEN errors) with the error message, then rethrows. Use it for actions that do
 * not already write their own audit row inside a transaction.
 */
export async function withAudit<T>(
  ctx: ActionContext,
  entry: Omit<AuditEntry, 'outcome' | 'after'>,
  fn: () => Promise<T>,
  describe?: (result: T) => { resourceId?: string | null; after?: unknown },
): Promise<T> {
  try {
    const result = await fn();
    const described = describe?.(result);
    await writeAudit(db, ctx, {
      ...entry,
      resourceId: described?.resourceId ?? entry.resourceId,
      after: described?.after,
      outcome: 'SUCCESS',
    });
    return result;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    await writeAudit(db, ctx, {
      ...entry,
      outcome: code === 'FORBIDDEN' || code === 'UNAUTHENTICATED' ? 'DENIED' : 'FAILURE',
      metadata: {
        ...entry.metadata,
        error: error instanceof Error ? error.message.slice(0, 500) : 'unknown error',
      },
    }).catch(() => undefined);
    throw error;
  }
}

export interface AuditQuery {
  readonly actorId?: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly outcome?: 'SUCCESS' | 'FAILURE' | 'DENIED';
  readonly from?: Date;
  readonly to?: Date;
  readonly page?: number;
  readonly pageSize?: number;
}

/** Paged audit log for the back office. Requires `audit:read` (checked by the caller's ctx). */
export async function listAuditLogs(ctx: ActionContext, query: AuditQuery = {}) {
  assertPermission(ctx, 'audit:read');
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
    ...(query.resourceType ? { resourceType: query.resourceType } : {}),
    ...(query.resourceId ? { resourceId: query.resourceId } : {}),
    ...(query.outcome ? { outcome: query.outcome } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.auditLog.count({ where }),
  ]);
  return { items, total, page, pageSize };
}
