"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertPropertyAccess, authorize, type AuthContext } from "@/lib/auth/context";
import { runAction, formToObject, withMessage, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { notifyUsers } from "@/lib/notify/notify";

const MAX_RECIPIENTS = 500;

const schema = z.object({
  title: z.string().trim().min(3).max(150),
  body: z.string().trim().min(3).max(5000),
  audience: z.enum(["ALL", "TENANTS", "STAFF"]),
  propertyId: z.union([z.literal(""), z.string().uuid()]).default(""),
  pinned: z.literal("on").optional(),
  expiresAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(""),
  notify: z.literal("on").optional(),
});

/** Tenant portal users with a current lease (in the building, or anywhere in the organization). */
async function tenantRecipients(organizationId: string, propertyId: string | null) {
  const users = await db.user.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      tenant: {
        organizationId,
        leases: { some: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, ...(propertyId ? { unit: { propertyId } } : {}) } },
      },
    },
    select: { id: true },
    take: MAX_RECIPIENTS,
  });
  return users.map((u) => u.id);
}

/** Staff = organization users without portal access; building-specific notices go to staff covering that building. */
async function staffRecipients(organizationId: string, propertyId: string | null) {
  const where: Prisma.UserWhereInput = {
    organizationId,
    status: "ACTIVE",
    tenantId: null,
    roles: { none: { role: { permissions: { has: "portal.access" } } } },
    ...(propertyId
      ? {
          OR: [
            { propertyScopes: { some: { propertyId } } },
            { roles: { some: { role: { scope: "ORGANIZATION", active: true, archived: false } } } },
          ],
        }
      : {}),
  };
  const users = await db.user.findMany({ where, select: { id: true }, take: MAX_RECIPIENTS });
  return users.map((u) => u.id);
}

async function recipientsFor(ctx: AuthContext, audience: string, propertyId: string | null) {
  let tenants: string[] = [];
  let staff: string[] = [];
  if (audience === "ALL" && !propertyId) {
    const all = await db.user.findMany({ where: { organizationId: ctx.organizationId, status: "ACTIVE" }, select: { id: true, tenantId: true }, take: MAX_RECIPIENTS });
    tenants = all.filter((u) => u.tenantId).map((u) => u.id);
    staff = all.filter((u) => !u.tenantId).map((u) => u.id);
  } else {
    if (audience !== "STAFF") tenants = await tenantRecipients(ctx.organizationId, propertyId);
    if (audience !== "TENANTS") staff = await staffRecipients(ctx.organizationId, propertyId);
  }
  const notMe = (id: string) => id !== ctx.user.id;
  tenants = [...new Set(tenants)].filter(notMe).slice(0, MAX_RECIPIENTS);
  staff = [...new Set(staff)].filter((id) => notMe(id) && !tenants.includes(id)).slice(0, Math.max(0, MAX_RECIPIENTS - tenants.length));
  return { tenants, staff };
}

export async function createAnnouncementAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("announcement.manage");
    const d = schema.parse(formToObject(fd));
    const propertyId = d.propertyId || null;
    if (propertyId) {
      assertPropertyAccess(ctx, propertyId);
      const p = await db.property.findFirst({ where: { id: propertyId, organizationId: ctx.organizationId }, select: { id: true } });
      if (!p) throw new BusinessError("Building not found.");
    } else if (ctx.propertyIds !== "ALL") {
      // Building-scoped managers can only publish to their own buildings.
      throw new BusinessError("ann.err.buildingRequired");
    }
    const expiresAt = d.expiresAt ? new Date(`${d.expiresAt}T23:59:59Z`) : null;
    if (expiresAt && expiresAt < new Date()) throw new BusinessError("ann.err.expiryPast");
    const a = await db.$transaction(async (tx) => {
      const created = await tx.announcement.create({
        data: {
          organizationId: ctx.organizationId,
          propertyId,
          audience: d.audience,
          title: d.title,
          body: d.body,
          pinned: d.pinned === "on",
          expiresAt,
          createdById: ctx.user.id,
        },
      });
      await audit(ctx, { action: "announcement.published", module: "announcements", entityType: "Announcement", entityId: created.id, propertyId, after: { title: d.title, audience: d.audience, propertyId, pinned: created.pinned } }, tx);
      return created;
    });
    let notified = 0;
    if (d.notify === "on") {
      // Capped at MAX_RECIPIENTS in total; tenants land on the portal, staff on the staff list.
      const { tenants, staff } = await recipientsFor(ctx, d.audience, propertyId);
      const base = { organizationId: ctx.organizationId, event: "ANNOUNCEMENT" as const, vars: { title: d.title }, dedupeKey: `announcement:${a.id}` };
      await notifyUsers({ ...base, userIds: tenants, link: "/portal/home" });
      await notifyUsers({ ...base, userIds: staff, link: "/announcements" });
      notified = tenants.length + staff.length;
    }
    return { notified };
  });
  revalidatePath("/announcements");
  return withMessage(r, "ann.published");
}

const idSchema = z.object({ id: z.string().uuid() });

async function loadScoped(ctx: AuthContext, id: string) {
  const a = await db.announcement.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!a) throw new BusinessError("Announcement not found.");
  if (a.propertyId) assertPropertyAccess(ctx, a.propertyId);
  else if (ctx.propertyIds !== "ALL") throw new BusinessError("ann.err.buildingRequired");
  return a;
}

export async function togglePinAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("announcement.manage");
    const { id } = idSchema.parse(formToObject(fd));
    const a = await loadScoped(ctx, id);
    await db.announcement.update({ where: { id }, data: { pinned: !a.pinned } });
    await audit(ctx, { action: a.pinned ? "announcement.unpinned" : "announcement.pinned", module: "announcements", entityType: "Announcement", entityId: id, propertyId: a.propertyId, before: { pinned: a.pinned }, after: { pinned: !a.pinned } });
  });
  revalidatePath("/announcements");
  return r;
}

export async function expireAnnouncementAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("announcement.manage");
    const { id } = idSchema.parse(formToObject(fd));
    const a = await loadScoped(ctx, id);
    const now = new Date();
    await db.announcement.update({ where: { id }, data: { expiresAt: now, pinned: false } });
    await audit(ctx, { action: "announcement.expired", module: "announcements", entityType: "Announcement", entityId: id, propertyId: a.propertyId, before: { expiresAt: a.expiresAt }, after: { expiresAt: now } });
  });
  revalidatePath("/announcements");
  return withMessage(r, "ann.expiredMsg");
}
