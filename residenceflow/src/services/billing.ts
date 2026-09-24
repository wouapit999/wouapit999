import "server-only";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { money, round2, sum, toDb } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { BusinessError } from "@/lib/action";
import type { AuthContext } from "@/lib/auth/context";
import { allocatePayment, deriveInvoiceStatus, validateManualAllocation } from "@/domain/allocation";
import { generateSchedule, toUtcDay, type Frequency } from "@/domain/schedule";
import { computeLateFee } from "@/domain/late-fee";
import { randomToken } from "@/lib/auth/crypto";
import { notifyUsers, tenantUserIds } from "@/lib/notify/notify";

type Actor = Pick<AuthContext, "organizationId" | "user">;

// Read-committed + explicit SELECT ... FOR UPDATE row locks on invoices/payments.
const SERIALIZABLE = { timeout: 20_000 } as const;

export function todayUtc() {
  return toUtcDay(new Date());
}

/** Outstanding balance of an invoice (never negative). */
export function invoiceBalance(inv: { total: Prisma.Decimal | string; amountPaid: Prisma.Decimal | string; amountCredited: Prisma.Decimal | string }) {
  const b = money(inv.total).minus(money(inv.amountPaid)).minus(money(inv.amountCredited));
  return b.isNegative() ? money(0) : b;
}

/** Locks invoice rows (SELECT ... FOR UPDATE) so concurrent payments cannot over-allocate. */
async function lockInvoices(tx: Tx, ids: string[]) {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
}

async function refreshInvoiceStatus(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (["DRAFT", "VOID"].includes(inv.status)) return inv;
  const outstanding = invoiceBalance(inv);
  const status =
    money(inv.amountCredited).gt(0) && outstanding.lte(0) && money(inv.amountPaid).lte(0)
      ? "CREDITED"
      : deriveInvoiceStatus(inv.total, inv.amountPaid, inv.amountCredited, inv.dueDate, todayUtc());
  if (status !== inv.status) return tx.invoice.update({ where: { id: invoiceId }, data: { status } });
  return inv;
}

// ───────────────────────── Rent schedules ─────────────────────────

/**
 * Creates the charge schedule for an active lease. Idempotent: the unique
 * (leaseId, chargeType, periodStart) constraint means re-running never duplicates periods.
 */
export async function generateLeaseSchedule(tx: Tx, leaseId: string) {
  const lease = await tx.lease.findUniqueOrThrow({ where: { id: leaseId } });
  const base = {
    startDate: lease.startDate,
    endDate: lease.endDate,
    frequency: lease.frequency as Frequency,
    dueDay: lease.dueDay,
    prorate: lease.prorate,
  };
  const charges: { type: string; amount: Prisma.Decimal }[] = [{ type: "RENT", amount: lease.rentAmount }];
  if (money(lease.serviceCharge).gt(0)) charges.push({ type: "SERVICE_CHARGE", amount: lease.serviceCharge });
  let created = 0;
  for (const c of charges) {
    const periods = generateSchedule({ ...base, amount: c.amount });
    const res = await tx.rentSchedule.createMany({
      data: periods.map((p) => ({
        organizationId: lease.organizationId,
        leaseId: lease.id,
        chargeType: c.type,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        dueDate: p.dueDate,
        amount: toDb(p.amount),
      })),
      skipDuplicates: true,
    });
    created += res.count;
  }
  return created;
}

// ───────────────────────── Invoices ─────────────────────────

export interface InvoiceLineInput {
  chargeType: string;
  description: string;
  quantity?: string | number;
  unitPrice: string | number;
}

