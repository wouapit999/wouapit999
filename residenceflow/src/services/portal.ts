import "server-only";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { BusinessError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { storeDocument } from "@/lib/storage";
import { tenantUserIds } from "@/lib/notify/notify";
import type { AuthContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";

// Tenant self-service operations. Every function receives the tenantId resolved by
// requireTenantPortal() and re-checks it against the organization on every query.

export const MAINTENANCE_CATEGORIES = ["PLUMBING", "ELECTRICAL", "HVAC", "APPLIANCE", "STRUCTURAL", "PEST", "CLEANING", "SECURITY", "OTHER"] as const;
export const MAINTENANCE_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const COMM_CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "IN_APP"] as const;
export const OPEN_WO = ["SUBMITTED", "TRIAGED", "ASSIGNED", "SCHEDULED", "IN_PROGRESS", "WAITING_PARTS", "WAITING_TENANT", "REOPENED"] as const;
export const COMPLETION_WO = ["COMPLETED", "TENANT_CONFIRMATION"] as const;
export const RATEABLE_WO = ["COMPLETED", "TENANT_CONFIRMATION", "CLOSED"] as const;

/** Household members (occupant role) get a limited portal: no lease or financial pages. */
export function isOccupant(ctx: Pick<AuthContext, "roleKeys">) {
  return ctx.roleKeys.includes("occupant") && !ctx.roleKeys.includes("tenant");
}

/** The tenant's current lease (ACTIVE or NOTICE_GIVEN), most recent first. */
export async function currentLease(organizationId: string, tenantId: string, tx: Tx = db) {
  return tx.lease.findFirst({
    where: { organizationId, tenantId, status: { in: ["ACTIVE", "NOTICE_GIVEN"] } },
    orderBy: { startDate: "desc" },
    include: { unit: { include: { property: { select: { id: true, name: true, address: true, city: true } } } }, deposit: { include: { transactions: true } } },
  });
}

/** Property IDs of the tenant's current leases (for building announcements). */
export async function tenantPropertyIds(organizationId: string, tenantId: string) {
  const leases = await db.lease.findMany({
    where: { organizationId, tenantId, status: { in: ["ACTIVE", "NOTICE_GIVEN"] } },
    select: { unit: { select: { propertyId: true } } },
  });
  return [...new Set(leases.map((l) => l.unit.propertyId))];
}

/** Announcements visible to a tenant: ALL/TENANTS audience, org-wide or their building, not expired. */
export function tenantAnnouncementWhere(organizationId: string, propertyIds: string[]): Prisma.AnnouncementWhereInput {
  const now = new Date();
  return {
    organizationId,
    audience: { in: ["ALL", "TENANTS"] },
    publishedAt: { lte: now },
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { OR: [{ propertyId: null }, { propertyId: { in: propertyIds } }] },
    ],
  };
}

/**
 * Active staff users holding a permission whose scope covers the building (or all buildings).
 * Used to alert the right people about tenant submissions.
 */
export async function staffUserIds(organizationId: string, permission: Permission, propertyId?: string | null, take = 50, tx: Tx = db) {
  const users = await tx.user.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      tenantId: null,
      roles: { some: { role: { permissions: { has: permission }, active: true, archived: false } } },
      ...(propertyId
        ? {
            OR: [
              { roles: { some: { role: { scope: { in: ["ORGANIZATION", "PLATFORM"] }, active: true, archived: false } } } },
              { propertyScopes: { some: { propertyId } } },
            ],
          }
        : {}),
    },
    select: { id: true },
    take,
  });
  return users.map((u) => u.id);
}

type Localized = { en: { title: string; body: string }; fr: { title: string; body: string } };

/**
 * In-app notification for events that have no template in DEFAULT_TEMPLATES (messages, tenant
 * submissions). Localized per recipient; same shape as notifyUsers() output.
 */
export async function notifyDirect(organizationId: string, userIds: string[], msg: Localized, link: string, tx: Tx = db, event = "MESSAGE") {
  if (userIds.length === 0) return;
  const users = await tx.user.findMany({ where: { id: { in: userIds }, organizationId }, select: { id: true, locale: true } });
  await tx.notification.createMany({
    data: users.map((u) => {
      const m = u.locale === "en" ? msg.en : msg.fr;
      return { organizationId, userId: u.id, event, title: m.title.slice(0, 200), body: m.body.slice(0, 500), link };
    }),
  });
}

// ───────────────────────── Messages ─────────────────────────

