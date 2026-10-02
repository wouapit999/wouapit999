import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { BusinessError, ForbiddenError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/permissions";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/crypto";
import { requireRecentReauth } from "@/services/reauth";

/**
 * Controlled, audited support access (spec §4.1): a platform administrator may act as an
 * organization administrator only for a short, explicitly justified window. Every start and
 * end is written to both the platform audit trail and the organization's own trail.
 */

/** Cookie that keeps the platform administrator's own session token while a support session is active. */
export const SUPPORT_RETURN_COOKIE = "rf_support_return";
export const SUPPORT_DURATIONS = [15, 30, 60] as const;
export const SUPPORT_BLOCKED_MESSAGE = "Not available during support access.";

const cookieFlags = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  expires,
});

/** Guards the most sensitive operations (exports, payment-provider settings) while acting under support access. */
export function assertNotSupportAccess(ctx: Pick<AuthContext, "supportAccess">) {
  if (ctx.supportAccess) throw new BusinessError(SUPPORT_BLOCKED_MESSAGE);
}

export interface StartSupportAccessInput {
  organizationId: string;
  targetUserId: string;
  reason: string;
  ticketRef: string;
  durationMinutes: (typeof SUPPORT_DURATIONS)[number];
}

/** Lists the ACTIVE organization administrators eligible as support-access targets. */
export async function supportTargets(organizationId: string) {
  return db.user.findMany({
    where: { organizationId, status: "ACTIVE", roles: { some: { role: { key: "org_admin", active: true, archived: false } } } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Starts a support-access session: records the grant, stores the platform admin's own token in a
 * return cookie, and opens a new session bound to the grant as the target administrator.
 */
export async function startSupportAccess(ctx: AuthContext, input: StartSupportAccessInput) {
  if (!hasPermission(ctx.permissions, "platform.organizations.manage")) throw new ForbiddenError();
  if (ctx.supportAccess) throw new BusinessError("sup.alreadyActive");
  await requireRecentReauth(ctx);

  const org = await db.organization.findUnique({ where: { id: input.organizationId }, select: { id: true, status: true, name: true } });
  if (!org) throw new BusinessError("plat.notFound");
  if (org.status !== "ACTIVE") throw new BusinessError("sup.orgInactive");
  const target = await db.user.findFirst({
    where: {
      id: input.targetUserId,
      organizationId: org.id,
      status: "ACTIVE",
      roles: { some: { role: { key: "org_admin", active: true, archived: false } } },
    },
    select: { id: true, name: true, email: true },
  });
  if (!target) throw new BusinessError("sup.targetInvalid");

  const jar = await cookies();
  const ownToken = jar.get(SESSION_COOKIE)?.value;
  if (!ownToken) throw new ForbiddenError("unauthenticated");
  const own = await db.session.findUnique({ where: { tokenHash: hashToken(ownToken) }, select: { id: true, userId: true } });
  if (!own || own.userId !== ctx.user.id) throw new ForbiddenError("unauthenticated");

  const expiresAt = new Date(Date.now() + input.durationMinutes * 60_000);
  const grant = await db.$transaction(async (tx) => {
    const grant = await tx.supportAccess.create({
      data: {
        organizationId: org.id,
        platformUserId: ctx.user.id,
        targetUserId: target.id,
        reason: input.reason,
        ticketRef: input.ticketRef,
        expiresAt,
      },
    });
    const entry = {
      action: "platform.support_access_started",
      module: "platform",
      entityType: "SupportAccess",
      entityId: grant.id,
      metadata: { reason: input.reason, ticketRef: input.ticketRef, targetUserId: target.id, targetEmail: target.email, organizationId: org.id, expiresAt },
    };
    await audit(ctx, entry, tx, null);
    await audit(ctx, entry, tx, org.id);
    return grant;
  });

  // Keep the platform administrator's own session reachable for the return trip.
  jar.set(SUPPORT_RETURN_COOKIE, ownToken, cookieFlags(expiresAt));
  const session = await createSession(target.id, { timeoutMinutes: input.durationMinutes, supportAccessId: grant.id });
  await db.supportAccess.update({ where: { id: grant.id }, data: { sessionId: session.sessionId } });
  return grant;
}

/**
 * Ends a grant (idempotent): stamps endedAt, revokes its session, audits on both trails.
 * `actor` is whoever is ending it — the support user inside the session or a platform admin.
 */
export async function endSupportAccess(
  actor: Pick<AuthContext, "organizationId" | "user"> | null,
  grantId: string,
  how: "user" | "platform" | "expired",
) {
  const grant = await db.supportAccess.findUnique({ where: { id: grantId } });
  if (!grant) throw new BusinessError("sup.notFound");
  if (grant.endedAt) return grant;
  return db.$transaction(async (tx) => {
    const updated = await tx.supportAccess.update({ where: { id: grant.id }, data: { endedAt: new Date() } });
    if (grant.sessionId) await tx.session.updateMany({ where: { id: grant.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    const entry = {
      action: "platform.support_access_ended",
      module: "platform",
      entityType: "SupportAccess",
      entityId: grant.id,
      metadata: { how, platformUserId: grant.platformUserId, targetUserId: grant.targetUserId, organizationId: grant.organizationId, ticketRef: grant.ticketRef },
    };
    await audit(actor, entry, tx, null);
    await audit(actor, entry, tx, grant.organizationId);
    return updated;
  });
}

/**
 * Called from inside a support session: ends the grant, drops the support cookie and restores the
 * platform administrator's own session cookie (if it is still live).
 */
export async function leaveSupportSession(ctx: AuthContext) {
  if (!ctx.supportAccess) throw new BusinessError("sup.notActive");
  const grant = await db.supportAccess.findUnique({ where: { id: ctx.supportAccess.id } });
  if (!grant) throw new BusinessError("sup.notFound");
  const platformUser = await db.user.findUnique({ where: { id: grant.platformUserId }, select: { id: true, name: true } });
  await endSupportAccess(platformUser ? { organizationId: "", user: platformUser } as never : null, grant.id, "user");

  const jar = await cookies();
  const returnToken = jar.get(SUPPORT_RETURN_COOKIE)?.value;
  jar.delete(SUPPORT_RETURN_COOKIE);
  jar.delete(SESSION_COOKIE);
  if (!returnToken) return false;
  const own = await db.session.findUnique({ where: { tokenHash: hashToken(returnToken) }, select: { userId: true, revokedAt: true, expiresAt: true } });
  if (!own || own.userId !== grant.platformUserId || own.revokedAt || own.expiresAt < new Date()) return false;
  jar.set(SESSION_COOKIE, returnToken, cookieFlags(own.expiresAt));
  return true;
}

/** Support-access history for the platform console, with actor/target names resolved. */
export async function listSupportAccess(take = 100) {
  const rows = await db.supportAccess.findMany({ orderBy: { startedAt: "desc" }, take });
  const userIds = [...new Set(rows.flatMap((r) => [r.platformUserId, r.targetUserId]))];
  const orgIds = [...new Set(rows.map((r) => r.organizationId))];
  const [users, orgs] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [],
    orgIds.length ? db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
  ]);
  const u = new Map(users.map((x) => [x.id, x]));
  const o = new Map(orgs.map((x) => [x.id, x]));
  const now = new Date();
  return rows.map((r) => ({
    ...r,
    active: !r.endedAt && r.expiresAt > now,
    platformUser: u.get(r.platformUserId) ?? null,
    targetUser: u.get(r.targetUserId) ?? null,
    organization: o.get(r.organizationId) ?? null,
  }));
}
