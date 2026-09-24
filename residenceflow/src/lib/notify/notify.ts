import "server-only";
import { db, type Tx } from "@/lib/db";
import { DEFAULT_TEMPLATES, renderTemplate } from "@/domain/template";

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
  const users = await tx.user.findMany({ where: { id: { in: opts.userIds } }, select: { id: true, locale: true } });
  const tpl = DEFAULT_TEMPLATES[opts.event];
  for (const u of users) {
    const lang = u.locale === "en" ? "en" : "fr";
    const dedupeKey = opts.dedupeKey ? `${opts.dedupeKey}:${u.id}` : undefined;
    if (dedupeKey) {
      const exists = await tx.notification.findUnique({ where: { dedupeKey } });
      if (exists) continue;
    }
    await tx.notification.create({
      data: {
        organizationId: opts.organizationId,
        userId: u.id,
        event: opts.event,
        title: renderTemplate(tpl[lang].title, opts.vars),
        body: renderTemplate(tpl[lang].body, opts.vars),
        link: opts.link,
        dedupeKey,
      },
    });
  }
}

/** Portal users bound to a tenant record. */
export async function tenantUserIds(tenantId: string, tx: Tx = db) {
  const users = await tx.user.findMany({ where: { tenantId, status: "ACTIVE" }, select: { id: true } });
  return users.map((u) => u.id);
}
