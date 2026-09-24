import "server-only";
import type { DepositTransaction } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { BusinessError } from "@/lib/errors";
import { money, round2, sum, toDb, type Decimal } from "@/lib/money";
import { storeDocument } from "@/lib/storage";
import type { AuthContext } from "@/lib/auth/context";

export const DEPOSIT_TX_TYPES = ["RECEIPT", "DEDUCTION", "REFUND"] as const;
export type DepositTxType = (typeof DEPOSIT_TX_TYPES)[number];

/** Evidence documents are linked by name prefix (DepositTransaction has no document column). */
export function depositEvidencePrefix(transactionId: string) {
  return `deposit-evidence-${transactionId}-`;
}

type TxLike = Pick<DepositTransaction, "type" | "amount" | "status">;

export interface DepositTotals {
  received: Decimal;
  deducted: Decimal;
  refunded: Decimal;
  held: Decimal;
  pendingOut: Decimal;
  pendingIn: Decimal;
}

/** Held balance = approved receipts − approved deductions − approved refunds. */
export function depositTotals(transactions: TxLike[]): DepositTotals {
  const of = (type: string, status: string) => sum(transactions.filter((t) => t.type === type && t.status === status).map((t) => t.amount));
  const received = of("RECEIPT", "APPROVED");
  const deducted = of("DEDUCTION", "APPROVED");
  const refunded = of("REFUND", "APPROVED");
  return {
    received,
    deducted,
    refunded,
    held: received.minus(deducted).minus(refunded),
    pendingOut: of("DEDUCTION", "PENDING_APPROVAL").plus(of("REFUND", "PENDING_APPROVAL")),
    pendingIn: of("RECEIPT", "PENDING_APPROVAL"),
  };
}

export function deriveDepositStatus(t: DepositTotals): string {
  if (t.received.lte(0)) return "PENDING";
  if (t.refunded.gt(0)) return t.held.lte(0) ? "REFUNDED" : "PARTIALLY_REFUNDED";
  if (t.held.lte(0) && t.deducted.gt(0)) return "FORFEITED";
  return "HELD";
}

async function lockDeposit(tx: Tx, ctx: AuthContext, depositId: string) {
  await tx.$queryRaw`SELECT id FROM "SecurityDeposit" WHERE id = ${depositId} FOR UPDATE`;
  const deposit = await tx.securityDeposit.findFirst({
    where: { id: depositId, organizationId: ctx.organizationId },
    include: { transactions: true, lease: { select: { id: true, tenantId: true, unit: { select: { propertyId: true } } } } },
  });
  if (!deposit) throw new BusinessError("Deposit not found.");
  if (ctx.propertyIds !== "ALL" && !ctx.propertyIds.includes(deposit.lease.unit.propertyId)) throw new BusinessError("Deposit not found.");
  return deposit;
}

async function refreshStatus(tx: Tx, depositId: string) {
  const transactions = await tx.depositTransaction.findMany({ where: { depositId } });
  const status = deriveDepositStatus(depositTotals(transactions));
  await tx.securityDeposit.update({ where: { id: depositId }, data: { status } });
  return status;
}

export interface DepositTxInput {
  depositId: string;
  type: DepositTxType;
  amount: string;
  description?: string;
  method?: string | null;
  heldIn?: string | null;
  evidence?: File | null;
}

/**
 * Records a deposit receipt, deduction or refund. The deposit row is locked (FOR UPDATE) so
 * concurrent out-flows can never exceed what was received. Amounts above the organization's
 * approval threshold stay PENDING_APPROVAL until a different user with deposit.approve approves.
 */
