import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { money } from "@/lib/money";
import { approveAndActivateLease, submitLease } from "@/services/leases";
import {
  assessOverdueAndLateFees, generateDueInvoices, recordPayment, reversePayment, tenantBalance, voidInvoice, approvePayment,
} from "@/services/billing";
import { processProviderEvent } from "@/services/payment-webhooks";
import { GenericHmacProvider, signGenericWebhook } from "@/lib/payments/provider";
import { runOnce } from "@/services/jobs";
import { ctxFor, setupOrg } from "./helpers";

afterAll(async () => {
  await db.$disconnect();
});

const JUNE_1 = new Date(Date.UTC(2026, 5, 1));

describe("lease activation → schedule → invoices", () => {
  it("activation generates the full schedule once and marks the unit occupied", async () => {
    const s = await setupOrg();
    await submitLease(s.ctx, s.lease.id);
    const periods = await approveAndActivateLease(s.ctx, s.lease.id);
    expect(periods).toBe(12);
    expect((await db.unit.findUniqueOrThrow({ where: { id: s.unit.id } })).status).toBe("OCCUPIED");
    expect(await db.securityDeposit.count({ where: { leaseId: s.lease.id } })).toBe(1);
  });

  it("rejects overlapping leases on the same unit", async () => {
    const s = await setupOrg();
    await submitLease(s.ctx, s.lease.id);
    await approveAndActivateLease(s.ctx, s.lease.id);
    const other = await db.lease.create({
      data: { organizationId: s.org.id, reference: "L2", unitId: s.unit.id, tenantId: s.tenant.id, startDate: new Date(Date.UTC(2026, 5, 1)), endDate: new Date(Date.UTC(2027, 4, 31)), rentAmount: "1" },
    });
    await expect(submitLease(s.ctx, other.id)).rejects.toThrow(/overlapping/);
  });

  it("invoice generation is idempotent", async () => {
    const s = await setupOrg();
    await submitLease(s.ctx, s.lease.id);
    await approveAndActivateLease(s.ctx, s.lease.id);
    const first = await generateDueInvoices(s.org.id, JUNE_1);
    const second = await generateDueInvoices(s.org.id, JUNE_1);
    expect(first).toBe(6); // Jan..Jun (June 5 inside the 10-day lead window)
    expect(second).toBe(0);
    expect(await db.invoice.count({ where: { organizationId: s.org.id } })).toBe(6);
  });
});

