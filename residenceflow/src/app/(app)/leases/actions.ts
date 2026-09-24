"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, can, leaseWhere, unitWhere, type AuthContext } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError, ForbiddenError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { toDb } from "@/lib/money";
import { storeDocument } from "@/lib/storage";
import { getT, type T } from "@/i18n";
import { loadScopedTenant } from "@/services/tenants";
import {
  approveAndActivateLease,
  closePreviousVersion,
  createRenewal,
  recordNotice,
  returnLeaseToDraft,
  submitLease,
  terminateLease,
} from "@/services/leases";
import { FREQUENCIES, LATE_FEE_TYPES, boolField, dayField, idField, moneyField, optDayField, optMoneyField } from "./fields";
import { leaseMessages } from "./messages";

const leaseSchema = z.object({
  tenantId: idField,
  startDate: dayField,
  endDate: dayField,
  moveInDate: optDayField,
  frequency: z.enum(FREQUENCIES),
  rentAmount: moneyField,
  serviceCharge: optMoneyField,
  depositAmount: optMoneyField,
  dueDay: z.coerce.number().int().min(1).max(31),
  graceDays: z.coerce.number().int().min(0).max(90),
  lateFeeType: z.enum(LATE_FEE_TYPES),
  lateFeeValue: optMoneyField,
  noticeDays: z.coerce.number().int().min(0).max(365),
  prorate: boolField,
  specialTerms: z.string().trim().max(8000).default(""),
  renewalTerms: z.string().trim().max(4000).default(""),
});

async function parseLease(ctx: AuthContext, t: T, fd: FormData) {
  const d = leaseSchema.parse(formToObject(fd));
  if (d.endDate <= d.startDate) throw new BusinessError(t("lease.err.dateOrder"));
  if (d.lateFeeType === "PERCENT" && Number(d.lateFeeValue) > 100) throw new BusinessError(t("lease.err.percent"));
  const tenant = await loadScopedTenant(ctx, d.tenantId);
  if (!tenant) throw new BusinessError(t("lease.err.tenantNotFound"));
  if (tenant.status === "ARCHIVED" || tenant.status === "BLACKLISTED") throw new BusinessError(t("lease.err.tenantInactive"));
  return {
    tenantId: tenant.id,
    startDate: d.startDate,
    endDate: d.endDate,
    moveInDate: d.moveInDate,
    frequency: d.frequency,
    rentAmount: toDb(d.rentAmount),
    serviceCharge: toDb(d.serviceCharge),
    depositAmount: toDb(d.depositAmount),
    dueDay: d.dueDay,
    graceDays: d.graceDays,
    lateFeeType: d.lateFeeType,
    lateFeeValue: d.lateFeeType === "NONE" ? "0.00" : toDb(d.lateFeeValue),
    noticeDays: d.noticeDays,
    prorate: d.prorate,
    specialTerms: d.specialTerms,
    renewalTerms: d.renewalTerms,
  };
}

async function loadScopedLease(ctx: AuthContext, t: T, id: string) {
  const lease = await db.lease.findFirst({ where: { ...leaseWhere(ctx), id: idField.parse(id) }, include: { unit: { select: { propertyId: true } } } });
  if (!lease) throw new BusinessError(t("lease.err.notFound"));
  return lease;
}

export async function createLeaseAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    const ctx = await authorize("lease.create");
    const { t } = await getT(leaseMessages);
    const unit = await db.unit.findFirst({ where: { ...unitWhere(ctx), id: idField.parse(fd.get("unitId")), archived: false } });
    if (!unit) throw new BusinessError(t("lease.err.unitNotFound"));
    const data = await parseLease(ctx, t, fd);
    const settings = await db.organizationSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { currency: true } });
    const created = await db.$transaction(async (tx) => {
      const reference = await nextNumber(ctx.organizationId, "LEASE", tx);
      const lease = await tx.lease.create({
        data: {
          ...data,
          reference,
          organizationId: ctx.organizationId,
          unitId: unit.id,
          currency: settings?.currency ?? "XAF",
          status: "DRAFT",
          createdById: ctx.user.id,
        },
      });
      await tx.leaseEvent.create({ data: { leaseId: lease.id, type: "CREATED", actorId: ctx.user.id } });
      await audit(ctx, { action: "lease.created", module: "leases", entityType: "Lease", entityId: lease.id, propertyId: unit.propertyId, after: { ...data, reference, unitId: unit.id } }, tx);
      return lease;
    });
    id = created.id;
  });
  if (!r.ok) return r;
  revalidatePath("/leases");
  redirect(`/leases/${id}`);
}

/** Drafts only: signed/active leases are never edited (amendments go through a renewal). */
export async function updateDraftLeaseAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const r = await runAction(async () => {
    const ctx = await authorize("lease.create");
    const { t } = await getT(leaseMessages);
    const before = await loadScopedLease(ctx, t, id);
    if (before.status !== "DRAFT") throw new BusinessError(t("lease.err.notDraft"));
    const data = await parseLease(ctx, t, fd);
    await db.$transaction(async (tx) => {
      // Conditional update guards against a concurrent submit.
      const res = await tx.lease.updateMany({ where: { id: before.id, status: "DRAFT" }, data });
      if (res.count !== 1) throw new BusinessError(t("lease.err.notDraft"));
      await tx.leaseEvent.create({ data: { leaseId: before.id, type: "UPDATED", actorId: ctx.user.id } });
      await audit(ctx, { action: "lease.draft_updated", module: "leases", entityType: "Lease", entityId: before.id, propertyId: before.unit.propertyId, before, after: data }, tx);
    });
  });
  if (!r.ok) return r;
  revalidatePath(`/leases/${id}`);
  redirect(`/leases/${id}`);
}

