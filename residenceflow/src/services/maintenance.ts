import "server-only";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { BusinessError, ForbiddenError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { money, toDb } from "@/lib/money";
import { notifyUsers, tenantUserIds } from "@/lib/notify/notify";
import { storeDocument } from "@/lib/storage";
import { can, maintenanceWhere, propertyWhere, unitWhere, type AuthContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";
import { canTransitionWorkOrder } from "@/domain/work-order";

export const WO_CATEGORIES = ["PLUMBING", "ELECTRICAL", "HVAC", "APPLIANCE", "STRUCTURAL", "PEST", "CLEANING", "SECURITY", "OTHER"] as const;
export const WO_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
/** Role keys that may be assigned a work order as the responsible staff member. */
export const ASSIGNABLE_ROLE_KEYS = ["technician", "maintenance_manager"];
export const ACTIVE_LEASE_STATUSES = ["ACTIVE", "NOTICE_GIVEN"] as const;

type WorkOrderStatus = Prisma.MaintenanceRequestGetPayload<object>["status"];

function requirePerm(ctx: AuthContext, p: Permission | Permission[]) {
  if (!can(ctx, p)) throw new ForbiddenError();
}

/** Vendor company users (never see internal notes). */
export function isVendorUser(ctx: AuthContext) {
  return !!ctx.vendorId && ctx.roleKeys.includes("vendor") && ctx.scope === "OWN";
}

// ───────────── Location helpers (shared with concierge / expenses / inspections) ─────────────

/** Loads buildings + units in the user's scope for the LocationPicker. */
export async function locationOptions(ctx: AuthContext, opts: { withTenants?: boolean } = {}) {
  const [buildings, units] = await Promise.all([
    db.property.findMany({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.unit.findMany({
      where: { ...unitWhere(ctx), archived: false },
      orderBy: [{ block: "asc" }, { number: "asc" }],
      select: {
        id: true,
        propertyId: true,
        number: true,
        block: true,
        leases: {
          where: { status: { in: [...ACTIVE_LEASE_STATUSES] } },
          take: opts.withTenants ? 10 : 0,
          select: { tenant: { select: { id: true, legalName: true, preferredName: true } } },
        },
      },
    }),
  ]);
  return {
    buildings,
    units: units.map((u) => ({
      id: u.id,
      propertyId: u.propertyId,
      label: `${u.block ? `${u.block} · ` : ""}${u.number}`,
      ...(opts.withTenants ? { tenants: u.leases.map((l) => ({ id: l.tenant.id, name: l.tenant.preferredName || l.tenant.legalName })) } : {}),
    })),
  };
}

/** Re-loads a client-supplied building/unit pair inside the user's scope; out of scope → not found. */
export async function resolveLocation(ctx: AuthContext, propertyId: string, unitId?: string | null, tx: Tx = db) {
  const property = await tx.property.findFirst({ where: { ...propertyWhere(ctx), id: propertyId }, select: { id: true, name: true } });
  if (!property) throw new BusinessError("Building not found.");
  let unit: { id: string; number: string } | null = null;
  if (unitId) {
    unit = await tx.unit.findFirst({ where: { id: unitId, propertyId, organizationId: ctx.organizationId }, select: { id: true, number: true } });
    if (!unit) throw new BusinessError("Unit not found.");
  }
  return { property, unit };
}

/** Tenant IDs holding an active lease on a unit. */
export async function activeTenantIdsForUnit(organizationId: string, unitId: string, tx: Tx = db) {
  const leases = await tx.lease.findMany({
    where: { organizationId, unitId, status: { in: [...ACTIVE_LEASE_STATUSES] } },
    select: { tenantId: true },
  });
  return [...new Set(leases.map((l) => l.tenantId))];
}

// ───────────── Work orders ─────────────

async function loadScoped(tx: Tx, ctx: AuthContext, id: string) {
  const wo = await tx.maintenanceRequest.findFirst({ where: { ...maintenanceWhere(ctx), id } });
  if (!wo) throw new BusinessError("Work order not found.");
  return wo;
}

async function addUpdate(
  tx: Tx,
  ctx: AuthContext | null,
  requestId: string,
  data: { fromStatus?: WorkOrderStatus | null; toStatus?: WorkOrderStatus | null; note?: string; internal?: boolean },
  actorOverride?: { id: string | null; name: string | null },
) {
  await tx.workOrderUpdate.create({
    data: {
      requestId,
      actorId: actorOverride?.id ?? ctx?.user.id ?? null,
      actorName: actorOverride?.name ?? ctx?.user.name ?? null,
      fromStatus: data.fromStatus ?? null,
      toStatus: data.toStatus ?? null,
      note: data.note ?? "",
      internal: data.internal ?? false,
    },
  });
}

async function notifyTenant(tx: Tx, wo: { id: string; organizationId: string; tenantId: string | null; number: string }, status: string) {
  if (!wo.tenantId) return;
  const userIds = await tenantUserIds(wo.tenantId, tx);
  await notifyUsers(
    { organizationId: wo.organizationId, userIds, event: "MAINTENANCE_UPDATE", vars: { number: wo.number, status }, link: `/portal/maintenance/${wo.id}` },
    tx,
  );
}

export interface CreateRequestInput {
  propertyId: string;
  unitId?: string | null;
  tenantId?: string | null;
  category: string;
  priority: string;
  safetyIssue: boolean;
  title: string;
  description: string;
  location?: string;
  accessPreference?: string;
  availableTimes?: string;
}

async function insertRequest(tx: Tx, ctx: AuthContext, input: CreateRequestInput, reporterId: string) {
  const number = await nextNumber(ctx.organizationId, "WORK_ORDER", tx);
  const wo = await tx.maintenanceRequest.create({
    data: {
      organizationId: ctx.organizationId,
      number,
      propertyId: input.propertyId,
      unitId: input.unitId || null,
      tenantId: input.tenantId || null,
      reporterId,
      category: input.category,
      // Safety issues are never lower than HIGH priority.
      priority: input.safetyIssue && (input.priority === "LOW" || input.priority === "NORMAL") ? "HIGH" : input.priority,
      safetyIssue: input.safetyIssue,
      title: input.title,
      description: input.description,
      location: input.location ?? "",
      accessPreference: input.accessPreference ?? "",
      availableTimes: input.availableTimes ?? "",
      status: "SUBMITTED",
    },
  });
  await addUpdate(tx, ctx, wo.id, { toStatus: "SUBMITTED" });
  await audit(ctx, { action: "maintenance.created", module: "maintenance", entityType: "MaintenanceRequest", entityId: wo.id, propertyId: wo.propertyId, after: { ...input, number } }, tx);
  return wo;
}

/** Staff-created request (maintenance.create). Unit/building are re-validated inside the scope. */
export async function createRequest(ctx: AuthContext, input: CreateRequestInput & { onBehalfOfTenant?: boolean }) {
  requirePerm(ctx, "maintenance.create");
  return db.$transaction(async (tx) => {
    await resolveLocation(ctx, input.propertyId, input.unitId, tx);
    let tenantId: string | null = null;
    if (input.unitId && input.onBehalfOfTenant) {
      tenantId = (await activeTenantIdsForUnit(ctx.organizationId, input.unitId, tx))[0] ?? null;
    }
    return insertRequest(tx, ctx, { ...input, tenantId }, ctx.user.id);
  });
}

/** Portal: request raised by a tenant; the unit/building come from the tenant's active lease. */
export async function createRequestForTenant(
  ctx: AuthContext,
  tenantId: string,
  input: Omit<CreateRequestInput, "propertyId" | "unitId" | "tenantId"> & { leaseId?: string | null },
) {
  if (ctx.tenantId !== tenantId) throw new ForbiddenError();
  return db.$transaction(async (tx) => {
    const lease = await tx.lease.findFirst({
      where: { organizationId: ctx.organizationId, tenantId, status: { in: [...ACTIVE_LEASE_STATUSES] }, ...(input.leaseId ? { id: input.leaseId } : {}) },
      orderBy: { startDate: "desc" },
      select: { unitId: true, unit: { select: { propertyId: true } } },
    });
    if (!lease) throw new BusinessError("No active lease found for your account.");
    return insertRequest(
      tx,
      ctx,
      { ...input, propertyId: lease.unit.propertyId, unitId: lease.unitId, tenantId },
      ctx.user.id,
    );
  });
}

/** Portal: photo attached by the tenant to one of their own requests. */
export async function attachTenantPhoto(ctx: AuthContext, tenantId: string, requestId: string, file: File) {
  if (ctx.tenantId !== tenantId) throw new ForbiddenError();
  const wo = await db.maintenanceRequest.findFirst({ where: { id: requestId, organizationId: ctx.organizationId, tenantId } });
  if (!wo) throw new BusinessError("Work order not found.");
  return storeDocument(ctx, { file, category: "MAINTENANCE", workOrderId: wo.id, propertyId: wo.propertyId, tenantId, visibleToTenant: true });
}

export interface ChangeStatusInput {
  id: string;
  to: WorkOrderStatus;
  note?: string;
  internal?: boolean;
  scheduledAt?: Date | null;
  completionSummary?: string;
}

export async function changeStatus(ctx: AuthContext, input: ChangeStatusInput) {
  requirePerm(ctx, "maintenance.update");
  if (input.to === "CLOSED") requirePerm(ctx, "maintenance.close");
  if (input.to === "CANCELLED") requirePerm(ctx, "maintenance.assign");
  if (input.to === "ASSIGNED") throw new BusinessError("Use the assignment form to assign a work order.");
  return db.$transaction(async (tx) => {
    const wo = await loadScoped(tx, ctx, input.id);
    if (!canTransitionWorkOrder(wo.status, input.to)) throw new BusinessError(`Cannot move a work order from ${wo.status} to ${input.to}.`);
    if (input.to === "SCHEDULED" && !input.scheduledAt && !wo.scheduledAt) throw new BusinessError("Enter the scheduled date and time.");
    if (input.to === "COMPLETED" && !(input.completionSummary || wo.completionSummary)) throw new BusinessError("Enter a completion summary.");
    const data: Prisma.MaintenanceRequestUpdateInput = { status: input.to };
    if (input.to === "CLOSED") data.closedAt = new Date();
    if (input.to === "REOPENED") data.closedAt = null;
    if (input.scheduledAt) data.scheduledAt = input.scheduledAt;
    if (input.completionSummary) data.completionSummary = input.completionSummary;
    const updated = await tx.maintenanceRequest.update({ where: { id: wo.id }, data });
    await addUpdate(tx, ctx, wo.id, { fromStatus: wo.status, toStatus: input.to, note: input.note, internal: input.internal });
    await audit(
      ctx,
      {
        action: input.to === "CLOSED" ? "maintenance.closed" : "maintenance.status_changed",
        module: "maintenance",
        entityType: "MaintenanceRequest",
        entityId: wo.id,
        propertyId: wo.propertyId,
        before: { status: wo.status },
        after: { status: input.to, note: input.note, internal: input.internal, scheduledAt: input.scheduledAt, completionSummary: input.completionSummary },
      },
      tx,
    );
    if (!input.internal) await notifyTenant(tx, wo, input.to);
    return updated;
  });
}

export async function assign(ctx: AuthContext, input: { id: string; assigneeId?: string | null; vendorId?: string | null; scheduledAt?: Date | null; note?: string }) {
  requirePerm(ctx, "maintenance.assign");
  if (!input.assigneeId && !input.vendorId) throw new BusinessError("Choose a technician or a vendor.");
  return db.$transaction(async (tx) => {
    const wo = await loadScoped(tx, ctx, input.id);
    if (["CLOSED", "CANCELLED"].includes(wo.status)) throw new BusinessError("Reopen the work order before assigning it.");
    let assigneeName = "";
    if (input.assigneeId) {
      const user = await tx.user.findFirst({
        where: { id: input.assigneeId, organizationId: ctx.organizationId, status: "ACTIVE", roles: { some: { role: { key: { in: ASSIGNABLE_ROLE_KEYS }, active: true } } } },
        select: { id: true, name: true },
      });
      if (!user) throw new BusinessError("Technician not found.");
      assigneeName = user.name;
    }
    let vendorName = "";
    if (input.vendorId) {
      const vendor = await tx.vendor.findFirst({ where: { id: input.vendorId, organizationId: ctx.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
      if (!vendor) throw new BusinessError("Vendor not found.");
      vendorName = vendor.name;
    }
    const moveToAssigned = wo.status !== "ASSIGNED" && canTransitionWorkOrder(wo.status, "ASSIGNED");
    const updated = await tx.maintenanceRequest.update({
      where: { id: wo.id },
      data: {
        assignedToId: input.assigneeId || null,
        vendorId: input.vendorId || null,
        ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
        ...(moveToAssigned ? { status: "ASSIGNED" } : {}),
      },
    });
    if (moveToAssigned) {
      await addUpdate(tx, ctx, wo.id, { fromStatus: wo.status, toStatus: "ASSIGNED" });
      await notifyTenant(tx, wo, "ASSIGNED");
    }
    const summary = [assigneeName && `Technician: ${assigneeName}`, vendorName && `Vendor: ${vendorName}`, input.note].filter(Boolean).join(" · ");
    await addUpdate(tx, ctx, wo.id, { note: `Assigned — ${summary}`, internal: true });
    await audit(
      ctx,
      {
        action: "maintenance.assigned",
        module: "maintenance",
        entityType: "MaintenanceRequest",
        entityId: wo.id,
        propertyId: wo.propertyId,
        before: { assignedToId: wo.assignedToId, vendorId: wo.vendorId, status: wo.status },
        after: { assignedToId: input.assigneeId || null, vendorId: input.vendorId || null, status: updated.status },
      },
      tx,
    );
    // Let the assignee know (in-app).
    const notifyIds = [input.assigneeId, ...(input.vendorId ? (await tx.user.findMany({ where: { vendorId: input.vendorId, status: "ACTIVE" }, select: { id: true } })).map((u) => u.id) : [])].filter(
      (x): x is string => !!x && x !== ctx.user.id,
    );
    await notifyUsers({ organizationId: ctx.organizationId, userIds: notifyIds, event: "MAINTENANCE_UPDATE", vars: { number: wo.number, status: "ASSIGNED" }, link: `/maintenance/${wo.id}` }, tx);
    return updated;
  });
}

export async function addNote(ctx: AuthContext, input: { id: string; note: string; internal: boolean }) {
  requirePerm(ctx, "maintenance.update");
  return db.$transaction(async (tx) => {
    const wo = await loadScoped(tx, ctx, input.id);
    await addUpdate(tx, ctx, wo.id, { note: input.note, internal: input.internal });
    await audit(ctx, { action: "maintenance.note_added", module: "maintenance", entityType: "MaintenanceRequest", entityId: wo.id, propertyId: wo.propertyId, metadata: { internal: input.internal } }, tx);
    if (!input.internal) await notifyTenant(tx, wo, wo.status);
  });
}

export async function logWork(ctx: AuthContext, input: { id: string; minutes: number; cost: string; note?: string }) {
  requirePerm(ctx, "maintenance.update");
  if (input.minutes <= 0 && money(input.cost).lte(0)) throw new BusinessError("Enter labour time or a cost.");
  return db.$transaction(async (tx) => {
    const wo = await loadScoped(tx, ctx, input.id);
    if (["CLOSED", "CANCELLED"].includes(wo.status)) throw new BusinessError("This work order is closed.");
    const newCost = money(wo.costAmount).plus(money(input.cost));
    await tx.maintenanceRequest.update({ where: { id: wo.id }, data: { laborMinutes: { increment: input.minutes }, costAmount: toDb(newCost) } });
    await addUpdate(tx, ctx, wo.id, { note: `Work logged: ${input.minutes} min, cost ${toDb(input.cost)}${input.note ? ` — ${input.note}` : ""}`, internal: true });
    await audit(
      ctx,
      {
        action: "maintenance.work_logged",
        module: "maintenance",
        entityType: "MaintenanceRequest",
        entityId: wo.id,
        propertyId: wo.propertyId,
        before: { laborMinutes: wo.laborMinutes, costAmount: wo.costAmount },
        after: { laborMinutes: wo.laborMinutes + input.minutes, costAmount: toDb(newCost), note: input.note },
      },
      tx,
    );
  });
}

/** Technicians / vendors submit a quote; approval is a separate step. */
export async function setEstimate(ctx: AuthContext, input: { id: string; amount: string; note?: string }) {
  requirePerm(ctx, "maintenance.update");
  if (money(input.amount).lte(0)) throw new BusinessError("The estimate must be positive.");
  return db.$transaction(async (tx) => {
    const wo = await loadScoped(tx, ctx, input.id);
    await tx.maintenanceRequest.update({ where: { id: wo.id }, data: { estimateAmount: toDb(input.amount), estimateApproved: false } });
    await addUpdate(tx, ctx, wo.id, { note: `Estimate submitted: ${toDb(input.amount)}${input.note ? ` — ${input.note}` : ""}`, internal: true });
    await audit(
      ctx,
      { action: "maintenance.estimate_set", module: "maintenance", entityType: "MaintenanceRequest", entityId: wo.id, propertyId: wo.propertyId, before: { estimateAmount: wo.estimateAmount, estimateApproved: wo.estimateApproved }, after: { estimateAmount: toDb(input.amount) } },
      tx,
    );
  });
}

/** Approval requires maintenance.assign; above the org threshold it also requires expense.approve. */
export async function approveEstimate(ctx: AuthContext, input: { id: string }) {
  requirePerm(ctx, "maintenance.assign");
  return db.$transaction(async (tx) => {
    const wo = await loadScoped(tx, ctx, input.id);
    if (!wo.estimateAmount) throw new BusinessError("There is no estimate to approve.");
    if (wo.estimateApproved) throw new BusinessError("The estimate is already approved.");
    const settings = await tx.organizationSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { expenseApprovalThreshold: true } });
    const threshold = money(settings?.expenseApprovalThreshold ?? 0);
    if (money(wo.estimateAmount).gt(threshold) && !can(ctx, "expense.approve")) {
      throw new BusinessError("This estimate exceeds the approval threshold and must be approved by a finance approver.");
    }
    await tx.maintenanceRequest.update({ where: { id: wo.id }, data: { estimateApproved: true } });
    await addUpdate(tx, ctx, wo.id, { note: `Estimate approved: ${toDb(wo.estimateAmount)}`, internal: true });
    await audit(ctx, { action: "maintenance.estimate_approved", module: "maintenance", entityType: "MaintenanceRequest", entityId: wo.id, propertyId: wo.propertyId, after: { estimateAmount: wo.estimateAmount } }, tx);
  });
}

/** Before/after evidence photos attached to a work order. */
export async function addEvidence(ctx: AuthContext, input: { id: string; file: File; phase: "BEFORE" | "AFTER" | "OTHER"; visibleToTenant: boolean }) {
  requirePerm(ctx, "maintenance.update");
  const wo = await loadScoped(db, ctx, input.id);
  const base = (input.file.name || "photo").replace(/[\\/]/g, "_").slice(0, 150);
  const name = `${input.phase.toLowerCase()}-${base}`;
  return db.$transaction(async (tx) => {
    const doc = await storeDocument(
      ctx,
      { file: input.file, name, category: "MAINTENANCE", workOrderId: wo.id, propertyId: wo.propertyId, tenantId: wo.tenantId, visibleToTenant: input.visibleToTenant },
      tx,
    );
    await addUpdate(tx, ctx, wo.id, { note: `Photo added (${input.phase.toLowerCase()}): ${doc.name}`, internal: !input.visibleToTenant });
    return doc;
  });
}

/** Staff photo attached at creation time (visible to the tenant). */
export async function attachCreationPhoto(ctx: AuthContext, requestId: string, file: File) {
  requirePerm(ctx, "maintenance.create");
  const wo = await db.maintenanceRequest.findFirst({ where: { id: requestId, organizationId: ctx.organizationId, reporterId: ctx.user.id } });
  if (!wo) throw new BusinessError("Work order not found.");
  return storeDocument(ctx, { file, category: "MAINTENANCE", workOrderId: wo.id, propertyId: wo.propertyId, tenantId: wo.tenantId, visibleToTenant: true });
}

/** Portal: tenant rates a finished job (1–5). Ownership and status are enforced here. */
export async function rateRequest(tenantId: string, requestId: string, rating: number, ctx?: AuthContext) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new BusinessError("Rating must be between 1 and 5.");
  if (ctx && ctx.tenantId !== tenantId) throw new ForbiddenError();
  return db.$transaction(async (tx) => {
    const wo = await tx.maintenanceRequest.findFirst({ where: { id: requestId, tenantId, ...(ctx ? { organizationId: ctx.organizationId } : {}) } });
    if (!wo) throw new BusinessError("Work order not found.");
    if (!["COMPLETED", "CLOSED", "TENANT_CONFIRMATION"].includes(wo.status)) throw new BusinessError("You can rate a request once the work is completed.");
    await tx.maintenanceRequest.update({ where: { id: wo.id }, data: { rating } });
    await addUpdate(tx, ctx ?? null, wo.id, { note: `Tenant rating: ${rating}/5` }, ctx ? undefined : { id: null, name: "Tenant" });
    await audit(ctx ?? null, { action: "maintenance.rated", module: "maintenance", entityType: "MaintenanceRequest", entityId: wo.id, propertyId: wo.propertyId, before: { rating: wo.rating }, after: { rating } }, tx, wo.organizationId);
  });
}

/** Users that can be assigned work (technicians / maintenance managers). */
export async function assignableUsers(ctx: AuthContext) {
  return db.user.findMany({
    where: { organizationId: ctx.organizationId, status: "ACTIVE", roles: { some: { role: { key: { in: ASSIGNABLE_ROLE_KEYS }, active: true } } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
