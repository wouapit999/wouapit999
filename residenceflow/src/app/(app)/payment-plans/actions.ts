"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, tenantWhere } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { money, sum, toDb } from "@/lib/money";
import { formatDay, formatMoney } from "@/lib/format";
import { getOrgSettings } from "@/lib/settings";
import { getT } from "@/i18n";
import { tenantBalance, todayUtc } from "@/services/billing";
import { addCollectionNote } from "@/services/finance-extra";
import { PLAN_FREQUENCIES, applyPaymentsToInstallments, buildInstallments, type PlanFrequency } from "@/domain/payment-plan";
import { dayField, idField, moneyField } from "../leases/fields";
import { loadScopedPlan } from "./data";
import { CLOSE_STATUSES, paymentPlanMessages } from "./messages";

const createSchema = z.object({
  tenantId: idField,
  totalAmount: moneyField,
  count: z.coerce.number().int().min(2).max(24),
  firstDue: dayField,
  frequency: z.enum(PLAN_FREQUENCIES as unknown as [PlanFrequency, ...PlanFrequency[]]),
  notes: z.string().trim().max(4000).default(""),
});

export async function createPaymentPlanAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let planId = "";
  const r = await runAction(async () => {
    const ctx = await authorize("arrears.manage");
    const { t, locale } = await getT(paymentPlanMessages);
    const d = createSchema.parse(formToObject(fd));
    const tenant = await db.tenant.findFirst({ where: { AND: [tenantWhere(ctx), { id: d.tenantId }] }, select: { id: true } });
    if (!tenant) throw new BusinessError(t("pp.err.tenant"));
    const settings = await getOrgSettings(ctx.organizationId);
    const fmt = { locale, currency: settings?.currency ?? "XAF" };
    const { outstanding } = await tenantBalance(tenant.id);
    const total = money(d.totalAmount);
    if (total.lte(0) || total.gt(outstanding)) throw new BusinessError(t("pp.err.total", { outstanding: formatMoney(outstanding, fmt) }));
    const rows = buildInstallments(total, d.count, d.firstDue, d.frequency);

    const plan = await db.$transaction(async (tx) => {
      const existing = await tx.paymentPlan.findFirst({ where: { organizationId: ctx.organizationId, tenantId: tenant.id, status: "ACTIVE" }, select: { id: true } });
      if (existing) throw new BusinessError(t("pp.err.activeExists"));
      const created = await tx.paymentPlan.create({
        data: {
          organizationId: ctx.organizationId,
          tenantId: tenant.id,
          totalAmount: toDb(total),
          status: "ACTIVE",
          notes: d.notes,
          createdById: ctx.user.id,
          installments: { create: rows.map((i) => ({ sequence: i.sequence, dueDate: i.dueDate, amount: toDb(i.amount), paidAmount: "0.00", status: "PENDING" })) },
        },
      });
      await audit(ctx, {
        action: "payment_plan.created",
        module: "arrears",
        entityType: "PaymentPlan",
        entityId: created.id,
        after: { tenantId: tenant.id, totalAmount: toDb(total), count: d.count, firstDue: d.firstDue, frequency: d.frequency, installments: rows.map((i) => ({ sequence: i.sequence, dueDate: i.dueDate, amount: toDb(i.amount) })) },
      }, tx);
      return created;
    });
    await addCollectionNote(ctx, {
      tenantId: tenant.id,
      kind: "PROMISE_TO_PAY",
      note: t("pp.promiseNote", { count: d.count, date: formatDay(d.firstDue, { dateFormat: settings?.dateFormat }) }),
      promisedAmount: toDb(total),
      promisedDate: d.firstDue,
    });
    planId = plan.id;
    revalidatePath("/payment-plans");
    revalidatePath(`/arrears/${tenant.id}`);
  });
  if (!r.ok) return r;
  redirect(`/payment-plans/${planId}`);
}

