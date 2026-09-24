import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { notifyUsers } from "@/lib/notify/notify";
import { assessOverdueAndLateFees, generateDueInvoices, sendDueReminders, todayUtc } from "./billing";

const DAY = 86_400_000;

/**
 * Runs a job at most once per key (e.g. "daily:2026-09-24"). The unique JobRun.jobKey makes
 * concurrent or repeated cron invocations no-ops; every step is itself idempotent, so a failed
 * run can be retried with ?force=1 safely.
 */
export async function runOnce<T>(jobKey: string, force: boolean, fn: () => Promise<T>) {
  if (force) await db.jobRun.deleteMany({ where: { jobKey, status: { not: "RUNNING" } } });
  try {
    await db.jobRun.create({ data: { jobKey } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { skipped: true as const };
    throw e;
  }
  try {
    const result = await fn();
    await db.jobRun.update({ where: { jobKey }, data: { status: "SUCCEEDED", finishedAt: new Date(), result: result as never } });
    return { skipped: false as const, result };
  } catch (e) {
    await db.jobRun.update({ where: { jobKey }, data: { status: "FAILED", finishedAt: new Date(), result: { error: (e as Error).message } } });
    throw e;
  }
}

async function managersOf(organizationId: string, propertyId?: string) {
  const users = await db.user.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      roles: { some: { role: { permissions: { has: "lease.view" }, scope: { in: ["ORGANIZATION", "ASSIGNED_BUILDINGS"] } } } },
      ...(propertyId ? { OR: [{ propertyScopes: { some: { propertyId } } }, { roles: { some: { role: { scope: "ORGANIZATION" } } } }] } : {}),
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function dailyJob(today = todayUtc()) {
  const orgs = await db.organization.findMany({ where: { status: "ACTIVE" }, include: { settings: true } });
  const summary: Record<string, unknown> = {};
  for (const org of orgs) {
    const invoices = await generateDueInvoices(org.id, today);
    const fees = await assessOverdueAndLateFees(org.id, today);
    const reminders = await sendDueReminders(org.id, today);

    // Lease expiry reminders (30 days) and automatic EXPIRED status after the end date.
    const soon = await db.lease.findMany({
      where: { organizationId: org.id, status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, endDate: { gte: today, lte: new Date(today.getTime() + 30 * DAY) } },
      include: { unit: true },
    });
    for (const l of soon) {
      await notifyUsers({
        organizationId: org.id, userIds: await managersOf(org.id, l.unit.propertyId), event: "LEASE_EXPIRY",
        vars: { reference: l.reference, endDate: l.endDate.toISOString().slice(0, 10) }, link: `/leases/${l.id}`, dedupeKey: `lease-expiry:${l.id}`,
      });
    }
    const expired = await db.lease.findMany({ where: { organizationId: org.id, status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, endDate: { lt: today } } });
    for (const l of expired) {
      await db.$transaction([
        db.lease.update({ where: { id: l.id }, data: { status: "EXPIRED" } }),
        db.leaseEvent.create({ data: { leaseId: l.id, type: "EXPIRED", note: "Lease end date passed" } }),
        db.auditLog.create({ data: { organizationId: org.id, action: "lease.expired", module: "leases", entityType: "Lease", entityId: l.id, actorName: "system" } }),
      ]);
    }

    // Document expiry reminders (to uploaders/managers), 30 days ahead.
    const docs = await db.document.findMany({
      where: { organizationId: org.id, expiresAt: { gte: today, lte: new Date(today.getTime() + 30 * DAY) } },
      select: { id: true, name: true, uploadedById: true, expiresAt: true },
    });
    for (const d of docs) {
      if (!d.uploadedById) continue;
      await db.notification.upsert({
        where: { dedupeKey: `doc-expiry:${d.id}` },
        create: { organizationId: org.id, userId: d.uploadedById, event: "DOCUMENT_EXPIRY", title: `Document expiring: ${d.name}`, body: `Expires on ${d.expiresAt!.toISOString().slice(0, 10)}`, link: `/documents/${d.id}`, dedupeKey: `doc-expiry:${d.id}` },
        update: {},
      }).catch(() => undefined);
    }

    // Visitor data retention.
    const retention = org.settings?.visitorRetentionDays ?? 180;
    const purged = await db.visitorLog.deleteMany({ where: { organizationId: org.id, createdAt: { lt: new Date(Date.now() - retention * DAY) } } });

    summary[org.slug] = { invoices, ...fees, reminders, leaseExpiryNotices: soon.length, leasesExpired: expired.length, docsExpiring: docs.length, visitorsPurged: purged.count };
  }

  // Global cleanup: expired tokens and sessions, old login attempts.
  const tokens = await db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * DAY) } } });
  const sessions = await db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: new Date(Date.now() - 30 * DAY) } }] } });
  const attempts = await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 180 * DAY) } } });
  summary.cleanup = { tokens: tokens.count, sessions: sessions.count, loginAttempts: attempts.count };
  return summary;
}
