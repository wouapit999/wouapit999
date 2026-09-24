"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, unitWhere, type AuthContext } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { money, toDb } from "@/lib/money";
import { formatMoney } from "@/lib/format";
import { getOrgSettings } from "@/lib/settings";
import { getT, type T } from "@/i18n";
import { emailField, idField, optDayField, optMoneyField, stringList, todayUtcDay } from "../leases/fields";
import { addMonthsClamped } from "@/domain/payment-plan";
import { applicationsEnabled, loadScopedApplication, parseChecklist, type ChecklistEntry } from "./data";
import { APPLICANT_TYPES, CHECKLIST_ITEMS, applicationMessages } from "./messages";

type App = NonNullable<Awaited<ReturnType<typeof loadScopedApplication>>>;

const applicationSchema = z.object({
  unitId: z.union([z.literal(""), idField]).default(""),
  applicantName: z.string().trim().min(2).max(200),
  applicantEmail: emailField.default(""),
  applicantPhone: z.string().trim().max(40).default(""),
  applicantType: z.enum(APPLICANT_TYPES).default("INDIVIDUAL"),
  employer: z.string().trim().max(200).default(""),
  monthlyIncome: optMoneyField,
  householdSize: z.coerce.number().int().min(1).max(50).default(1),
  desiredMoveIn: optDayField,
  notes: z.string().trim().max(8000).default(""),
  checklist: stringList(CHECKLIST_ITEMS),
  reservationFee: optMoneyField,
});

function checklistFromForm(received: readonly string[]): ChecklistEntry[] {
  return CHECKLIST_ITEMS.map((item) => ({ item, received: received.includes(item) }));
}

async function guard(ctx: AuthContext, t: T) {
  if (!(await applicationsEnabled(ctx.organizationId))) throw new BusinessError(t("app.err.disabled"));
}

async function loadOrFail(ctx: AuthContext, t: T, id: string) {
  const app = await loadScopedApplication(ctx, idField.parse(id));
  if (!app) throw new BusinessError(t("app.err.notFound"));
  return app;
}

async function setUnitStatus(tx: Tx, ctx: AuthContext, unitId: string, to: "VACANT" | "RESERVED", reason: string) {
  const unit = await tx.unit.findUnique({ where: { id: unitId } });
  if (!unit || unit.status === to) return;
  await tx.unit.update({ where: { id: unit.id }, data: { status: to } });
  await tx.unitStatusHistory.create({ data: { unitId: unit.id, from: unit.status, to, reason, actorId: ctx.user.id } });
  await audit(ctx, { action: "unit.status_changed", module: "applications", entityType: "Unit", entityId: unit.id, propertyId: unit.propertyId, before: { status: unit.status }, after: { status: to }, metadata: { reason } }, tx);
}

function appAudit(ctx: AuthContext, tx: Tx, app: Pick<App, "id" | "unit">, action: string, extra: { before?: unknown; after?: unknown; metadata?: unknown } = {}) {
  return audit(ctx, { action: `application.${action}`, module: "applications", entityType: "RentalApplication", entityId: app.id, propertyId: app.unit?.propertyId ?? null, ...extra }, tx);
}

export async function createApplicationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    const ctx = await authorize("lease.create");
    const { t } = await getT(applicationMessages);
    await guard(ctx, t);
    const d = applicationSchema.parse(formToObject(fd));
    let unit: { id: string; propertyId: string } | null = null;
    if (d.unitId) {
      unit = await db.unit.findFirst({ where: { ...unitWhere(ctx), id: d.unitId, archived: false, status: { in: ["VACANT", "RESERVED"] } }, select: { id: true, propertyId: true } });
      if (!unit) throw new BusinessError(t("app.err.unitNotFound"));
    }
    const data = {
      unitId: unit?.id ?? null,
      applicantName: d.applicantName,
      applicantEmail: d.applicantEmail.toLowerCase(),
      applicantPhone: d.applicantPhone,
      applicantType: d.applicantType,
      employer: d.employer,
      monthlyIncome: money(d.monthlyIncome).gt(0) ? toDb(d.monthlyIncome) : null,
      householdSize: d.householdSize,
      desiredMoveIn: d.desiredMoveIn,
      notes: d.notes,
      checklist: checklistFromForm(d.checklist) as unknown as Prisma.InputJsonValue,
      reservationFee: toDb(d.reservationFee),
    };
    const created = await db.$transaction(async (tx) => {
      const reference = await nextNumber(ctx.organizationId, "APPLICATION", tx);
      const app = await tx.rentalApplication.create({ data: { ...data, reference, organizationId: ctx.organizationId, status: "SUBMITTED", createdById: ctx.user.id } });
      await audit(ctx, { action: "application.created", module: "applications", entityType: "RentalApplication", entityId: app.id, propertyId: unit?.propertyId ?? null, after: { ...data, reference } }, tx);
      return app;
    });
    id = created.id;
  });
  if (!r.ok) return r;
  revalidatePath("/applications");
  redirect(`/applications/${id}`);
}