export async function createInvoice(
  tx: Tx,
  actor: Actor | null,
  input: {
    organizationId: string;
    tenantId: string;
    leaseId?: string | null;
    issueDate: Date;
    dueDate: Date;
    lines: InvoiceLineInput[];
    notes?: string;
    issue?: boolean;
    idempotencyKey?: string;
    currency?: string;
    taxRatePercent?: string | number;
  },
) {
  if (input.lines.length === 0) throw new BusinessError("An invoice needs at least one line.");
  if (input.idempotencyKey) {
    const existing = await tx.invoice.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return { invoice: existing, created: false };
  }
  const lines = input.lines.map((l) => {
    const qty = money(l.quantity ?? 1);
    const unit = round2(l.unitPrice);
    if (qty.lte(0) || unit.lt(0)) throw new BusinessError("Invoice line amounts must be positive.");
    return { ...l, quantity: qty, unitPrice: unit, amount: round2(qty.mul(unit)) };
  });
  const subtotal = sum(lines.map((l) => l.amount));
  const tax = round2(subtotal.mul(money(input.taxRatePercent ?? 0)).div(100));
  const total = subtotal.plus(tax);
  const number = await nextNumber(input.organizationId, "INVOICE", tx);
  const invoice = await tx.invoice.create({
    data: {
      organizationId: input.organizationId,
      number,
      tenantId: input.tenantId,
      leaseId: input.leaseId ?? null,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      status: input.issue ? "ISSUED" : "DRAFT",
      issuedAt: input.issue ? new Date() : null,
      currency: input.currency ?? "XAF",
      subtotal: toDb(subtotal),
      taxAmount: toDb(tax),
      total: toDb(total),
      notes: input.notes ?? "",
      idempotencyKey: input.idempotencyKey,
      createdById: actor?.user.id,
      lines: {
        create: lines.map((l) => ({
          chargeType: l.chargeType,
          description: l.description,
          quantity: l.quantity.toFixed(2),
          unitPrice: toDb(l.unitPrice),
          amount: toDb(l.amount),
        })),
      },
    },
  });
  await audit(actor, {
    action: input.issue ? "invoice.issued" : "invoice.created",
    module: "billing",
    entityType: "Invoice",
    entityId: invoice.id,
    after: { number, total: total.toFixed(2), tenantId: input.tenantId },
  }, tx, input.organizationId);
  if (input.issue) {
    await notifyUsers({
      organizationId: input.organizationId,
      userIds: await tenantUserIds(input.tenantId, tx),
      event: "INVOICE_ISSUED",
      vars: { number, amount: `${total.toFixed(0)} ${invoice.currency}`, dueDate: input.dueDate.toISOString().slice(0, 10) },
      link: "/portal/billing",
    }, tx);
  }
  return { invoice, created: true };
}

export async function issueDraftInvoice(ctx: AuthContext, invoiceId: string) {
  return db.$transaction(async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId: ctx.organizationId } });
    if (!inv) throw new BusinessError("Invoice not found.");
    if (inv.status !== "DRAFT") throw new BusinessError("Only draft invoices can be issued.");
    const updated = await tx.invoice.update({ where: { id: inv.id }, data: { status: "ISSUED", issuedAt: new Date() } });
    await refreshInvoiceStatus(tx, inv.id);
    await audit(ctx, { action: "invoice.issued", module: "billing", entityType: "Invoice", entityId: inv.id, after: { number: inv.number } }, tx);
    await notifyUsers({
      organizationId: ctx.organizationId,
      userIds: await tenantUserIds(inv.tenantId, tx),
      event: "INVOICE_ISSUED",
      vars: { number: inv.number, amount: `${money(inv.total).toFixed(0)} ${inv.currency}`, dueDate: inv.dueDate.toISOString().slice(0, 10) },
      link: "/portal/billing",
    }, tx);
    return updated;
  });
}