export async function sendTenantMessage(ctx: AuthContext, tenantId: string, input: { subject: string; body: string }) {
  const tenant = await db.tenant.findFirst({ where: { id: tenantId, organizationId: ctx.organizationId }, select: { id: true, legalName: true } });
  if (!tenant) throw new BusinessError("Tenant not found.");
  const lease = await currentLease(ctx.organizationId, tenantId);
  return db.$transaction(async (tx) => {
    const m = await tx.message.create({
      data: {
        organizationId: ctx.organizationId,
        tenantId,
        fromTenant: true,
        authorId: ctx.user.id,
        authorName: ctx.user.name,
        subject: input.subject,
        body: input.body,
      },
    });
    await audit(ctx, { action: "message.sent", module: "portal", entityType: "Message", entityId: m.id, propertyId: lease?.unit.propertyId, metadata: { subject: input.subject } }, tx);
    const staff = await staffUserIds(ctx.organizationId, "message.send", lease?.unit.propertyId, 50, tx);
    const subj = input.subject || "—";
    await notifyDirect(ctx.organizationId, staff, {
      en: { title: `New message from ${tenant.legalName}`, body: subj },
      fr: { title: `Nouveau message de ${tenant.legalName}`, body: subj },
    }, `/messages/${tenantId}`, tx);
    return m;
  });
}

export async function markStaffMessagesRead(organizationId: string, tenantId: string) {
  await db.message.updateMany({ where: { organizationId, tenantId, fromTenant: false, readAt: null }, data: { readAt: new Date() } });
}

// ───────────────────────── Profile ─────────────────────────

export async function updateTenantContactPrefs(
  ctx: AuthContext,
  tenantId: string,
  input: { phone: string; altPhone: string; commPreferences: string[]; language: "en" | "fr" },
) {
  const before = await db.tenant.findFirst({
    where: { id: tenantId, organizationId: ctx.organizationId },
    select: { phone: true, altPhone: true, commPreferences: true, language: true },
  });
  if (!before) throw new BusinessError("Tenant not found.");
  await db.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: tenantId }, data: input });
    await tx.user.update({ where: { id: ctx.user.id }, data: { locale: input.language } });
    await audit(ctx, { action: "tenant.profile_updated", module: "portal", entityType: "Tenant", entityId: tenantId, before, after: input }, tx);
  });
}

// ───────────────────────── Maintenance ─────────────────────────

export interface PortalMaintenanceInput {
  category: (typeof MAINTENANCE_CATEGORIES)[number];
  title: string;
  description: string;
  location: string;
  priority: (typeof MAINTENANCE_PRIORITIES)[number];
  safetyIssue: boolean;
  accessPreference: string;
  availableTimes: string;
  photo?: File | null;
}

/** Creates a work order for the tenant's current unit (ACTIVE / NOTICE_GIVEN lease). */
export async function createPortalMaintenanceRequest(ctx: AuthContext, tenantId: string, input: PortalMaintenanceInput) {
  const lease = await currentLease(ctx.organizationId, tenantId);
  if (!lease) throw new BusinessError("You need an active lease to submit a maintenance request.");
  // Safety issues are never triaged below HIGH.
  const priority = input.safetyIssue && (input.priority === "LOW" || input.priority === "NORMAL") ? "HIGH" : input.priority;
  const created = await db.$transaction(async (tx) => {
    const number = await nextNumber(ctx.organizationId, "WORK_ORDER", tx);
    const req = await tx.maintenanceRequest.create({
      data: {
        organizationId: ctx.organizationId,
        number,
        propertyId: lease.unit.propertyId,
        unitId: lease.unitId,
        tenantId,
        reporterId: ctx.user.id,
        category: input.category,
        priority,
        safetyIssue: input.safetyIssue,
        title: input.title,
        description: input.description,
        location: input.location,
        accessPreference: input.accessPreference,
        availableTimes: input.availableTimes,
        status: "SUBMITTED",
      },
    });
    await tx.workOrderUpdate.create({
      data: { requestId: req.id, actorId: ctx.user.id, actorName: ctx.user.name, toStatus: "SUBMITTED", note: "Submitted from the tenant portal", internal: false },
    });
    await audit(ctx, {
      action: "maintenance.created", module: "maintenance", entityType: "MaintenanceRequest", entityId: req.id, propertyId: req.propertyId,
      after: { number, category: input.category, priority, safetyIssue: input.safetyIssue, source: "portal" },
    }, tx);
    if (input.photo && input.photo.size > 0) {
      await storeDocument(ctx, {
        file: input.photo,
        category: "MAINTENANCE",
        tenantId,
        propertyId: lease.unit.propertyId,
        workOrderId: req.id,
        visibleToTenant: true,
      }, tx);
    }
    const staff = await staffUserIds(ctx.organizationId, "maintenance.assign", lease.unit.propertyId, 50, tx);
    const label = `${number} · ${input.title}`;
    await notifyDirect(ctx.organizationId, staff, {
      en: { title: `New maintenance request ${number}`, body: `${label} (${priority}${input.safetyIssue ? ", safety" : ""})` },
      fr: { title: `Nouvelle demande de maintenance ${number}`, body: `${label} (${priority}${input.safetyIssue ? ", sécurité" : ""})` },
    }, `/maintenance/${req.id}`, tx, "MAINTENANCE_UPDATE");
    return req;
  }, { timeout: 20_000 });
  return created;
}

async function loadOwnRequest(ctx: AuthContext, tenantId: string, requestId: string, tx: Tx = db) {
  const req = await tx.maintenanceRequest.findFirst({ where: { id: requestId, tenantId, organizationId: ctx.organizationId } });
  if (!req) throw new BusinessError("Request not found.");
  return req;
}

