import "server-only";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { BusinessError } from "@/lib/action";
import { toDb } from "@/lib/money";
import type { AuthContext } from "@/lib/auth/context";
import { activationErrors, canTransitionLease, findOverlaps } from "@/domain/lease-rules";
import { generateLeaseSchedule } from "./billing";

async function loadLease(tx: Tx, ctx: AuthContext, leaseId: string) {
  const lease = await tx.lease.findFirst({
    where: {
      id: leaseId,
      organizationId: ctx.organizationId,
      ...(ctx.propertyIds === "ALL" ? {} : { unit: { propertyId: { in: ctx.propertyIds } } }),
    },
    include: { unit: true },
  });
  if (!lease) throw new BusinessError("Lease not found.");
  return lease;
}

async function assertNoOverlap(tx: Tx, organizationId: string, lease: { id?: string; unitId: string; startDate: Date; endDate: Date }) {
  // Lock the unit row so two leases cannot be activated for it concurrently.
  await tx.$queryRaw`SELECT id FROM "Unit" WHERE id = ${lease.unitId} FOR UPDATE`;
  const settings = await tx.organizationSettings.findUnique({ where: { organizationId } });
  const existing = await tx.lease.findMany({ where: { unitId: lease.unitId }, select: { id: true, startDate: true, endDate: true, status: true } });
  const overlaps = findOverlaps({ ...lease, status: "DRAFT" }, existing, settings?.sharedTenancyEnabled ?? false);
  if (overlaps.length) throw new BusinessError("This unit already has an active or pending lease for overlapping dates.");
}

async function event(tx: Tx, ctx: AuthContext, leaseId: string, type: string, note = "", data?: object) {
  await tx.leaseEvent.create({ data: { leaseId, type, note, data: data as never, actorId: ctx.user.id } });
}

async function setUnitStatus(tx: Tx, ctx: AuthContext, unitId: string, to: "VACANT" | "OCCUPIED" | "NOTICE_GIVEN" | "RESERVED", reason: string) {
  const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
  if (unit.status === to) return;
  await tx.unit.update({ where: { id: unitId }, data: { status: to } });
  await tx.unitStatusHistory.create({ data: { unitId, from: unit.status, to, reason, actorId: ctx.user.id } });
}

export async function submitLease(ctx: AuthContext, leaseId: string) {
  return db.$transaction(async (tx) => {
    const lease = await loadLease(tx, ctx, leaseId);
    if (!canTransitionLease(lease.status, "PENDING_APPROVAL")) throw new BusinessError("Only drafts can be submitted.");
    const errs = activationErrors({ ...lease, rentAmount: lease.rentAmount.toString() });
    if (errs.length) throw new BusinessError(`Missing or invalid: ${errs.join(", ")}`);
    await assertNoOverlap(tx, ctx.organizationId, lease);
    await tx.lease.update({ where: { id: leaseId }, data: { status: "PENDING_APPROVAL" } });
    await event(tx, ctx, leaseId, "SUBMITTED");
    await audit(ctx, { action: "lease.submitted", module: "leases", entityType: "Lease", entityId: leaseId, propertyId: lease.unit.propertyId }, tx);
  });
}

/**
 * Approves and activates a lease in one transaction: validates required fields and overlaps,
 * generates the rent schedule, opens the security deposit record and marks the unit occupied.
 */
export async function approveAndActivateLease(ctx: AuthContext, leaseId: string) {
  return db.$transaction(async (tx) => {
    const lease = await loadLease(tx, ctx, leaseId);
    if (!canTransitionLease(lease.status, "ACTIVE")) throw new BusinessError("Only leases pending approval can be activated.");
    const errs = activationErrors({ ...lease, rentAmount: lease.rentAmount.toString() });
    if (errs.length) throw new BusinessError(`Missing or invalid: ${errs.join(", ")}`);
    await assertNoOverlap(tx, ctx.organizationId, lease);
    await tx.lease.update({
      where: { id: leaseId },
      data: { status: "ACTIVE", approvedById: ctx.user.id, approvedAt: new Date(), activatedAt: new Date() },
    });
    const periods = await generateLeaseSchedule(tx, leaseId);
    if (lease.depositAmount.gt(0)) {
      await tx.securityDeposit.upsert({
        where: { leaseId },
        create: { organizationId: ctx.organizationId, leaseId, required: toDb(lease.depositAmount.toString()) },
        update: {},
      });
    }
    await setUnitStatus(tx, ctx, lease.unitId, "OCCUPIED", `Lease ${lease.reference} activated`);
    await event(tx, ctx, leaseId, "APPROVED");
    await event(tx, ctx, leaseId, "ACTIVATED", `${periods} schedule entries generated`);
    await audit(ctx, { action: "lease.activated", module: "leases", entityType: "Lease", entityId: leaseId, propertyId: lease.unit.propertyId, metadata: { periods } }, tx);
    return periods;
  });
}