/** Issued invoices are immutable: they can only be voided (if unpaid) or credited. */
export async function voidInvoice(ctx: AuthContext, invoiceId: string, reason: string) {
  if (reason.trim().length < 3) throw new BusinessError("A reason is required.");
  return db.$transaction(async (tx) => {
    await lockInvoices(tx, [invoiceId]);
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId: ctx.organizationId } });
    if (!inv) throw new BusinessError("Invoice not found.");
    if (inv.status === "VOID") throw new BusinessError("Invoice is already void.");
    const liveAlloc = await tx.paymentAllocation.count({ where: { invoiceId, reversed: false } });
    if (liveAlloc > 0 || money(inv.amountPaid).gt(0)) throw new BusinessError("Reverse the payments allocated to this invoice before voiding it, or issue a credit note.");
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "VOID", voidReason: reason } });
    await tx.rentSchedule.updateMany({ where: { invoiceId }, data: { invoiceId: null } });
    await audit(ctx, { action: "invoice.voided", module: "billing", entityType: "Invoice", entityId: invoiceId, before: { status: inv.status }, metadata: { reason } }, tx);
  }, SERIALIZABLE);
}

export async function creditInvoice(ctx: AuthContext, invoiceId: string, amountInput: string, reason: string) {
  if (reason.trim().length < 3) throw new BusinessError("A reason is required.");
  const amount = round2(amountInput);
  if (amount.lte(0)) throw new BusinessError("Credit amount must be positive.");
  return db.$transaction(async (tx) => {
    await lockInvoices(tx, [invoiceId]);
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId: ctx.organizationId } });
    if (!inv || ["DRAFT", "VOID"].includes(inv.status)) throw new BusinessError("Only issued invoices can be credited.");
    if (amount.gt(invoiceBalance(inv))) throw new BusinessError("Credit exceeds the outstanding balance.");
    const number = await nextNumber(ctx.organizationId, "CREDIT_NOTE", tx);
    await tx.creditNote.create({ data: { invoiceId, number, amount: toDb(amount), reason, createdById: ctx.user.id } });
    await tx.invoice.update({ where: { id: invoiceId }, data: { amountCredited: toDb(money(inv.amountCredited).plus(amount)) } });
    await refreshInvoiceStatus(tx, invoiceId);
    await audit(ctx, { action: "invoice.credited", module: "billing", entityType: "Invoice", entityId: invoiceId, metadata: { number, amount: amount.toFixed(2), reason } }, tx);
  }, SERIALIZABLE);
}

// ───────────────────────── Payments ─────────────────────────

export interface RecordPaymentInput {
  tenantId: string;
  leaseId?: string | null;
  amount: string;
  paymentDate: Date;
  method: string;
  externalRef?: string | null;
  receivingAccount?: string;
  notes?: string;
  proofDocumentId?: string | null;
  /** Manual allocation; when omitted, allocates oldest invoice first. */
  allocations?: { invoiceId: string; amount: string }[];
  /** Tenant-submitted proof or high-value payments stay PENDING until approved. */
  confirmNow: boolean;
  submittedByTenant?: boolean;
}

/**
 * Records a payment. Confirmed payments are allocated and receipted inside one serializable
 * transaction with invoice rows locked, so balances can never be over-allocated.
 */
export async function recordPayment(ctx: AuthContext, input: RecordPaymentInput) {
  const amount = round2(input.amount);
  if (amount.lte(0)) throw new BusinessError("Payment amount must be positive.");
  const settings = await db.organizationSettings.findUnique({ where: { organizationId: ctx.organizationId } });
  if (settings && !settings.enabledPaymentMethods.includes(input.method)) throw new BusinessError("This payment method is not enabled.");
  const tenant = await db.tenant.findFirst({ where: { id: input.tenantId, organizationId: ctx.organizationId } });
  if (!tenant) throw new BusinessError("Tenant not found.");

  // Separation of duties: high-value payments recorded by staff need a second person to approve.
  const highValue = settings ? amount.gte(money(settings.highValueThreshold)) : false;
  const confirmNow = input.confirmNow && !(settings?.separationOfDuties && highValue);

  return db.$transaction(async (tx) => {
    const reference = await nextNumber(ctx.organizationId, "PAYMENT", tx);
    const payment = await tx.payment.create({
      data: {
        organizationId: ctx.organizationId,
        reference,
        tenantId: tenant.id,
        leaseId: input.leaseId ?? null,
        amount: toDb(amount),
        currency: settings?.currency ?? "XAF",
        paymentDate: input.paymentDate,
        method: input.method,
        externalRef: input.externalRef || null,
        receivingAccount: input.receivingAccount ?? "",
        notes: input.notes ?? "",
        proofDocumentId: input.proofDocumentId ?? null,
        status: "PENDING",
        submittedByTenant: input.submittedByTenant ?? false,
        recordedById: ctx.user.id,
      },
    });
    await audit(ctx, {
      action: "payment.recorded", module: "billing", entityType: "Payment", entityId: payment.id,
      after: { reference, amount: amount.toFixed(2), method: input.method, pendingApproval: !confirmNow },
    }, tx);
    if (confirmNow) await confirmPaymentTx(tx, ctx, payment.id, input.allocations);
    return { payment, pendingApproval: !confirmNow, highValue };
  }, SERIALIZABLE);
}

