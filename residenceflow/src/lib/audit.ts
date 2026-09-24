import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { requestMeta } from "@/lib/auth/session";
import type { AuthContext } from "@/lib/auth/context";

const SENSITIVE_KEYS = /password|token|secret|hash|mfa|recovery|idNumber|content/i;

/** Removes secrets and masks sensitive fields before anything reaches the audit log. */
export function sanitizeForAudit(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (depth > 4) return "[depth]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object" && value !== null && "toFixed" in value && "d" in value) {
    return String(value); // Prisma.Decimal
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeForAudit(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : sanitizeForAudit(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.startsWith("data:")) return "[file]";
  return value as Prisma.InputJsonValue;
}

export interface AuditInput {
  action: string;
  module: string;
  entityType?: string;
  entityId?: string;
  propertyId?: string | null;
  result?: "SUCCESS" | "FAILURE" | "DENIED";
  metadata?: unknown;
  before?: unknown;
  after?: unknown;
}

/** Append-only audit trail. Pass `tx` to write inside the business transaction. */
export async function audit(
  ctx: Pick<AuthContext, "organizationId" | "user"> | null,
  input: AuditInput,
  tx: Tx = db,
  orgOverride?: string | null,
) {
  const meta = await requestMeta().catch(() => ({ ip: undefined, correlationId: undefined }));
  await tx.auditLog.create({
    data: {
      organizationId: orgOverride !== undefined ? orgOverride || null : ctx?.organizationId || null,
      actorId: ctx?.user.id ?? null,
      actorName: ctx?.user.name ?? null,
      action: input.action,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      propertyId: input.propertyId ?? undefined,
      result: input.result ?? "SUCCESS",
      correlationId: meta.correlationId,
      ip: meta.ip,
      metadata: sanitizeForAudit(input.metadata) ?? undefined,
      before: sanitizeForAudit(input.before) ?? undefined,
      after: sanitizeForAudit(input.after) ?? undefined,
    },
  });
}
