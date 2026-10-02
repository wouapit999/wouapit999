"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, byPropertyWhere, type AuthContext } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { money, toDb } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { getOrgSettings } from "@/lib/settings";
import { getT } from "@/i18n";
import { resolveLocation } from "@/services/maintenance";
import { PO_TRANSITIONS, type PoStatus } from "./constants";
import { purchaseOrderMessages } from "./messages";

const optUuid = z.union([z.literal(""), z.string().uuid()]).optional().transform((v) => v || null);

const poSchema = z.object({
  propertyId: optUuid,
  vendorId: optUuid,
  description: z.string().trim().min(2).max(500),
  justification: z.string().trim().max(2000).default(""),
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Invalid amount").refine((v) => money(v).gt(0), "Must be positive"),
});

export async function createPurchaseOrderAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let poId = "";
  const r = await runAction(async () => {
    const ctx = await authorize("expense.create");
    const d = poSchema.parse(formToObject(fd));
    if (d.propertyId) await resolveLocation(ctx, d.propertyId);
    else if (ctx.propertyIds !== "ALL") throw new BusinessError("Choose a building.");
    if (d.vendorId) {
      const v = await db.vendor.findFirst({ where: { id: d.vendorId, organizationId: ctx.organizationId }, select: { id: true } });
      if (!v) throw new BusinessError("Vendor not found.");
    }
    await db.$transaction(async (tx) => {
      const number = await nextNumber(ctx.organizationId, "PURCHASE_ORDER", tx);
      const po = await tx.purchaseOrder.create({
        data: {
          organizationId: ctx.organizationId,
          number,
          propertyId: d.propertyId,
          vendorId: d.vendorId,
          description: d.description,
          justification: d.justification,
          amount: toDb(d.amount),
          status: "REQUESTED",
          requestedById: ctx.user.id,
        },
      });
      poId = po.id;
      await audit(ctx, { action: "purchase_order.created", module: "expenses", entityType: "PurchaseOrder", entityId: po.id, propertyId: d.propertyId, after: { number, ...d } }, tx);
    });
  });
  if (!r.ok) return r;
  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${poId}`);
}

async function loadPurchaseOrder(ctx: AuthContext, id: string) {
  const po = await db.purchaseOrder.findFirst({ where: { ...byPropertyWhere(ctx), id } });
  if (!po) throw new BusinessError((await getT(purchaseOrderMessages)).t("po.notFound"));
  return po;
}

async function transition(fd: FormData, to: PoStatus, t: (k: string, v?: Record<string, string | number>) => string) {
  const ctx = await authorize("expense.approve");
  const id = z.string().uuid().parse(fd.get("id"));
  const po = await loadPurchaseOrder(ctx, id);
  const from = po.status as PoStatus;
  if (!PO_TRANSITIONS[from]?.includes(to)) throw new BusinessError(t("po.badTransition", { status: t(`po.status.${po.status}`).toLowerCase() }));
  if (to === "APPROVED" && po.requestedById === ctx.user.id) {
    const settings = await getOrgSettings(ctx.organizationId);
    if (money(po.amount).gte(money(settings?.expenseApprovalThreshold ?? 0))) {
      await audit(ctx, { action: "purchase_order.approval_denied", module: "expenses", entityType: "PurchaseOrder", entityId: id, propertyId: po.propertyId, result: "DENIED", metadata: { reason: "self_approval_above_threshold" } });
      throw new BusinessError(t("po.selfApproval"));
    }
  }
  const updated = await db.purchaseOrder.updateMany({
    where: { id, status: from },
    data: { status: to, ...(to === "APPROVED" || to === "REJECTED" ? { approvedById: ctx.user.id } : {}) },
  });
  if (updated.count !== 1) throw new BusinessError(t("po.concurrent"));
  await audit(ctx, { action: `purchase_order.${to.toLowerCase()}`, module: "expenses", entityType: "PurchaseOrder", entityId: id, propertyId: po.propertyId, before: { status: from }, after: { status: to } });
  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${id}`);
}

async function run(fd: FormData, to: PoStatus, msgKey: string): Promise<ActionResult> {
  const { t } = await getT(purchaseOrderMessages);
  const r = await runAction(() => transition(fd, to, t));
  return r.ok ? { ...r, message: t(msgKey) } : r;
}

export async function approvePurchaseOrderAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(fd, "APPROVED", "po.approved");
}
export async function rejectPurchaseOrderAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(fd, "REJECTED", "po.rejected");
}
export async function orderPurchaseOrderAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(fd, "ORDERED", "po.ordered");
}
export async function receivePurchaseOrderAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(fd, "RECEIVED", "po.received");
}
export async function cancelPurchaseOrderAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(fd, "CANCELLED", "po.cancelled");
}