async function confirmPaymentTx(tx: Tx, ctx: AuthContext, paymentId: string, manual?: { invoiceId: string; amount: string }[]) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.status !== "PENDING") throw new BusinessError("Only pending payments can be confirmed.");
  const open = await tx.invoice.findMany({
    where: {
      organizationId: payment.organizationId,
      tenantId: payment.tenantId,
      status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
    },
    orderBy: { dueDate: "asc" },
  });
  await lockInvoices(tx, open.map((i) => i.id));
  const fresh = await tx.invoice.findMany({ where: { id: { in: open.map((i) => i.id) } } });
  const balances = Object.fromEntries(fresh.map((i) => [i.id, invoiceBalance(i).toFixed(2)]));

  let lines: { invoiceId: string; amount: string }[];
  if (manual && manual.length > 0) {
    const err = validateManualAllocation(payment.amount, manual, balances);
    if (err) throw new BusinessError(err);
    lines = manual.map((m) => ({ invoiceId: m.invoiceId, amount: toDb(m.amount) }));
  } else {
    const r = allocatePayment(payment.amount, fresh.map((i) => ({ id: i.id, dueDate: i.dueDate, balance: balances[i.id] })));
    lines = r.lines.map((l) => ({ invoiceId: l.invoiceId, amount: toDb(l.amount) }));
  }

  for (const l of lines) {
    const inv = fresh.find((i) => i.id === l.invoiceId)!;
    await tx.paymentAllocation.create({ data: { paymentId, invoiceId: l.invoiceId, amount: l.amount } });
    const newPaid = money(inv.amountPaid).plus(money(l.amount));
    if (newPaid.plus(money(inv.amountCredited)).gt(money(inv.total))) throw new BusinessError("Allocation would exceed the invoice total.");
    await tx.invoice.update({ where: { id: inv.id }, data: { amountPaid: toDb(newPaid) } });
    await refreshInvoiceStatus(tx, inv.id);
  }

  await tx.payment.update({ where: { id: paymentId }, data: { status: "CONFIRMED", approvedById: ctx.user.id, approvedAt: new Date() } });

  // Immutable receipt with a snapshot of everything printed on it.
  const [settings, tenant, allocs, lease] = await Promise.all([
    tx.organizationSettings.findUnique({ where: { organizationId: payment.organizationId } }),
    tx.tenant.findUniqueOrThrow({ where: { id: payment.tenantId } }),
    tx.paymentAllocation.findMany({ where: { paymentId }, include: { invoice: true } }),
    payment.leaseId ? tx.lease.findUnique({ where: { id: payment.leaseId }, include: { unit: { include: { property: true } } } }) : null,
  ]);
  const recorder = payment.recordedById ? await tx.user.findUnique({ where: { id: payment.recordedById }, select: { name: true } }) : null;
  const receiptNumber = await nextNumber(payment.organizationId, "RECEIPT", tx);
  const allocated = sum(allocs.map((a) => a.amount));
  const receipt = await tx.receipt.create({
    data: {
      organizationId: payment.organizationId,
      number: receiptNumber,
      paymentId,
      verificationCode: randomToken(9),
      issuedById: ctx.user.id,
      snapshot: {
        organization: {
          appName: settings?.appName, companyName: settings?.companyName, address: settings?.address, phone: settings?.phone,
          email: settings?.email, taxId: settings?.taxId, logoUrl: settings?.logoUrl ?? null, receiptFooter: settings?.receiptFooter,
        },
        tenant: { reference: tenant.reference, name: tenant.legalName },
        unit: lease ? { property: lease.unit.property.name, number: lease.unit.number } : null,
        payment: {
          reference: payment.reference, amount: money(payment.amount).toFixed(2), currency: payment.currency,
          date: payment.paymentDate.toISOString().slice(0, 10), method: payment.method, externalRef: payment.externalRef,
        },
        allocations: allocs.map((a) => ({ invoice: a.invoice.number, amount: money(a.amount).toFixed(2) })),
        unapplied: money(payment.amount).minus(allocated).toFixed(2),
        collector: recorder?.name ?? null,
      },
    },
  });
  await audit(ctx, {
    action: "payment.confirmed", module: "billing", entityType: "Payment", entityId: paymentId,
    after: { receipt: receiptNumber, allocations: lines },
  }, tx);
  await notifyUsers({
    organizationId: payment.organizationId,
    userIds: await tenantUserIds(payment.tenantId, tx),
    event: "PAYMENT_RECEIVED",
    vars: { amount: `${money(payment.amount).toFixed(0)} ${payment.currency}`, receipt: receiptNumber },
    link: "/portal/receipts",
  }, tx);
  return receipt;
}