export async function recordDepositTransaction(ctx: AuthContext, input: DepositTxInput) {
  const amount = round2(input.amount);
  if (amount.lte(0)) throw new BusinessError("Amount must be positive.");
  if (input.type === "DEDUCTION" && !input.description?.trim()) throw new BusinessError("A description is required for deductions.");
  const settings = await db.organizationSettings.findUnique({ where: { organizationId: ctx.organizationId } });
  const needsApproval = settings ? amount.gt(money(settings.expenseApprovalThreshold)) : false;

  return db.$transaction(async (tx) => {
    const deposit = await lockDeposit(tx, ctx, input.depositId);
    if (input.type !== "RECEIPT") {
      const totals = depositTotals(deposit.transactions);
      // Pending out-flows count against the balance so approvals can never overdraw it.
      const available = totals.held.minus(totals.pendingOut);
      if (amount.gt(available)) throw new BusinessError("Deductions and refunds cannot exceed the amount received.");
    }
    const created = await tx.depositTransaction.create({
      data: {
        depositId: deposit.id,
        type: input.type,
        amount: toDb(amount),
        description: input.description?.trim() ?? "",
        method: input.type === "DEDUCTION" ? null : input.method ?? null,
        status: needsApproval ? "PENDING_APPROVAL" : "APPROVED",
        createdById: ctx.user.id,
      },
    });
    if (input.heldIn && input.type === "RECEIPT") {
      await tx.securityDeposit.update({ where: { id: deposit.id }, data: { heldIn: input.heldIn.slice(0, 200) } });
    }
    let documentId: string | null = null;
    if (input.evidence && input.evidence.size > 0) {
      const doc = await storeDocument(ctx, {
        file: input.evidence,
        category: "LEASE",
        name: `${depositEvidencePrefix(created.id)}${input.evidence.name}`.slice(0, 200),
        leaseId: deposit.lease.id,
        tenantId: deposit.lease.tenantId,
      }, tx);
      documentId = doc.id;
    }
    const status = await refreshStatus(tx, deposit.id);
    await audit(ctx, {
      action: `deposit.${input.type.toLowerCase()}_recorded`,
      module: "deposits",
      entityType: "DepositTransaction",
      entityId: created.id,
      propertyId: deposit.lease.unit.propertyId,
      after: { depositId: deposit.id, type: input.type, amount: amount.toFixed(2), status: created.status, method: created.method, documentId, depositStatus: status },
    }, tx);
    return { transaction: created, pendingApproval: needsApproval };
  }, { timeout: 20_000 });
}

/** Approves or rejects a pending deposit transaction (four-eyes: never the creator). */
export async function decideDepositTransaction(ctx: AuthContext, transactionId: string, approve: boolean, reason?: string) {
  return db.$transaction(async (tx) => {
    const txn = await tx.depositTransaction.findUnique({ where: { id: transactionId }, select: { depositId: true } });
    if (!txn) throw new BusinessError("Transaction not found.");
    const deposit = await lockDeposit(tx, ctx, txn.depositId);
    const current = deposit.transactions.find((t) => t.id === transactionId)!;
    if (current.status !== "PENDING_APPROVAL") throw new BusinessError("Only pending transactions can be approved or rejected.");
    if (current.createdById === ctx.user.id) throw new BusinessError("Separation of duties: the person who recorded this transaction cannot approve it.");
    if (approve && current.type !== "RECEIPT") {
      const others = deposit.transactions.filter((t) => t.id !== transactionId);
      const totals = depositTotals(others);
      if (money(current.amount).gt(totals.held)) throw new BusinessError("Deductions and refunds cannot exceed the amount received.");
    }
    if (!approve && (!reason || reason.trim().length < 3)) throw new BusinessError("A reason is required.");
    const updated = await tx.depositTransaction.update({
      where: { id: transactionId },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        approvedById: ctx.user.id,
        ...(approve ? {} : { description: `${current.description}${current.description ? " — " : ""}Rejected: ${reason!.trim()}`.slice(0, 1000) }),
      },
    });
    const status = await refreshStatus(tx, deposit.id);
    await audit(ctx, {
      action: approve ? "deposit.transaction_approved" : "deposit.transaction_rejected",
      module: "deposits",
      entityType: "DepositTransaction",
      entityId: transactionId,
      propertyId: deposit.lease.unit.propertyId,
      before: { status: current.status },
      after: { status: updated.status, depositStatus: status },
      metadata: reason ? { reason } : undefined,
    }, tx);
    return updated;
  }, { timeout: 20_000 });
}