function utcDayOf(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Re-applies CONFIRMED payments dated on/after the plan's creation day to the instalments, oldest first. */
export async function refreshPlanAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(paymentPlanMessages);
  const id = String(fd.get("id") ?? "");
  const r = await runAction(async () => {
    const ctx = await authorize("arrears.manage");
    const plan = await loadScopedPlan(ctx, idField.parse(id));
    if (!plan) throw new BusinessError(t("pp.err.notFound"));
    if (plan.status !== "ACTIVE") throw new BusinessError(t("pp.err.notActive"));
    const payments = await db.payment.findMany({
      where: { organizationId: ctx.organizationId, tenantId: plan.tenantId, status: "CONFIRMED", paymentDate: { gte: utcDayOf(plan.createdAt) } },
      select: { amount: true },
    });
    const paidTotal = sum(payments.map((p) => p.amount));
    const applied = applyPaymentsToInstallments(plan.installments, paidTotal, todayUtc());
    const complete = applied.length > 0 && applied.every((a) => a.status === "PAID");
    await db.$transaction(async (tx) => {
      for (const a of applied) {
        const inst = plan.installments.find((i) => i.sequence === a.sequence)!;
        if (money(inst.paidAmount).eq(a.paidAmount) && inst.status === a.status) continue;
        await tx.paymentPlanInstallment.update({ where: { id: inst.id }, data: { paidAmount: toDb(a.paidAmount), status: a.status } });
      }
      if (complete) await tx.paymentPlan.update({ where: { id: plan.id }, data: { status: "COMPLETED" } });
      await audit(ctx, {
        action: complete ? "payment_plan.completed" : "payment_plan.refreshed",
        module: "arrears",
        entityType: "PaymentPlan",
        entityId: plan.id,
        before: { status: plan.status, installments: plan.installments.map((i) => ({ sequence: i.sequence, paidAmount: i.paidAmount, status: i.status })) },
        after: { status: complete ? "COMPLETED" : plan.status, paidTotal: toDb(paidTotal), installments: applied.map((a) => ({ sequence: a.sequence, paidAmount: toDb(a.paidAmount), status: a.status })) },
      }, tx);
    });
    revalidatePath(`/payment-plans/${plan.id}`);
    revalidatePath("/payment-plans");
    revalidatePath(`/arrears/${plan.tenantId}`);
  });
  return r.ok ? { ...r, message: t("pp.refreshed") } : r;
}

const closeSchema = z.object({ id: idField, status: z.enum(CLOSE_STATUSES), reason: z.string().trim().max(2000).default("") });

export async function closePlanAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(paymentPlanMessages);
  const r = await runAction(async () => {
    const ctx = await authorize("arrears.manage");
    const d = closeSchema.parse(formToObject(fd));
    if (d.reason.length < 5) throw new BusinessError(t("pp.err.reason"));
    const plan = await loadScopedPlan(ctx, d.id);
    if (!plan) throw new BusinessError(t("pp.err.notFound"));
    if (plan.status !== "ACTIVE") throw new BusinessError(t("pp.err.notActive"));
    const notes = `${plan.notes ? `${plan.notes}\n` : ""}[${d.status}] ${d.reason}`;
    await db.$transaction(async (tx) => {
      const res = await tx.paymentPlan.updateMany({ where: { id: plan.id, status: "ACTIVE" }, data: { status: d.status, notes } });
      if (res.count !== 1) throw new BusinessError(t("pp.err.notActive"));
      await audit(ctx, {
        action: `payment_plan.${d.status.toLowerCase()}`,
        module: "arrears",
        entityType: "PaymentPlan",
        entityId: plan.id,
        before: { status: "ACTIVE" },
        after: { status: d.status },
        metadata: { reason: d.reason },
      }, tx);
    });
    await addCollectionNote(ctx, { tenantId: plan.tenantId, kind: "NOTE", note: t("pp.closedNote", { status: t(`pp.status.${d.status}`), reason: d.reason }) });
    revalidatePath(`/payment-plans/${plan.id}`);
    revalidatePath("/payment-plans");
    revalidatePath(`/arrears/${plan.tenantId}`);
  });
  return r.ok ? { ...r, message: t("pp.closed") } : r;
}
