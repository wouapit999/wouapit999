import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { BusinessError, ForbiddenError } from "@/lib/errors";
import { notifyUsers, tenantUserIds } from "@/lib/notify/notify";
import { byPropertyWhere, can, type AuthContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";
import { ACTIVE_LEASE_STATUSES, activeTenantIdsForUnit, resolveLocation } from "./maintenance";

export const VISITOR_KINDS = ["VISITOR", "CONTRACTOR", "DELIVERY"] as const;
export const INCIDENT_KINDS = ["INCIDENT", "LOST_FOUND"] as const;
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

function requirePerm(ctx: AuthContext, p: Permission) {
  if (!can(ctx, p)) throw new ForbiddenError();
}

/** Visitor records older than the retention window are never displayed (a job purges them). */
export async function visitorRetentionCutoff(organizationId: string) {
  const s = await db.organizationSettings.findUnique({ where: { organizationId }, select: { visitorRetentionDays: true } });
  const days = s?.visitorRetentionDays ?? 180;
  return new Date(Date.now() - days * 86400_000);
}

export async function visitorWhere(ctx: AuthContext): Promise<Prisma.VisitorLogWhereInput> {
  return { ...byPropertyWhere(ctx), createdAt: { gte: await visitorRetentionCutoff(ctx.organizationId) } };
}

async function validateHost(ctx: AuthContext, unitId: string | null, hostTenantId: string | null) {
  if (!hostTenantId) return null;
  if (!unitId) throw new BusinessError("Choose the unit of the resident being visited.");
  const ids = await activeTenantIdsForUnit(ctx.organizationId, unitId);
  if (!ids.includes(hostTenantId)) throw new BusinessError("Resident not found for this unit.");
  return hostTenantId;
}

export interface VisitorInput {
  propertyId: string;
  unitId: string | null;
  hostTenantId: string | null;
  visitorName: string;
  visitorPhone: string;
  kind: (typeof VISITOR_KINDS)[number];
  purpose: string;
  notes?: string;
}

async function notifyArrival(organizationId: string, hostTenantId: string | null, visitorName: string) {
  if (!hostTenantId) return;
  const userIds = await tenantUserIds(hostTenantId);
  await notifyUsers({ organizationId, userIds, event: "VISITOR_ARRIVAL", vars: { visitor: visitorName } });
}

/** Walk-in visitor: checked in now; the host resident is notified. */
export async function checkInVisitor(ctx: AuthContext, input: VisitorInput) {
  requirePerm(ctx, "concierge.visitors.manage");
  await resolveLocation(ctx, input.propertyId, input.unitId);
  const hostTenantId = await validateHost(ctx, input.unitId, input.hostTenantId);
  const v = await db.$transaction(async (tx) => {
    const v = await tx.visitorLog.create({
      data: { ...input, notes: input.notes ?? "", hostTenantId, organizationId: ctx.organizationId, checkInAt: new Date(), loggedById: ctx.user.id },
    });
    await audit(ctx, { action: "visitor.checked_in", module: "concierge", entityType: "VisitorLog", entityId: v.id, propertyId: v.propertyId, after: { kind: v.kind, unitId: v.unitId } }, tx);
    return v;
  });
  await notifyArrival(ctx.organizationId, hostTenantId, v.visitorName);
  return v;
}

/** Expected visitor registered in advance (no check-in yet). */
export async function preauthorizeVisitor(ctx: AuthContext, input: VisitorInput & { expectedAt: Date }) {
  requirePerm(ctx, "concierge.visitors.manage");
  await resolveLocation(ctx, input.propertyId, input.unitId);
  const hostTenantId = await validateHost(ctx, input.unitId, input.hostTenantId);
  return db.$transaction(async (tx) => {
    const v = await tx.visitorLog.create({
      data: { ...input, notes: input.notes ?? "", hostTenantId, organizationId: ctx.organizationId, preauthorized: true, loggedById: ctx.user.id },
    });
    await audit(ctx, { action: "visitor.preauthorized", module: "concierge", entityType: "VisitorLog", entityId: v.id, propertyId: v.propertyId, after: { kind: v.kind, expectedAt: input.expectedAt } }, tx);
    return v;
  });
}

async function loadVisitor(ctx: AuthContext, id: string) {
  const v = await db.visitorLog.findFirst({ where: { ...(await visitorWhere(ctx)), id } });
  if (!v) throw new BusinessError("Visitor record not found.");
  return v;
}

/** A pre-authorised visitor arrives. */
export async function markArrived(ctx: AuthContext, id: string) {
  requirePerm(ctx, "concierge.visitors.manage");
  const v = await loadVisitor(ctx, id);
  if (v.checkInAt) throw new BusinessError("The visitor is already checked in.");
  const upd = await db.visitorLog.updateMany({ where: { id, checkInAt: null }, data: { checkInAt: new Date() } });
  if (upd.count !== 1) throw new BusinessError("The visitor is already checked in.");
  await audit(ctx, { action: "visitor.checked_in", module: "concierge", entityType: "VisitorLog", entityId: id, propertyId: v.propertyId, metadata: { preauthorized: true } });
  await notifyArrival(ctx.organizationId, v.hostTenantId, v.visitorName);
}

export async function checkOutVisitor(ctx: AuthContext, id: string) {
  requirePerm(ctx, "concierge.visitors.manage");
  const v = await loadVisitor(ctx, id);
  if (!v.checkInAt || v.checkOutAt) throw new BusinessError("The visitor is not on site.");
  await db.visitorLog.update({ where: { id }, data: { checkOutAt: new Date() } });
  await audit(ctx, { action: "visitor.checked_out", module: "concierge", entityType: "VisitorLog", entityId: id, propertyId: v.propertyId });
}

/**
 * Privacy-limited resident directory for the front desk: name, building, unit and phone only.
 * Never returns email, identity documents, balances or lease terms.
 */
export async function residentDirectory(ctx: AuthContext, opts: { propertyId?: string; q?: string } = {}) {
  requirePerm(ctx, "concierge.directory.view");
  const leases = await db.lease.findMany({
    where: {
      organizationId: ctx.organizationId,
      status: { in: [...ACTIVE_LEASE_STATUSES] },
      unit: {
        ...(ctx.propertyIds === "ALL" ? {} : { propertyId: { in: ctx.propertyIds } }),
        ...(opts.propertyId ? { propertyId: opts.propertyId } : {}),
      },
      ...(opts.q
        ? { OR: [{ tenant: { legalName: { contains: opts.q, mode: "insensitive" } } }, { tenant: { preferredName: { contains: opts.q, mode: "insensitive" } } }, { unit: { number: { contains: opts.q, mode: "insensitive" } } }] }
        : {}),
    },
    orderBy: [{ unit: { property: { name: "asc" } } }, { unit: { number: "asc" } }],
    take: 300,
    select: {
      id: true,
      tenant: { select: { legalName: true, preferredName: true, phone: true } },
      unit: { select: { number: true, block: true, property: { select: { name: true } } } },
    },
  });
  return leases.map((l) => ({
    id: l.id,
    name: l.tenant.preferredName || l.tenant.legalName,
    building: l.unit.property.name,
    unit: `${l.unit.block ? `${l.unit.block} · ` : ""}${l.unit.number}`,
    phone: l.tenant.phone,
  }));
}

// ───────────── Parcels ─────────────

export async function logParcel(
  ctx: AuthContext,
  input: { propertyId: string; unitId: string | null; recipientName: string; carrier: string; trackingNumber: string; description: string },
) {
  requirePerm(ctx, "concierge.parcels.manage");
  await resolveLocation(ctx, input.propertyId, input.unitId);
  const p = await db.$transaction(async (tx) => {
    const p = await tx.parcel.create({ data: { ...input, organizationId: ctx.organizationId, loggedById: ctx.user.id } });
    await audit(ctx, { action: "parcel.received", module: "concierge", entityType: "Parcel", entityId: p.id, propertyId: p.propertyId, after: { unitId: p.unitId, carrier: p.carrier } }, tx);
    return p;
  });
  if (input.unitId) {
    const tenantIds = await activeTenantIdsForUnit(ctx.organizationId, input.unitId);
    const userIds = (await Promise.all(tenantIds.map((id) => tenantUserIds(id)))).flat();
    await notifyUsers({ organizationId: ctx.organizationId, userIds, event: "PARCEL_RECEIVED", vars: { recipient: input.recipientName }, dedupeKey: `parcel:${p.id}` });
  }
  return p;
}

export async function collectParcel(ctx: AuthContext, input: { id: string; collectedBy: string }) {
  requirePerm(ctx, "concierge.parcels.manage");
  const p = await db.parcel.findFirst({ where: { ...byPropertyWhere(ctx), id: input.id } });
  if (!p) throw new BusinessError("Parcel not found.");
  const upd = await db.parcel.updateMany({ where: { id: p.id, collectedAt: null }, data: { collectedAt: new Date(), collectedBy: input.collectedBy } });
  if (upd.count !== 1) throw new BusinessError("This parcel was already collected.");
  await audit(ctx, { action: "parcel.collected", module: "concierge", entityType: "Parcel", entityId: p.id, propertyId: p.propertyId, after: { collectedBy: input.collectedBy } });
}

// ───────────── Incidents / lost & found ─────────────

export async function createIncident(
  ctx: AuthContext,
  input: { propertyId: string; kind: (typeof INCIDENT_KINDS)[number]; title: string; description: string; severity: (typeof SEVERITIES)[number]; occurredAt: Date },
) {
  requirePerm(ctx, "concierge.incidents.manage");
  await resolveLocation(ctx, input.propertyId);
  return db.$transaction(async (tx) => {
    const i = await tx.incident.create({ data: { ...input, organizationId: ctx.organizationId, reportedById: ctx.user.id } });
    await audit(ctx, { action: "incident.created", module: "concierge", entityType: "Incident", entityId: i.id, propertyId: i.propertyId, after: input }, tx);
    return i;
  });
}

export async function resolveIncident(ctx: AuthContext, input: { id: string; note: string }) {
  requirePerm(ctx, "concierge.incidents.manage");
  const i = await db.incident.findFirst({ where: { ...byPropertyWhere(ctx), id: input.id } });
  if (!i) throw new BusinessError("Incident not found.");
  if (i.status === "RESOLVED") throw new BusinessError("The incident is already resolved.");
  const description = input.note ? `${i.description}\n\n— ${ctx.user.name}: ${input.note}` : i.description;
  await db.$transaction(async (tx) => {
    await tx.incident.update({ where: { id: i.id }, data: { status: "RESOLVED", description } });
    await audit(ctx, { action: "incident.resolved", module: "concierge", entityType: "Incident", entityId: i.id, propertyId: i.propertyId, before: { status: i.status }, after: { status: "RESOLVED", note: input.note } }, tx);
  });
}

// ───────────── Shifts & keys ─────────────

export async function startShift(ctx: AuthContext, input: { propertyId: string; notes: string }) {
  requirePerm(ctx, "concierge.shifts.manage");
  await resolveLocation(ctx, input.propertyId);
  const open = await db.shiftLog.findFirst({ where: { organizationId: ctx.organizationId, userId: ctx.user.id, shiftEnd: null } });
  if (open) throw new BusinessError("You already have a shift in progress. End it first.");
  return db.$transaction(async (tx) => {
    const s = await tx.shiftLog.create({
      data: { organizationId: ctx.organizationId, propertyId: input.propertyId, userId: ctx.user.id, userName: ctx.user.name, shiftStart: new Date(), notes: input.notes },
    });
    await audit(ctx, { action: "shift.started", module: "concierge", entityType: "ShiftLog", entityId: s.id, propertyId: s.propertyId }, tx);
    return s;
  });
}

export async function endShift(ctx: AuthContext, input: { id: string; notes: string; handoverTo: string }) {
  requirePerm(ctx, "concierge.shifts.manage");
  const s = await db.shiftLog.findFirst({ where: { ...byPropertyWhere(ctx), id: input.id, userId: ctx.user.id } });
  if (!s) throw new BusinessError("Shift not found.");
  if (s.shiftEnd) throw new BusinessError("This shift has already ended.");
  const notes = [s.notes, input.notes].filter(Boolean).join("\n");
  await db.$transaction(async (tx) => {
    await tx.shiftLog.update({ where: { id: s.id }, data: { shiftEnd: new Date(), notes, handoverTo: input.handoverTo } });
    await audit(ctx, { action: "shift.ended", module: "concierge", entityType: "ShiftLog", entityId: s.id, propertyId: s.propertyId, after: { handoverTo: input.handoverTo } }, tx);
  });
}

export async function issueKey(ctx: AuthContext, input: { propertyId: string; label: string; holderName: string; notes: string }) {
  requirePerm(ctx, "concierge.shifts.manage");
  await resolveLocation(ctx, input.propertyId);
  return db.$transaction(async (tx) => {
    const k = await tx.keyRecord.create({ data: { ...input, organizationId: ctx.organizationId, loggedById: ctx.user.id } });
    await audit(ctx, { action: "key.issued", module: "concierge", entityType: "KeyRecord", entityId: k.id, propertyId: k.propertyId, after: { label: k.label, holderName: k.holderName } }, tx);
    return k;
  });
}

export async function returnKey(ctx: AuthContext, id: string) {
  requirePerm(ctx, "concierge.shifts.manage");
  const k = await db.keyRecord.findFirst({ where: { ...byPropertyWhere(ctx), id } });
  if (!k) throw new BusinessError("Key record not found.");
  const upd = await db.keyRecord.updateMany({ where: { id, returnedAt: null }, data: { returnedAt: new Date() } });
  if (upd.count !== 1) throw new BusinessError("This key was already returned.");
  await audit(ctx, { action: "key.returned", module: "concierge", entityType: "KeyRecord", entityId: id, propertyId: k.propertyId });
}