describe("payments", () => {
  async function activeWithInvoices() {
    const s = await setupOrg();
    await submitLease(s.ctx, s.lease.id);
    await approveAndActivateLease(s.ctx, s.lease.id);
    await generateDueInvoices(s.org.id, JUNE_1);
    return s;
  }

  it("partial multi-invoice payment updates balances and issues one receipt", async () => {
    const s = await activeWithInvoices();
    const before = await tenantBalance(s.tenant.id);
    expect(before.outstanding.toFixed(2)).toBe("600000.00");
    const { payment, pendingApproval } = await recordPayment(s.ctx, { tenantId: s.tenant.id, leaseId: s.lease.id, amount: "250000", paymentDate: JUNE_1, method: "CASH", confirmNow: true });
    expect(pendingApproval).toBe(false);
    const after = await tenantBalance(s.tenant.id);
    expect(after.outstanding.toFixed(2)).toBe("350000.00");
    const invs = await db.invoice.findMany({ where: { tenantId: s.tenant.id }, orderBy: { dueDate: "asc" } });
    expect(invs.slice(0, 2).every((i) => i.status === "PAID")).toBe(true);
    expect(money(invs[2].amountPaid).toFixed(2)).toBe("50000.00");
    expect(await db.receipt.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it("overpayment is kept as unapplied tenant credit", async () => {
    const s = await activeWithInvoices();
    await db.organizationSettings.update({ where: { organizationId: s.org.id }, data: { separationOfDuties: false } });
    await recordPayment(s.ctx, { tenantId: s.tenant.id, amount: "700000", paymentDate: JUNE_1, method: "BANK_TRANSFER", confirmNow: true });
    const b = await tenantBalance(s.tenant.id);
    expect(b.outstanding.toFixed(2)).toBe("0.00");
    expect(b.credit.toFixed(2)).toBe("100000.00");
  });

  it("reversal restores balances transactionally and keeps history", async () => {
    const s = await activeWithInvoices();
    const { payment } = await recordPayment(s.ctx, { tenantId: s.tenant.id, amount: "250000", paymentDate: JUNE_1, method: "CASH", confirmNow: true });
    await expect(reversePayment(s.ctx, payment.id, "no")).rejects.toThrow(/reason/);
    await reversePayment(s.ctx, payment.id, "Cheque bounced");
    const b = await tenantBalance(s.tenant.id);
    expect(b.outstanding.toFixed(2)).toBe("600000.00");
    expect(await db.paymentAllocation.count({ where: { paymentId: payment.id } })).toBeGreaterThan(0); // not deleted
    expect(await db.receipt.count({ where: { paymentId: payment.id } })).toBe(1); // receipt untouched
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("REVERSED");
    await expect(reversePayment(s.ctx, payment.id, "Again please")).rejects.toThrow();
  });

  it("separation of duties: high-value payment needs a second approver", async () => {
    const s = await activeWithInvoices();
    const { payment, pendingApproval } = await recordPayment(s.cashierCtx, { tenantId: s.tenant.id, amount: "600000", paymentDate: JUNE_1, method: "CASH", confirmNow: true });
    expect(pendingApproval).toBe(true);
    await expect(approvePayment(s.cashierCtx, payment.id)).rejects.toThrow(/Separation of duties/);
    await approvePayment(s.ctx, payment.id);
    expect((await tenantBalance(s.tenant.id)).outstanding.toFixed(2)).toBe("0.00");
  });

  it("concurrent payments never over-allocate an invoice", async () => {
    const s = await activeWithInvoices();
    await Promise.all(
      Array.from({ length: 4 }, () => recordPayment(s.ctx, { tenantId: s.tenant.id, amount: "200000", paymentDate: JUNE_1, method: "CASH", confirmNow: true }).catch(() => null)),
    );
    const invs = await db.invoice.findMany({ where: { tenantId: s.tenant.id } });
    for (const i of invs) expect(money(i.amountPaid).lte(money(i.total))).toBe(true);
    const allocated = await db.paymentAllocation.aggregate({ where: { invoice: { tenantId: s.tenant.id }, reversed: false }, _sum: { amount: true } });
    expect(money(allocated._sum.amount ?? 0).lte(600000)).toBe(true);
  });

  it("a paid invoice cannot be voided", async () => {
    const s = await activeWithInvoices();
    await recordPayment(s.ctx, { tenantId: s.tenant.id, amount: "100000", paymentDate: JUNE_1, method: "CASH", confirmNow: true });
    const first = await db.invoice.findFirstOrThrow({ where: { tenantId: s.tenant.id }, orderBy: { dueDate: "asc" } });
    await expect(voidInvoice(s.ctx, first.id, "mistake")).rejects.toThrow(/Reverse the payments/);
  });
});

describe("late fees", () => {
  it("are charged once per overdue invoice", async () => {
    const s = await setupOrg();
    await db.lease.update({ where: { id: s.lease.id }, data: { lateFeeType: "FIXED", lateFeeValue: "5000" } });
    await submitLease(s.ctx, s.lease.id);
    await approveAndActivateLease(s.ctx, s.lease.id);
    await generateDueInvoices(s.org.id, JUNE_1);
    const r1 = await assessOverdueAndLateFees(s.org.id, JUNE_1);
    const r2 = await assessOverdueAndLateFees(s.org.id, JUNE_1);
    expect(r1.lateFees).toBe(5); // Jan–May are all past the 5-day grace period on June 1
    expect(r2.lateFees).toBe(0);
  });
});

describe("isolation", () => {
  it("services refuse records from another organization", async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    await expect(submitLease(b.ctx, a.lease.id)).rejects.toThrow(/not found/);
    await expect(recordPayment(b.ctx, { tenantId: a.tenant.id, amount: "1", paymentDate: JUNE_1, method: "CASH", confirmNow: true })).rejects.toThrow(/Tenant not found/);
  });

  it("building-scoped users cannot act on leases outside their buildings", async () => {
    const s = await setupOrg();
    const scoped = ctxFor(s.org.id, s.admin.id, "property_manager", []);
    await expect(submitLease(scoped, s.lease.id)).rejects.toThrow(/not found/);
  });
});

describe("payment webhooks", () => {
  it("verifies signatures and confirms exactly once", async () => {
    const s = await setupOrg();
    await submitLease(s.ctx, s.lease.id);
    await approveAndActivateLease(s.ctx, s.lease.id);
    await generateDueInvoices(s.org.id, JUNE_1);
    const { payment } = await recordPayment(s.ctx, { tenantId: s.tenant.id, amount: "100000", paymentDate: JUNE_1, method: "MOBILE_MONEY", externalRef: `MOMO-${s.org.id}`, confirmNow: false });
    const provider = new GenericHmacProvider("whsec_test");
    const body = JSON.stringify({ eventId: "evt1", reference: `MOMO-${s.org.id}`, status: "SUCCEEDED", amount: "100000", currency: "XAF" });
    const { ts, signature } = signGenericWebhook("whsec_test", body);
    await expect(provider.verifyWebhook(new Headers({ "x-signature": "sha256=bad", "x-timestamp": String(ts) }), body)).rejects.toThrow();
    const event = await provider.verifyWebhook(new Headers({ "x-signature": signature, "x-timestamp": String(ts) }), body);
    expect(await processProviderEvent("generic", event)).toBe("confirmed");
    expect(await processProviderEvent("generic", event)).toBe("ignored:already_confirmed");
    expect(await db.receipt.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it("never confirms on amount mismatch", async () => {
    const s = await setupOrg();
    await recordPayment(s.ctx, { tenantId: s.tenant.id, amount: "100000", paymentDate: JUNE_1, method: "MOBILE_MONEY", externalRef: `MM-${s.org.id}`, confirmNow: false });
    const r = await processProviderEvent("generic", { eventId: "e", providerReference: `MM-${s.org.id}`, status: "SUCCEEDED", amount: "1", currency: "XAF" });
    expect(r).toBe("rejected:amount_mismatch");
  });
});

describe("jobs", () => {
  it("runOnce prevents duplicate execution of the same job key", async () => {
    const key = `test:${Date.now()}`;
    let runs = 0;
    const [a, b] = await Promise.all([runOnce(key, false, async () => ++runs), runOnce(key, false, async () => ++runs)]);
    expect(runs).toBe(1);
    expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
  });
});