async function notifyAssignees(tx: Tx, organizationId: string, req: { id: string; number: string; assignedToId: string | null; propertyId: string }, status: string) {
  const ids = new Set(await staffUserIds(organizationId, "maintenance.assign", req.propertyId, 50, tx));
  if (req.assignedToId) ids.add(req.assignedToId);
  await notifyDirect(organizationId, [...ids], {
    en: { title: `Maintenance update ${req.number}`, body: `Tenant set status to ${status}.` },
    fr: { title: `Mise à jour maintenance ${req.number}`, body: `Le locataire a changé le statut : ${status}.` },
  }, `/maintenance/${req.id}`, tx, "MAINTENANCE_UPDATE");
}

/** Tenant rates completed work (1–5). */
export async function rateRequest(ctx: AuthContext, tenantId: string, requestId: string, rating: number, comment = "") {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new BusinessError("Rating must be between 1 and 5.");
  await db.$transaction(async (tx) => {
    const req = await loadOwnRequest(ctx, tenantId, requestId, tx);
    if (!(RATEABLE_WO as readonly string[]).includes(req.status)) throw new BusinessError("Only completed requests can be rated.");
    await tx.maintenanceRequest.update({ where: { id: req.id }, data: { rating } });
    await tx.workOrderUpdate.create({
      data: { requestId: req.id, actorId: ctx.user.id, actorName: ctx.user.name, note: `Tenant rating: ${rating}/5${comment ? ` — ${comment}` : ""}`, internal: false },
    });
    await audit(ctx, { action: "maintenance.rated", module: "maintenance", entityType: "MaintenanceRequest", entityId: req.id, propertyId: req.propertyId, before: { rating: req.rating }, after: { rating } }, tx);
  });
}

/** Tenant confirms the work is done → CLOSED (optionally with a rating). */
export async function confirmCompletion(ctx: AuthContext, tenantId: string, requestId: string, rating: number | null, comment = "") {
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new BusinessError("Rating must be between 1 and 5.");
  await db.$transaction(async (tx) => {
    const req = await loadOwnRequest(ctx, tenantId, requestId, tx);
    if (!(COMPLETION_WO as readonly string[]).includes(req.status)) throw new BusinessError("This request is not awaiting your confirmation.");
    await tx.maintenanceRequest.update({ where: { id: req.id }, data: { status: "CLOSED", closedAt: new Date(), ...(rating !== null ? { rating } : {}) } });
    const note = ["Tenant confirmed completion", rating !== null ? `rating ${rating}/5` : "", comment].filter(Boolean).join(" — ");
    await tx.workOrderUpdate.create({
      data: { requestId: req.id, actorId: ctx.user.id, actorName: ctx.user.name, fromStatus: req.status, toStatus: "CLOSED", note, internal: false },
    });
    await audit(ctx, { action: "maintenance.tenant_confirmed", module: "maintenance", entityType: "MaintenanceRequest", entityId: req.id, propertyId: req.propertyId, before: { status: req.status }, after: { status: "CLOSED", rating } }, tx);
    await notifyAssignees(tx, ctx.organizationId, req, "CLOSED");
  });
}

/** Tenant reports the problem is not fixed → REOPENED. */
export async function reopenRequest(ctx: AuthContext, tenantId: string, requestId: string, reason: string) {
  if (reason.trim().length < 3) throw new BusinessError("Please explain what is still wrong.");
  await db.$transaction(async (tx) => {
    const req = await loadOwnRequest(ctx, tenantId, requestId, tx);
    if (!(RATEABLE_WO as readonly string[]).includes(req.status)) throw new BusinessError("Only completed requests can be reopened.");
    await tx.maintenanceRequest.update({ where: { id: req.id }, data: { status: "REOPENED", closedAt: null } });
    await tx.workOrderUpdate.create({
      data: { requestId: req.id, actorId: ctx.user.id, actorName: ctx.user.name, fromStatus: req.status, toStatus: "REOPENED", note: `Reopened by tenant: ${reason}`, internal: false },
    });
    await audit(ctx, { action: "maintenance.reopened", module: "maintenance", entityType: "MaintenanceRequest", entityId: req.id, propertyId: req.propertyId, before: { status: req.status }, after: { status: "REOPENED" }, metadata: { reason } }, tx);
    await notifyAssignees(tx, ctx.organizationId, req, "REOPENED");
  });
}

// ───────────────────────── Tenant users (for staff notifications) ─────────────────────────

export async function notifyTenantUsers(organizationId: string, tenantId: string, msg: Localized, link: string, tx: Tx = db, event = "MESSAGE") {
  await notifyDirect(organizationId, await tenantUserIds(tenantId, tx), msg, link, tx, event);
}

// ───────────────────────── Small shared helpers ─────────────────────────

/** "yyyy-mm-dd" → UTC midnight (for @db.Date columns); null when invalid. */
export function parseDayString(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export function todayUtcDay() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

export function dayIso(d: Date) {
  return d.toISOString().slice(0, 10);
}