export async function approvePayment(ctx: AuthContext, paymentId: string) {
  const settings = await db.organizationSettings.findUnique({ where: { organizationId: ctx.organizationId } });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
    const p = await tx.payment.findFirst({ where: { id: paymentId, organizationId: ctx.organizationId } });
    if (!p) throw new BusinessError("Payment not found.");
    if (settings?.separationOfDuties && p.recordedById === ctx.user.id && !p.submittedByTenant) {
      throw new BusinessError("Separation of duties: the person who recorded this payment cannot approve it.");
    }
    return confirmPaymentTx(tx, ctx, paymentId);
  }, SERIALIZABLE);
}

export async function rejectPayment(ctx: AuthContext, paymentId: string, reason: string) {
  if (reason.trim().length < 3) throw new BusinessError("A reason is required.");
  return db.$transaction(async (tx) => {
    const p = await tx.payment.findFirst({ where: { id: paymentId, organizationId: ctx.organizationId } });
    if (!p || p.status !== "PENDING") throw new BusinessError("Only pending payments can be rejected.");
    await tx.payment.update({ where: { id: paymentId }, data: { status: "REJECTED", rejectionReason: reason } });
    await audit(ctx, { action: "payment.rejected", module: "billing", entityType: "Payment", entityId: paymentId, metadata: { reason } }, tx);
    await notifyUsers({
      organizationId: ctx.organizationId,
      userIds: await tenantUserIds(p.tenantId, tx),
      event: "PAYMENT_REJECTED",
      vars: { reference: p.reference },
      link: "/portal/payments",
    }, tx);
  });
}

/**
 * Reverses a confirmed payment: allocations are flagged reversed (never deleted), invoice
 * balances restored, and a PaymentReversal record created — all in one transaction.
 * The original receipt stays unchanged; its payment is shown as REVERSED.
 */
