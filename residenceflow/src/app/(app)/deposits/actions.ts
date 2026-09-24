"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, leaseWhere, type AuthContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { getT } from "@/i18n";
import { DEPOSIT_TX_TYPES, decideDepositTransaction, recordDepositTransaction } from "@/services/deposits";
import { PAYMENT_METHODS } from "@/services/finance-extra";
import { financeMessages, translateResult } from "../invoices/messages";
import { depositMessages } from "./messages";

const txSchema = z.object({
  depositId: z.string().uuid(),
  type: z.enum(DEPOSIT_TX_TYPES),
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/),
  description: z.string().trim().max(1000),
  method: z.union([z.literal(""), z.enum(PAYMENT_METHODS)]),
  heldIn: z.string().trim().max(200),
});

async function tr<R>(r: ActionResult<R>) {
  const { t } = await getT(financeMessages, depositMessages);
  return translateResult(r, t);
}

async function loadScopedDeposit(ctx: AuthContext, id: string) {
  const d = await db.securityDeposit.findFirst({ where: { id, organizationId: ctx.organizationId, lease: leaseWhere(ctx) }, select: { id: true } });
  if (!d) throw new BusinessError("Deposit not found.");
  return d;
}

export async function recordDepositTxAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let pending = false;
  const r = await runAction(async () => {
    const ctx = await authorize("deposit.manage");
    const s = (k: string) => String(fd.get(k) ?? "");
    const data = txSchema.parse({
      depositId: s("depositId"),
      type: s("type"),
      amount: s("amount"),
      description: s("description"),
      method: s("method"),
      heldIn: s("heldIn"),
    });
    if (data.type !== "DEDUCTION" && !data.method) throw new BusinessError("Please correct the highlighted fields.");
    const deposit = await loadScopedDeposit(ctx, data.depositId);
    const evidence = fd.get("evidence");
    const res = await recordDepositTransaction(ctx, {
      depositId: deposit.id,
      type: data.type,
      amount: data.amount,
      description: data.description,
      method: data.method || null,
      heldIn: data.heldIn || null,
      evidence: data.type === "DEDUCTION" && evidence instanceof File && evidence.size > 0 ? evidence : null,
    });
    pending = res.pendingApproval;
    revalidatePath(`/deposits/${deposit.id}`);
    revalidatePath("/deposits");
  });
  return tr(r.ok ? { ...r, message: pending ? "dep.recordedPending" : "dep.recorded" } : r);
}

export async function approveDepositTxAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return decide(fd, true);
}

export async function rejectDepositTxAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return decide(fd, false);
}

async function decide(fd: FormData, approve: boolean): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("deposit.approve");
    const depositId = z.string().uuid().parse(fd.get("depositId"));
    const transactionId = z.string().uuid().parse(fd.get("transactionId"));
    const deposit = await loadScopedDeposit(ctx, depositId);
    const txn = await db.depositTransaction.findFirst({ where: { id: transactionId, depositId: deposit.id }, select: { id: true } });
    if (!txn) throw new BusinessError("Transaction not found.");
    const reason = approve ? undefined : z.string().trim().min(3).max(500).parse(fd.get("reason"));
    await decideDepositTransaction(ctx, txn.id, approve, reason);
    revalidatePath(`/deposits/${deposit.id}`);
    revalidatePath("/deposits");
  });
  return tr(r.ok ? { ...r, message: approve ? "dep.approved" : "dep.rejected" } : r);
}