function done(id: string, message: string) {
  return (r: ActionResult): ActionResult => {
    if (r.ok) {
      revalidatePath(`/applications/${id}`);
      revalidatePath("/applications");
      return { ...r, message };
    }
    return r;
  };
}

const OPEN = ["SUBMITTED", "UNDER_REVIEW"] as const;

export async function updateChecklistAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(applicationMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize("lease.create");
    await guard(ctx, t);
    const app = await loadOrFail(ctx, t, id);
    const received = stringList(CHECKLIST_ITEMS).parse(formToObject(fd).checklist);
    const checklist = checklistFromForm(received);
    await db.$transaction(async (tx) => {
      await tx.rentalApplication.update({ where: { id: app.id }, data: { checklist: checklist as unknown as Prisma.InputJsonValue } });
      await appAudit(ctx, tx, app, "checklist_updated", { before: parseChecklist(app.checklist), after: checklist });
    });
  }).then(done(id, t("app.saved")));
}

export async function updateReviewNotesAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(applicationMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize("lease.create");
    await guard(ctx, t);
    const app = await loadOrFail(ctx, t, id);
    const reviewNotes = z.string().trim().max(8000).default("").parse(fd.get("reviewNotes") ?? "");
    await db.$transaction(async (tx) => {
      await tx.rentalApplication.update({ where: { id: app.id }, data: { reviewNotes, reviewedById: ctx.user.id } });
      // Review notes are internal: only the fact that they changed is audited, not their content.
      await appAudit(ctx, tx, app, "review_notes_updated", { metadata: { changed: reviewNotes !== app.reviewNotes } });
    });
  }).then(done(id, t("app.saved")));
}

export async function startReviewAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(applicationMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize("lease.create");
    await guard(ctx, t);
    const app = await loadOrFail(ctx, t, id);
    if (app.status !== "SUBMITTED") throw new BusinessError(t("app.err.transition"));
    await db.$transaction(async (tx) => {
      const res = await tx.rentalApplication.updateMany({ where: { id: app.id, status: "SUBMITTED" }, data: { status: "UNDER_REVIEW", reviewedById: ctx.user.id } });
      if (res.count !== 1) throw new BusinessError(t("app.err.transition"));
      await appAudit(ctx, tx, app, "review_started", { before: { status: app.status }, after: { status: "UNDER_REVIEW" } });
    });
  }).then(done(id, t("app.reviewStarted")));
}

const decisionSchema = z.object({ id: idField, reason: z.string().trim().max(2000).default("") });

/** Human decision only: this action is never called by any scheduled job or rule engine. */
export async function approveApplicationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(applicationMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize("lease.approve");
    await guard(ctx, t);
    const input = decisionSchema.parse(formToObject(fd));
    const app = await loadOrFail(ctx, t, input.id);
    if (!(OPEN as readonly string[]).includes(app.status)) throw new BusinessError(t("app.err.transition"));
    await db.$transaction(async (tx) => {
      const res = await tx.rentalApplication.updateMany({
        where: { id: app.id, status: { in: [...OPEN] } },
        data: { status: "APPROVED", decisionReason: input.reason, decidedAt: new Date(), reviewedById: ctx.user.id },
      });
      if (res.count !== 1) throw new BusinessError(t("app.err.transition"));
      if (app.unit && app.unit.status === "VACANT") await setUnitStatus(tx, ctx, app.unit.id, "RESERVED", `Application ${app.reference} approved`);
      await appAudit(ctx, tx, app, "approved", { before: { status: app.status }, after: { status: "APPROVED" }, metadata: { reason: input.reason } });
    });
  }).then(done(id, t("app.approvedMsg")));
}