export async function reversePayment(ctx: AuthContext, paymentId: string, reason: string) {
  if (reason.trim().length < 5) throw new BusinessError("A reason (min. 5 characters) is required.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
    const p = await tx.payment.findFirst({ where: { id: paymentId, organizationId: ctx.organizationId }, include: { allocations: true } });
    if (!p) throw new BusinessError("Payment not found.");
    if (p.status !== "CONFIRMED") throw new BusinessError("Only confirmed payments can be reversed.");
    const live = p.allocations.filter((a) => !a.reversed);
    await lockInvoices(tx, live.map((a) => a.invoiceId));
    for (const a of live) {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
      const newPaid = money(inv.amountPaid).minus(money(a.amount));
      await tx.invoice.update({ where: { id: inv.id }, data: { amountPaid: toDb(newPaid.isNegative() ? 0 : newPaid) } });
      await tx.paymentAllocation.update({ where: { id: a.id }, data: { reversed: true } });
      await refreshInvoiceStatus(tx, inv.id);
    }
    await tx.paymentReversal.create({ data: { paymentId, reason, reversedById: ctx.user.id } });
    await tx.payment.update({ where: { id: paymentId }, data: { status: "REVERSED" } });
    await audit(ctx, {
      action: "payment.reversed", module: "billing", entityType: "Payment", entityId: paymentId,
      before: { status: "CONFIRMED", amount: money(p.amount).toFixed(2) }, metadata: { reason },
    }, tx);
  }, SERIALIZABLE);
}

/** Tenant credit = confirmed payment amounts not allocated to any invoice. */
export async function tenantCredit(tenantId: string, tx: Tx = db) {
  const payments = await tx.payment.findMany({
    where: { tenantId, status: "CONFIRMED" },
    include: { allocations: { where: { reversed: false } } },
  });
  return sum(payments.map((p) => money(p.amount).minus(sum(p.allocations.map((a) => a.amount)))));
}

export async function tenantBalance(tenantId: string, tx: Tx = db) {
  const invoices = await tx.invoice.findMany({
    where: { tenantId, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } },
  });
  const outstanding = sum(invoices.map(invoiceBalance));
  const credit = await tenantCredit(tenantId, tx);
  return { outstanding, credit, net: outstanding.minus(credit), invoices };
}

// ───────────────────────── Scheduled jobs ─────────────────────────

/**
 * Creates invoices for schedule entries due within the lead window. Idempotent twice over:
 * a schedule row links to at most one invoice, and invoices carry `schedule:<id>` keys.
 */
export async function generateDueInvoices(organizationId: string, today = todayUtc()) {
  const settings = await db.organizationSettings.findUnique({ where: { organizationId } });
  const lead = settings?.invoiceLeadDays ?? 10;
  const horizon = new Date(today.getTime() + lead * 86_400_000);
  const due = await db.rentSchedule.findMany({
    where: {
      organizationId,
      invoiceId: null,
      cancelled: false,
      dueDate: { lte: horizon },
      lease: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } },
    },
    include: { lease: { include: { unit: { include: { property: true } } } } },
    orderBy: { dueDate: "asc" },
    take: 1000,
  });
  // One invoice per lease and due date, with one line per charge type.
  const groups = new Map<string, typeof due>();
  for (const s of due) {
    const key = `${s.leaseId}:${s.dueDate.toISOString().slice(0, 10)}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  let created = 0;
  for (const [key, rows] of groups) {
    const lease = rows[0].lease;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Lease" WHERE id = ${lease.id} FOR UPDATE`;
      const pending = await tx.rentSchedule.findMany({ where: { id: { in: rows.map((r) => r.id) }, invoiceId: null } });
      if (pending.length === 0) return;
      const { invoice, created: isNew } = await createInvoice(tx, null, {
        organizationId,
        tenantId: lease.tenantId,
        leaseId: lease.id,
        issueDate: today < rows[0].dueDate ? today : rows[0].dueDate,
        dueDate: rows[0].dueDate,
        lines: pending.map((s) => {
          const label = s.chargeType === "RENT" ? "Rent" : s.chargeType === "SERVICE_CHARGE" ? "Service charge" : s.chargeType;
          const period = `${s.periodStart.toISOString().slice(0, 10)} → ${s.periodEnd.toISOString().slice(0, 10)}`;
          return { chargeType: s.chargeType, description: `${label} ${lease.unit.property.name} ${lease.unit.number} (${period})`, unitPrice: money(s.amount).toFixed(2) };
        }),
        issue: true,
        idempotencyKey: `schedule:${key}`,
        currency: lease.currency,
        taxRatePercent: settings?.taxRatePercent.toString() ?? 0,
      });
      await tx.rentSchedule.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { invoiceId: invoice.id } });
      if (isNew) created++;
    });
  }
  return created;
}

