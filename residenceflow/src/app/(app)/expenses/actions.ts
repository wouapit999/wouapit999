"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, byPropertyWhere, maintenanceWhere, type AuthContext } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { money, toDb } from "@/lib/money";
import { storeDocument } from "@/lib/storage";
import { getOrgSettings } from "@/lib/settings";
import { getT } from "@/i18n";
import { resolveLocation } from "@/services/maintenance";
import { EXPENSE_CATEGORIES, expenseDocPrefix } from "./constants";
import { expenseMessages } from "./messages";

const optUuid = z.union([z.literal(""), z.string().uuid()]).optional().transform((v) => v || null);

const expenseSchema = z.object({
  propertyId: optUuid,
  unitId: optUuid,
  vendorId: optUuid,
  workOrderId: optUuid,
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().min(2).max(500),
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Invalid amount").refine((v) => money(v).gt(0), "Must be positive"),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billReference: z.string().trim().max(120).default(""),
});

export async function createExpenseAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("expense.create");
    const d = expenseSchema.parse(formToObject(fd));
    let propertyId = d.propertyId;
    let unitId = d.unitId;
    // Work order: re-load inside the user's scope; it dictates the building.
    if (d.workOrderId) {
      const wo = await db.maintenanceRequest.findFirst({ where: { AND: [maintenanceWhere(ctx), byPropertyWhere(ctx)], id: d.workOrderId }, select: { propertyId: true, unitId: true } });
      if (!wo) throw new BusinessError("Work order not found.");
      if (propertyId && propertyId !== wo.propertyId) throw new BusinessError("The work order belongs to another building.");
      propertyId = wo.propertyId;
      unitId = unitId ?? wo.unitId;
    }
    if (propertyId) await resolveLocation(ctx, propertyId, unitId);
    else {
      if (ctx.propertyIds !== "ALL") throw new BusinessError("Choose a building.");
      unitId = null;
    }
    if (d.vendorId) {
      const v = await db.vendor.findFirst({ where: { id: d.vendorId, organizationId: ctx.organizationId }, select: { id: true } });
      if (!v) throw new BusinessError("Vendor not found.");
    }
    const file = fd.get("attachment");
    const settings = await getOrgSettings(ctx.organizationId);
    await db.$transaction(async (tx) => {
      const e = await tx.expense.create({
        data: {
          organizationId: ctx.organizationId,
          propertyId,
          unitId,
          vendorId: d.vendorId,
          workOrderId: d.workOrderId,
          category: d.category,
          description: d.description,
          amount: toDb(d.amount),
          currency: settings?.currency ?? "XAF",
          expenseDate: new Date(`${d.expenseDate}T00:00:00Z`),
          billReference: d.billReference,
          status: "PENDING_APPROVAL",
          createdById: ctx.user.id,
        },
      });
      if (file instanceof File && file.size > 0) {
        const base = (file.name || "attachment").replace(/[\\/]/g, "_").slice(0, 120);
        await storeDocument(ctx, { file, name: `${expenseDocPrefix(e.id)}${base}`, category: "OTHER", propertyId, workOrderId: d.workOrderId }, tx);
      }
      await audit(ctx, { action: "expense.created", module: "expenses", entityType: "Expense", entityId: e.id, propertyId, after: { ...d, propertyId, unitId, status: e.status } }, tx);
    });
  });
  if (!r.ok) return r;
  revalidatePath("/expenses");
  redirect("/expenses");
}

async function loadExpense(ctx: AuthContext, id: string) {
  const e = await db.expense.findFirst({ where: { ...byPropertyWhere(ctx), id } });
  if (!e) throw new BusinessError("Expense not found.");
  return e;
}

async function transition(fd: FormData, to: "APPROVED" | "REJECTED" | "PAID") {
  const ctx = await authorize("expense.approve");
  const id = z.string().uuid().parse(fd.get("id"));
  const e = await loadExpense(ctx, id);
  const allowedFrom = to === "PAID" ? ["APPROVED"] : ["PENDING_APPROVAL"];
  if (!allowedFrom.includes(e.status)) throw new BusinessError(`This expense is ${e.status.toLowerCase().replace(/_/g, " ")}.`);
  if (to === "APPROVED" && e.createdById === ctx.user.id) {
    const settings = await getOrgSettings(ctx.organizationId);
    if (money(e.amount).gte(money(settings?.expenseApprovalThreshold ?? 0))) {
      await audit(ctx, { action: "expense.approval_denied", module: "expenses", entityType: "Expense", entityId: id, propertyId: e.propertyId, result: "DENIED", metadata: { reason: "self_approval_above_threshold" } });
      throw new BusinessError("You cannot approve an expense you recorded yourself at or above the approval threshold. Another approver must approve it.");
    }
  }
  const updated = await db.expense.updateMany({
    where: { id, status: { in: allowedFrom } },
    data: { status: to, ...(to === "APPROVED" || to === "REJECTED" ? { approvedById: ctx.user.id } : {}) },
  });
  if (updated.count !== 1) throw new BusinessError("The expense was changed by someone else. Reload the page.");
  await audit(ctx, { action: `expense.${to.toLowerCase()}`, module: "expenses", entityType: "Expense", entityId: id, propertyId: e.propertyId, before: { status: e.status }, after: { status: to } });
  revalidatePath("/expenses");
}

export async function approveExpenseAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(() => transition(fd, "APPROVED"));
  return r.ok ? { ...r, message: (await getT(expenseMessages)).t("exp.approved") } : r;
}

export async function rejectExpenseAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(() => transition(fd, "REJECTED"));
  return r.ok ? { ...r, message: (await getT(expenseMessages)).t("exp.rejected") } : r;
}

export async function markExpensePaidAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(() => transition(fd, "PAID"));
  return r.ok ? { ...r, message: (await getT(expenseMessages)).t("exp.paid") } : r;
}