/** Releases a unit reserved by this application (only when it is still RESERVED and no lease was created). */
async function releaseReservation(tx: Tx, ctx: AuthContext, app: App, reason: string) {
  if (app.status === "APPROVED" && app.unit && app.unit.status === "RESERVED" && !app.leaseId) {
    await setUnitStatus(tx, ctx, app.unit.id, "VACANT", reason);
  }
}

export async function rejectApplicationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(applicationMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize("lease.approve");
    await guard(ctx, t);
    const input = decisionSchema.parse(formToObject(fd));
    if (input.reason.length < 5) throw new BusinessError(t("app.err.reason"));
    const app = await loadOrFail(ctx, t, input.id);
    const allowed = [...OPEN, "APPROVED"];
    if (!allowed.includes(app.status)) throw new BusinessError(t("app.err.transition"));
    await db.$transaction(async (tx) => {
      const res = await tx.rentalApplication.updateMany({
        where: { id: app.id, status: { in: allowed } },
        data: { status: "REJECTED", decisionReason: input.reason, decidedAt: new Date(), reviewedById: ctx.user.id },
      });
      if (res.count !== 1) throw new BusinessError(t("app.err.transition"));
      await releaseReservation(tx, ctx, app, `Application ${app.reference} rejected`);
      await appAudit(ctx, tx, app, "rejected", { before: { status: app.status }, after: { status: "REJECTED" }, metadata: { reason: input.reason } });
    });
  }).then(done(id, t("app.rejectedMsg")));
}

export async function withdrawApplicationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(applicationMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize("lease.create");
    await guard(ctx, t);
    const input = decisionSchema.parse(formToObject(fd));
    const app = await loadOrFail(ctx, t, input.id);
    const allowed = [...OPEN, "APPROVED"];
    if (!allowed.includes(app.status)) throw new BusinessError(t("app.err.transition"));
    await db.$transaction(async (tx) => {
      const res = await tx.rentalApplication.updateMany({
        where: { id: app.id, status: { in: allowed } },
        data: { status: "WITHDRAWN", decisionReason: input.reason, decidedAt: new Date() },
      });
      if (res.count !== 1) throw new BusinessError(t("app.err.transition"));
      await releaseReservation(tx, ctx, app, `Application ${app.reference} withdrawn`);
      await appAudit(ctx, tx, app, "withdrawn", { before: { status: app.status }, after: { status: "WITHDRAWN" }, metadata: { reason: input.reason } });
    });
  }).then(done(id, t("app.withdrawnMsg")));
}

export async function toggleReservationPaidAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(applicationMessages);
  const id = String(fd.get("id") ?? "");
  return runAction(async () => {
    const ctx = await authorize("lease.create");
    await guard(ctx, t);
    const app = await loadOrFail(ctx, t, id);
    const paid = String(fd.get("paid") ?? "") === "true";
    if (["REJECTED", "WITHDRAWN", "CONVERTED"].includes(app.status)) throw new BusinessError(t("app.err.transition"));
    await db.$transaction(async (tx) => {
      await tx.rentalApplication.update({ where: { id: app.id }, data: { reservationPaid: paid } });
      await appAudit(ctx, tx, app, paid ? "reservation_paid" : "reservation_unpaid", { before: { reservationPaid: app.reservationPaid }, after: { reservationPaid: paid }, metadata: { reservationFee: app.reservationFee } });
    });
  }).then(done(id, t("app.reservationUpdated")));
}

/**
 * Converts an approved application into a Tenant plus a DRAFT lease on the chosen unit.
 * The lease still goes through the normal submit → approve → activate workflow.
 */
