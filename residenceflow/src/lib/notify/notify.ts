import "server-only";
import { db, type Tx } from "@/lib/db";
import { DEFAULT_TEMPLATES, renderTemplate } from "@/domain/template";
import { emailConfigured, sendEmail } from "./email";

/** Channels the organization can deliver on. SMS/WhatsApp adapters plug in here. */
export function availableChannels() {
  return { IN_APP: true, EMAIL: emailConfigured(), SMS: Boolean(process.env.SMS_PROVIDER && process.env.SMS_API_KEY), WHATSAPP: false };
}

/**
 * Creates in-app notifications for users (and is the single hook point for email/SMS/WhatsApp
 * adapters). `dedupeKey` makes job-driven notifications idempotent.
 */
export async function notifyUsers(
  opts: {
    organizationId: string;
    userIds: string[];
    event: keyof typeof DEFAULT_TEMPLATES;
    vars: Record<string, string | number>;
    link?: string;
    dedupeKey?: string;
  },
  tx: Tx = db,
) {
  if (opts.userIds.length === 0) return;
  const users = await tx.user.findMany({
    where: { id: { in: opts.userIds } },
    select: { id: true, locale: true, email: true, tenant: { select: { commPreferences: true } } },
  });
  const tpl = DEFAULT_TEMPLATES[opts.event];
  const channels = availableChannels();
  for (const u of users) {
    const lang = u.locale === "en" ? "en" : "fr";
    const dedupeKey = opts.dedupeKey ? `${opts.dedupeKey}:${u.id}` : undefined;
    if (dedupeKey) {
      const exists = await tx.notification.findUnique({ where: { dedupeKey } });
      if (exists) continue;
    }
    const title = renderTemplate(tpl[lang].title, opts.vars);
    const body = renderTemplate(tpl[lang].body, opts.vars);
    await tx.notification.create({
      data: { organizationId: opts.organizationId, userId: u.id, event: opts.event, title, body, link: opts.link, dedupeKey },
    });
    // Email copy when the channel is configured and the recipient has not opted out.
    // Queued rows are delivered by deliverPendingNotifications (called after the transaction / by the daily job).
    const wantsEmail = !u.tenant || u.tenant.commPreferences.includes("EMAIL");
    if (channels.EMAIL && wantsEmail && u.email) {
      await tx.notification.create({
        data: {
          organizationId: opts.organizationId, userId: u.id, event: opts.event, title, body, link: opts.link,
          channel: "EMAIL", deliveryStatus: "QUEUED", dedupeKey: dedupeKey ? `${dedupeKey}:email` : undefined,
        },
      });
    }
  }
}

/**
 * Sends queued email notifications (at most 5 attempts each). Safe to call repeatedly:
 * only QUEUED/FAILED rows below the attempt limit are touched.
 */
export async function deliverPendingNotifications(limit = 200) {
  const pending = await db.notification.findMany({
    where: { channel: "EMAIL", deliveryStatus: { in: ["QUEUED", "FAILED"] }, attempts: { lt: 5 } },
    include: { user: { select: { email: true } }, organization: { select: { settings: { select: { emailSenderName: true, replyToEmail: true, appName: true } } } } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let sent = 0, failed = 0;
  for (const n of pending) {
    const s = n.organization.settings;
    try {
      const r = await sendEmail({
        to: n.user.email, subject: n.title, text: n.link ? `${n.body}\n\n${n.link}` : n.body,
        fromName: s?.emailSenderName || s?.appName, replyTo: s?.replyToEmail || undefined,
      });
      await db.notification.update({ where: { id: n.id }, data: { deliveryStatus: r.sent ? "SENT" : "FAILED", attempts: { increment: 1 } } });
      if (r.sent) sent++;
      else failed++;
    } catch {
      await db.notification.update({ where: { id: n.id }, data: { deliveryStatus: "FAILED", attempts: { increment: 1 } } });
      failed++;
    }
  }
  return { sent, failed, pending: pending.length };
}

/** Portal users bound to a tenant record. */
export async function tenantUserIds(tenantId: string, tx: Tx = db) {
  const users = await tx.user.findMany({ where: { tenantId, status: "ACTIVE" }, select: { id: true } });
  return users.map((u) => u.id);
}
