"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, invoiceWhere, leaseWhere, paymentWhere, tenantWhere, type AuthContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { storeDocument } from "@/lib/storage";
import { getT } from "@/i18n";
import { approvePayment, recordPayment, rejectPayment, reversePayment } from "@/services/billing";
import { OPEN_INVOICE_STATUSES, PAYMENT_METHODS, parseDay } from "@/services/finance-extra";
import { financeMessages, translateResult } from "../invoices/messages";
import { paymentMessages } from "./messages";

const amountStr = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const paymentSchema = z.object({
  tenantId: z.string().uuid(),
  leaseId: z.union([z.literal(""), z.string().uuid()]),
  amount: amountStr,
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(PAYMENT_METHODS),
  externalRef: z.string().trim().max(120),
  receivingAccount: z.string().trim().max(120),
  notes: z.string().trim().max(2000),
  allocMode: z.enum(["auto", "manual"]),
});

async function tr<R>(r: ActionResult<R>) {
  const { t } = await getT(financeMessages, paymentMessages);
  return translateResult(r, t);
}

async function loadScopedPayment(ctx: AuthContext, id: string) {
  const p = await db.payment.findFirst({ where: { AND: [paymentWhere(ctx), { id }] }, select: { id: true } });
  if (!p) throw new BusinessError("Payment not found.");
  return p;
}

export async function recordPaymentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  let pending = false;
  const r = await runAction(async () => {
    const ctx = await authorize("payment.record");
    const s = (k: string) => String(fd.get(k) ?? "");
    const data = paymentSchema.parse({
      tenantId: s("tenantId"),
      leaseId: s("leaseId"),
      amount: s("amount"),
      paymentDate: s("paymentDate"),
      method: s("method"),
      externalRef: s("externalRef"),
      receivingAccount: s("receivingAccount"),
      notes: s("notes"),
      allocMode: s("allocMode") || "auto",
    });
    const tenant = await db.tenant.findFirst({ where: { AND: [tenantWhere(ctx), { id: data.tenantId }] }, select: { id: true } });
    if (!tenant) throw new BusinessError("Tenant not found.");
    if (!data.leaseId && ctx.propertyIds !== "ALL") throw new BusinessError("fin.leaseRequiredScoped");
    if (data.leaseId) {
      const lease = await db.lease.findFirst({ where: { AND: [leaseWhere(ctx), { id: data.leaseId, tenantId: tenant.id }] }, select: { id: true } });
      if (!lease) throw new BusinessError("Lease not found.");
    }
    const paymentDate = parseDay(data.paymentDate);
    if (!paymentDate) throw new BusinessError("Please correct the highlighted fields.");

    let allocations: { invoiceId: string; amount: string }[] | undefined;
    if (data.allocMode === "manual") {
      allocations = [];
      for (const [k, v] of fd.entries()) {
        if (!k.startsWith("alloc_") || typeof v !== "string" || !v.trim()) continue;
        const invoiceId = k.slice("alloc_".length);
        if (!UUID_RE.test(invoiceId)) continue;
        const amount = amountStr.parse(v);
        if (Number(amount) === 0) continue;
        allocations.push({ invoiceId, amount });
      }
      if (allocations.length === 0) throw new BusinessError("Enter at least one allocation amount, or choose automatic allocation.");
      const ok = await db.invoice.count({
        where: { AND: [invoiceWhere(ctx), { id: { in: allocations.map((a) => a.invoiceId) }, tenantId: tenant.id, status: { in: [...OPEN_INVOICE_STATUSES] } }] },
      });
      if (ok !== new Set(allocations.map((a) => a.invoiceId)).size) throw new BusinessError("Invoice not found for this tenant.");
    }

    let proofDocumentId: string | null = null;
    const proof = fd.get("proof");
    if (proof instanceof File && proof.size > 0) {
      const doc = await storeDocument(ctx, { file: proof, category: "PAYMENT_PROOF", tenantId: tenant.id, leaseId: data.leaseId || null });
      proofDocumentId = doc.id;
    }

    const res = await recordPayment(ctx, {
      tenantId: tenant.id,
      leaseId: data.leaseId || null,
      amount: data.amount,
      paymentDate,
      method: data.method,
      externalRef: data.externalRef || null,
      receivingAccount: data.receivingAccount,
      notes: data.notes,
      proofDocumentId,
      allocations,
      confirmNow: true,
    });
    id = res.payment.id;
    pending = res.pendingApproval;
  });
  if (!r.ok) return tr(r);
  revalidatePath("/payments");
  revalidatePath("/invoices");
  redirect(`/payments/${id}?recorded=${pending ? "pending" : "confirmed"}`);
}

export async function approvePaymentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("payment.approve");
    const p = await loadScopedPayment(ctx, z.string().uuid().parse(fd.get("id")));
    await approvePayment(ctx, p.id);
    revalidatePath(`/payments/${p.id}`);
  });
  return tr(r.ok ? { ...r, message: "pay.approved" } : r);
}

export async function rejectPaymentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("payment.approve");
    const p = await loadScopedPayment(ctx, z.string().uuid().parse(fd.get("id")));
    await rejectPayment(ctx, p.id, z.string().trim().min(3).max(500).parse(fd.get("reason")));
    revalidatePath(`/payments/${p.id}`);
  });
  return tr(r.ok ? { ...r, message: "pay.rejected" } : r);
}

export async function reversePaymentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("payment.reverse");
    const p = await loadScopedPayment(ctx, z.string().uuid().parse(fd.get("id")));
    await reversePayment(ctx, p.id, z.string().trim().min(5).max(500).parse(fd.get("reason")));
    revalidatePath(`/payments/${p.id}`);
    revalidatePath("/invoices");
  });
  return tr(r.ok ? { ...r, message: "pay.reversed" } : r);
}