export async function convertApplicationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let leaseId = "";
  const r = await runAction(async () => {
    const ctx = await authorize("lease.create");
    const { t, locale } = await getT(applicationMessages);
    await guard(ctx, t);
    const input = z.object({ id: idField, unitId: z.union([z.literal(""), idField]).default("") }).parse(formToObject(fd));
    const app = await loadOrFail(ctx, t, input.id);
    if (app.status !== "APPROVED") throw new BusinessError(t("app.err.notApproved"));
    const unitId = input.unitId || app.unitId;
    if (!unitId) throw new BusinessError(t("app.err.unitRequired"));
    const unit = await db.unit.findFirst({ where: { ...unitWhere(ctx), id: unitId, archived: false, status: { in: ["VACANT", "RESERVED"] } } });
    if (!unit) throw new BusinessError(t("app.err.unitNotFound"));
    const settings = await getOrgSettings(ctx.organizationId);
    const startDate = app.desiredMoveIn ?? todayUtcDay();
    const endDate = addMonthsClamped(startDate, 12);
    const fmt = { locale, currency: settings?.currency ?? "XAF" };
    const specialTerms = money(app.reservationFee).gt(0) && app.reservationPaid
      ? t("app.specialTermsNote", { amount: formatMoney(app.reservationFee, fmt), reference: app.reference })
      : "";

    const created = await db.$transaction(async (tx) => {
      // Re-check inside the transaction so two staff cannot convert the same application twice.
      const claim = await tx.rentalApplication.updateMany({ where: { id: app.id, status: "APPROVED" }, data: { status: "CONVERTED" } });
      if (claim.count !== 1) throw new BusinessError(t("app.err.notApproved"));

      const tenantRef = await nextNumber(ctx.organizationId, "TENANT", tx);
      const tenantData = {
        type: app.applicantType,
        legalName: app.applicantName,
        email: app.applicantEmail,
        phone: app.applicantPhone,
        employer: app.employer,
        language: locale,
        status: "ACTIVE",
      };
      const tenant = await tx.tenant.create({ data: { ...tenantData, reference: tenantRef, organizationId: ctx.organizationId } });
      await audit(ctx, { action: "tenant.created", module: "tenants", entityType: "Tenant", entityId: tenant.id, after: { ...tenantData, reference: tenantRef, applicationId: app.id } }, tx);

      const leaseRef = await nextNumber(ctx.organizationId, "LEASE", tx);
      const leaseData = {
        tenantId: tenant.id,
        unitId: unit.id,
        startDate,
        endDate,
        moveInDate: startDate,
        frequency: unit.billingFrequency || "MONTHLY",
        rentAmount: toDb(unit.defaultRent),
        serviceCharge: toDb(unit.defaultServiceCharge),
        depositAmount: toDb(unit.defaultDeposit),
        currency: settings?.currency ?? "XAF",
        dueDay: 5,
        graceDays: settings?.defaultGraceDays ?? 5,
        lateFeeType: settings?.lateFeeType ?? "NONE",
        lateFeeValue: toDb(settings?.lateFeeValue ?? 0),
        specialTerms,
      };
      const lease = await tx.lease.create({ data: { ...leaseData, reference: leaseRef, organizationId: ctx.organizationId, status: "DRAFT", createdById: ctx.user.id } });
      await tx.leaseEvent.create({ data: { leaseId: lease.id, type: "CREATED", note: `Application ${app.reference}`, data: { applicationId: app.id }, actorId: ctx.user.id } });
      await audit(ctx, { action: "lease.created", module: "leases", entityType: "Lease", entityId: lease.id, propertyId: unit.propertyId, after: { ...leaseData, reference: leaseRef, applicationId: app.id } }, tx);

      await tx.rentalApplication.update({ where: { id: app.id }, data: { tenantId: tenant.id, leaseId: lease.id, unitId: unit.id } });
      if (unit.status === "VACANT") await setUnitStatus(tx, ctx, unit.id, "RESERVED", `Application ${app.reference} converted`);
      await appAudit(ctx, tx, { id: app.id, unit: { propertyId: unit.propertyId } as App["unit"] }, "converted", { before: { status: "APPROVED" }, after: { status: "CONVERTED", tenantId: tenant.id, leaseId: lease.id } });
      return lease;
    });
    leaseId = created.id;
  });
  if (!r.ok) return r;
  revalidatePath("/applications");
  revalidatePath("/leases");
  revalidatePath("/tenants");
  redirect(`/leases/${leaseId}`);
}