function done(path: string, message: string) {
  return (r: ActionResult): ActionResult => {
    if (r.ok) {
      revalidatePath(path);
      revalidatePath("/leases");
      return { ...r, message };
    }
    return r;
  };
}

export async function submitLeaseAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(leaseMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize("lease.create");
    const lease = await loadScopedLease(ctx, t, id);
    await submitLease(ctx, lease.id);
  }).then(done(`/leases/${id}`, t("lease.submitted")));
}

function assertCanApprove(ctx: AuthContext) {
  if (!can(ctx, "lease.approve") && !can(ctx, "lease.activate")) throw new ForbiddenError();
}

export async function approveLeaseAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(leaseMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize("lease.view");
    assertCanApprove(ctx);
    const lease = await loadScopedLease(ctx, t, id);
    await approveAndActivateLease(ctx, lease.id);
    await closePreviousVersion(ctx, lease.id);
    if (lease.previousLeaseId) {
      await db.leaseEvent.create({ data: { leaseId: lease.previousLeaseId, type: "RENEWED", note: lease.reference, data: { renewalId: lease.id }, actorId: ctx.user.id } });
    }
    revalidatePath(`/units/${lease.unitId}`);
  }).then(done(`/leases/${id}`, t("lease.approved")));
}

const reasonSchema = z.object({ id: idField, reason: z.string().trim().min(3).max(1000) });

export async function returnToDraftAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(leaseMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize("lease.view");
    assertCanApprove(ctx);
    const input = reasonSchema.parse(formToObject(fd));
    const lease = await loadScopedLease(ctx, t, input.id);
    await returnLeaseToDraft(ctx, lease.id, input.reason);
  }).then(done(`/leases/${id}`, t("lease.returned")));
}

const noticeSchema = z.object({ id: idField, moveOutDate: dayField, note: z.string().trim().max(1000).default("") });

export async function recordNoticeAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(leaseMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize("lease.terminate");
    const input = noticeSchema.parse(formToObject(fd));
    const lease = await loadScopedLease(ctx, t, input.id);
    if (input.moveOutDate < lease.startDate) throw new BusinessError(t("lease.err.moveOutBeforeStart"));
    await recordNotice(ctx, lease.id, input.moveOutDate, input.note);
    revalidatePath(`/units/${lease.unitId}`);
  }).then(done(`/leases/${id}`, t("lease.noticeRecorded")));
}

const terminateSchema = z.object({ id: idField, endDate: dayField, reason: z.string().trim().min(3).max(1000) });

export async function terminateLeaseAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(leaseMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize("lease.terminate");
    const input = terminateSchema.parse(formToObject(fd));
    const lease = await loadScopedLease(ctx, t, input.id);
    if (input.endDate < lease.startDate) throw new BusinessError(t("lease.err.moveOutBeforeStart"));
    await terminateLease(ctx, lease.id, input.endDate, input.reason);
    revalidatePath(`/units/${lease.unitId}`);
  }).then(done(`/leases/${id}`, t("lease.terminated")));
}

const renewalSchema = z.object({
  id: idField,
  startDate: dayField,
  endDate: dayField,
  rentAmount: moneyField,
  note: z.string().trim().max(1000).default(""),
});

export async function createRenewalAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let newId = "";
  const r = await runAction(async () => {
    const ctx = await authorize("lease.create");
    const { t } = await getT(leaseMessages);
    const input = renewalSchema.parse(formToObject(fd));
    if (input.endDate <= input.startDate) throw new BusinessError(t("lease.err.dateOrder"));
    const lease = await loadScopedLease(ctx, t, input.id);
    const reference = await nextNumber(ctx.organizationId, "LEASE");
    const renewal = await createRenewal(ctx, lease.id, { startDate: input.startDate, endDate: input.endDate, rentAmount: input.rentAmount, note: input.note }, reference);
    newId = renewal.id;
  });
  if (!r.ok) return r;
  revalidatePath("/leases");
  redirect(`/leases/${newId}`);
}

export async function uploadLeaseDocumentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(leaseMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize(["lease.view", "document.upload"]);
    const lease = await loadScopedLease(ctx, t, id);
    const meta = z
      .object({ name: z.string().trim().max(200).default(""), visibleToTenant: boolField })
      .parse({ name: fd.get("name") ?? "", visibleToTenant: fd.get("visibleToTenant") });
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new BusinessError(t("lease.err.fileRequired"));
    await db.$transaction(async (tx) => {
      const doc = await storeDocument(ctx, {
        file,
        category: "LEASE",
        name: meta.name || undefined,
        leaseId: lease.id,
        tenantId: lease.tenantId,
        propertyId: lease.unit.propertyId,
        visibleToTenant: meta.visibleToTenant,
      }, tx);
      await tx.leaseEvent.create({ data: { leaseId: lease.id, type: "DOCUMENT", note: doc.name, data: { documentId: doc.id }, actorId: ctx.user.id } });
    });
  }).then(done(`/leases/${id}`, t("lease.uploaded")));
}