/** Marks past-due invoices overdue and assesses late fees exactly once per invoice. */
export async function assessOverdueAndLateFees(organizationId: string, today = todayUtc()) {
  const settings = await db.organizationSettings.findUnique({ where: { organizationId } });
  const overdue = await db.invoice.findMany({
    where: { organizationId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: today } },
    select: { id: true },
  });
  for (const o of overdue) await db.$transaction((tx) => refreshInvoiceStatus(tx, o.id));

  let fees = 0;
  const candidates = await db.invoice.findMany({
    where: { organizationId, status: "OVERDUE", leaseId: { not: null }, NOT: { idempotencyKey: { startsWith: "latefee:" } } },
    include: { lease: true },
  });
  for (const inv of candidates) {
    const lease = inv.lease!;
    const type = lease.lateFeeType !== "NONE" ? lease.lateFeeType : settings?.lateFeeType ?? "NONE";
    const value = lease.lateFeeType !== "NONE" ? lease.lateFeeValue : settings?.lateFeeValue ?? 0;
    const fee = computeLateFee({ type, value, outstanding: invoiceBalance(inv), dueDate: inv.dueDate, graceDays: lease.graceDays, today });
    if (!fee) continue;
    try {
      await db.$transaction(async (tx) => {
        const r = await createInvoice(tx, null, {
          organizationId,
          tenantId: inv.tenantId,
          leaseId: inv.leaseId,
          issueDate: today,
          dueDate: today,
          lines: [{ chargeType: "LATE_FEE", description: `Late fee on invoice ${inv.number}`, unitPrice: fee.toFixed(2) }],
          issue: true,
          idempotencyKey: `latefee:${inv.id}`,
          currency: inv.currency,
        });
        if (r.created) fees++;
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  return { overdueChecked: overdue.length, lateFees: fees };
}

export async function sendDueReminders(organizationId: string, today = todayUtc()) {
  const settings = await db.organizationSettings.findUnique({ where: { organizationId } });
  const days = settings?.reminderDaysBefore ?? 5;
  const target = new Date(today.getTime() + days * 86_400_000);
  const upcoming = await db.invoice.findMany({
    where: { organizationId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { gte: today, lte: target } },
  });
  const overdue = await db.invoice.findMany({ where: { organizationId, status: "OVERDUE" } });
  const day = today.toISOString().slice(0, 10);
  for (const inv of upcoming) {
    await notifyUsers({
      organizationId, userIds: await tenantUserIds(inv.tenantId), event: "RENT_DUE",
      vars: { number: inv.number, amount: `${invoiceBalance(inv).toFixed(0)} ${inv.currency}`, dueDate: inv.dueDate.toISOString().slice(0, 10) },
      link: "/portal/billing", dedupeKey: `due:${inv.id}`,
    });
  }
  for (const inv of overdue) {
    // At most one overdue reminder per invoice per week.
    const week = Math.floor(today.getTime() / (7 * 86_400_000));
    await notifyUsers({
      organizationId, userIds: await tenantUserIds(inv.tenantId), event: "RENT_OVERDUE",
      vars: { number: inv.number, amount: `${invoiceBalance(inv).toFixed(0)} ${inv.currency}` },
      link: "/portal/billing", dedupeKey: `overdue:${inv.id}:${week}`,
    });
  }
  return { upcoming: upcoming.length, overdue: overdue.length, day };
}