export async function returnLeaseToDraft(ctx: AuthContext, leaseId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const lease = await loadLease(tx, ctx, leaseId);
    if (lease.status !== "PENDING_APPROVAL") throw new BusinessError("Only pending leases can be returned.");
    await tx.lease.update({ where: { id: leaseId }, data: { status: "DRAFT" } });
    await event(tx, ctx, leaseId, "RETURNED", reason);
    await audit(ctx, { action: "lease.returned_to_draft", module: "leases", entityType: "Lease", entityId: leaseId, metadata: { reason } }, tx);
  });
}

export async function recordNotice(ctx: AuthContext, leaseId: string, moveOutDate: Date, note: string) {
  return db.$transaction(async (tx) => {
    const lease = await loadLease(tx, ctx, leaseId);
    if (!canTransitionLease(lease.status, "NOTICE_GIVEN")) throw new BusinessError("Notice can only be recorded on active leases.");
    await tx.lease.update({ where: { id: leaseId }, data: { status: "NOTICE_GIVEN", noticeDate: new Date(), moveOutDate } });
    await setUnitStatus(tx, ctx, lease.unitId, "NOTICE_GIVEN", "Notice to vacate");
    await event(tx, ctx, leaseId, "NOTICE", note, { moveOutDate: moveOutDate.toISOString().slice(0, 10) });
    await audit(ctx, { action: "lease.notice_given", module: "leases", entityType: "Lease", entityId: leaseId, metadata: { moveOutDate } }, tx);
  });
}

/**
 * Terminates a lease. Future schedule entries that were never invoiced are cancelled
 * (not deleted); issued invoices are untouched and must be settled or credited separately.
 */
export async function terminateLease(ctx: AuthContext, leaseId: string, endDate: Date, reason: string) {
  if (reason.trim().length < 3) throw new BusinessError("A reason is required.");
  return db.$transaction(async (tx) => {
    const lease = await loadLease(tx, ctx, leaseId);
    if (!canTransitionLease(lease.status, "TERMINATED")) throw new BusinessError("This lease cannot be terminated from its current status.");
    await tx.lease.update({
      where: { id: leaseId },
      data: { status: "TERMINATED", terminatedAt: new Date(), terminationReason: reason, moveOutDate: endDate },
    });
    const cancelled = await tx.rentSchedule.updateMany({
      where: { leaseId, invoiceId: null, periodStart: { gt: endDate } },
      data: { cancelled: true },
    });
    await setUnitStatus(tx, ctx, lease.unitId, "VACANT", `Lease ${lease.reference} terminated`);
    await event(tx, ctx, leaseId, "TERMINATED", reason, { endDate: endDate.toISOString().slice(0, 10), cancelledPeriods: cancelled.count });
    await audit(ctx, { action: "lease.terminated", module: "leases", entityType: "Lease", entityId: leaseId, metadata: { reason, cancelledPeriods: cancelled.count } }, tx);
  });
}

/**
 * Renewal / amendment never edits the signed lease: it creates a new version (draft) linked to
 * the previous one, which is marked RENEWED once the new version is activated.
 */
export async function createRenewal(ctx: AuthContext, leaseId: string, input: { startDate: Date; endDate: Date; rentAmount: string; note: string }, reference: string) {
  return db.$transaction(async (tx) => {
    const lease = await loadLease(tx, ctx, leaseId);
    if (!["ACTIVE", "NOTICE_GIVEN", "EXPIRED"].includes(lease.status)) throw new BusinessError("Only active or expired leases can be renewed.");
    if (input.startDate <= lease.endDate && lease.status !== "EXPIRED") {
      throw new BusinessError("The renewal must start after the current lease ends. Use termination first for mid-term changes.");
    }
    const { id: _id, createdAt: _c, updatedAt: _u, unit: _unit, ...rest } = lease;
    void _id; void _c; void _u; void _unit;
    const renewal = await tx.lease.create({
      data: {
        ...rest,
        reference,
        startDate: input.startDate,
        endDate: input.endDate,
        moveInDate: null,
        rentAmount: toDb(input.rentAmount),
        status: "DRAFT",
        version: lease.version + 1,
        previousLeaseId: lease.id,
        approvedById: null, approvedAt: null, activatedAt: null, noticeDate: null, moveOutDate: null, terminatedAt: null, terminationReason: null,
        createdById: ctx.user.id,
      },
    });
    await event(tx, ctx, lease.id, "RENEWAL_DRAFTED", input.note, { renewalId: renewal.id, rentAmount: input.rentAmount });
    await event(tx, ctx, renewal.id, "CREATED", `Renewal of ${lease.reference}`);
    await audit(ctx, { action: "lease.renewal_created", module: "leases", entityType: "Lease", entityId: renewal.id, metadata: { from: lease.id, rent: input.rentAmount } }, tx);
    return renewal;
  });
}

/** When a renewal is activated, the previous version is closed as RENEWED. */
export async function closePreviousVersion(ctx: AuthContext, leaseId: string) {
  const lease = await db.lease.findFirst({ where: { id: leaseId, organizationId: ctx.organizationId } });
  if (!lease?.previousLeaseId) return;
  await db.lease.updateMany({
    where: { id: lease.previousLeaseId, status: { in: ["ACTIVE", "NOTICE_GIVEN", "EXPIRED"] } },
    data: { status: "RENEWED" },
  });
}
