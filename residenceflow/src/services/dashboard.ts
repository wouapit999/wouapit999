import "server-only";
import { db } from "@/lib/db";
import { money, sum } from "@/lib/money";
import { ageBalances } from "@/domain/aging";
import { OPEN_WORK_ORDER_STATUSES } from "@/domain/work-order";
import {
  byPropertyWhere, can, invoiceWhere, leaseWhere, maintenanceWhere, paymentWhere, propertyWhere, unitWhere, type AuthContext,
} from "@/lib/auth/context";
import { invoiceBalance, todayUtc } from "./billing";

const DAY = 86_400_000;
const OPEN_INVOICE = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] as const;

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** All dashboard values come from live, permission-scoped queries. */
export async function operationalMetrics(ctx: AuthContext) {
  const today = todayUtc();
  const [buildings, unitsByStatus, openWo, overdueWo, urgentWo, expiring] = await Promise.all([
    db.property.count({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } } }),
    db.unit.groupBy({ by: ["status"], where: { ...unitWhere(ctx), archived: false }, _count: true }),
    db.maintenanceRequest.count({ where: { ...maintenanceWhere(ctx), status: { in: [...OPEN_WORK_ORDER_STATUSES] } } }),
    db.maintenanceRequest.count({
      where: { ...maintenanceWhere(ctx), status: { in: [...OPEN_WORK_ORDER_STATUSES] }, createdAt: { lt: new Date(Date.now() - 7 * DAY) } },
    }),
    db.maintenanceRequest.findMany({
      where: { ...maintenanceWhere(ctx), status: { in: [...OPEN_WORK_ORDER_STATUSES] }, OR: [{ priority: "URGENT" }, { safetyIssue: true }, { priority: "HIGH" }] },
      orderBy: [{ safetyIssue: "desc" }, { createdAt: "asc" }],
      take: 5,
      include: { property: { select: { name: true } }, unit: { select: { number: true } } },
    }),
    can(ctx, "lease.view")
      ? db.lease.findMany({
          where: { ...leaseWhere(ctx), status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, endDate: { gte: today, lte: new Date(today.getTime() + 90 * DAY) } },
          orderBy: { endDate: "asc" },
          include: { tenant: { select: { legalName: true } }, unit: { select: { number: true, property: { select: { name: true } } } } },
        })
      : Promise.resolve([]),
  ]);
  const count = (s: string) => unitsByStatus.find((u) => u.status === s)?._count ?? 0;
  const totalUnits = unitsByStatus.reduce((a, u) => a + u._count, 0);
  const occupied = count("OCCUPIED") + count("NOTICE_GIVEN");
  const within = (days: number) => expiring.filter((l) => l.endDate.getTime() <= today.getTime() + days * DAY).length;
  return {
    buildings,
    totalUnits,
    occupied,
    vacant: count("VACANT") + count("RESERVED"),
    underMaintenance: count("UNDER_MAINTENANCE") + count("UNDER_INSPECTION"),
    occupancyRate: totalUnits ? Math.round((occupied / totalUnits) * 1000) / 10 : 0,
    openWo,
    overdueWo,
    urgentWo,
    expiring: { d30: within(30), d60: within(60), d90: within(90), list: expiring.slice(0, 6) },
  };
}

export async function occupancyTrend(ctx: AuthContext, months = 6) {
  const today = todayUtc();
  const [units, leases] = await Promise.all([
    db.unit.findMany({ where: unitWhere(ctx), select: { id: true, createdAt: true } }),
    db.lease.findMany({
      where: { ...leaseWhere(ctx), status: { in: ["ACTIVE", "NOTICE_GIVEN", "EXPIRED", "TERMINATED", "RENEWED"] } },
      select: { unitId: true, startDate: true, endDate: true, moveOutDate: true },
    }),
  ]);
  const out: { month: string; rate: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i + 1, 0));
    const at = end > today ? today : end;
    const existing = units.filter((u) => u.createdAt <= new Date(at.getTime() + DAY));
    const occ = new Set(
      leases.filter((l) => l.startDate <= at && (l.moveOutDate ?? l.endDate) >= at).map((l) => l.unitId),
    );
    const rate = existing.length ? Math.round((existing.filter((u) => occ.has(u.id)).length / existing.length) * 100) : 0;
    out.push({ month: monthKey(end), rate });
  }
  return out;
}

export async function financialMetrics(ctx: AuthContext) {
  const today = todayUtc();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const yearAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));

  const [open, monthInvoices, monthPayments, deposits, recentPayments, trendInvoices, trendPayments, expenses, pendingPayments] = await Promise.all([
    db.invoice.findMany({
      where: { ...invoiceWhere(ctx), status: { in: [...OPEN_INVOICE] } },
      select: { total: true, amountPaid: true, amountCredited: true, dueDate: true, lease: { select: { unit: { select: { property: { select: { name: true } } } } } } },
    }),
    db.invoice.findMany({
      where: { ...invoiceWhere(ctx), status: { notIn: ["DRAFT", "VOID"] }, dueDate: { gte: monthStart, lte: monthEnd } },
      select: { total: true, amountPaid: true },
    }),
    db.payment.findMany({
      where: { ...paymentWhere(ctx), status: "CONFIRMED", paymentDate: { gte: monthStart, lte: monthEnd } },
      select: { amount: true },
    }),
    db.depositTransaction.findMany({
      where: {
        status: "APPROVED",
        deposit: { organizationId: ctx.organizationId, ...(ctx.propertyIds === "ALL" ? {} : { lease: { unit: { propertyId: { in: ctx.propertyIds } } } }) },
      },
      select: { type: true, amount: true },
    }),
    db.payment.findMany({
      where: { ...paymentWhere(ctx), status: { in: ["CONFIRMED", "PENDING"] } },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { tenant: { select: { legalName: true } } },
    }),
    db.invoice.findMany({
      where: { ...invoiceWhere(ctx), status: { notIn: ["DRAFT", "VOID"] }, dueDate: { gte: yearAgo, lte: monthEnd } },
      select: { total: true, dueDate: true, lease: { select: { unit: { select: { property: { select: { name: true } } } } } } },
    }),
    db.payment.findMany({
      where: { ...paymentWhere(ctx), status: "CONFIRMED", paymentDate: { gte: yearAgo, lte: monthEnd } },
      select: { amount: true, paymentDate: true, lease: { select: { unit: { select: { property: { select: { name: true } } } } } } },
    }),
    can(ctx, "expense.view")
      ? db.expense.groupBy({
          by: ["category"],
          where: { ...byPropertyWhere(ctx), status: { in: ["APPROVED", "PAID"] }, expenseDate: { gte: new Date(Date.UTC(today.getUTCFullYear(), 0, 1)) } },
          _sum: { amount: true },
        })
      : Promise.resolve([]),
    db.payment.count({ where: { ...paymentWhere(ctx), status: "PENDING" } }),
  ]);

  const aging = ageBalances(open.map((i) => ({ dueDate: i.dueDate, balance: invoiceBalance(i) })), today);
  const expected = sum(monthInvoices.map((i) => i.total));
  const collected = sum(monthPayments.map((p) => p.amount));
  const collectedAgainstMonth = sum(monthInvoices.map((i) => i.amountPaid));
  const depositsHeld = deposits.reduce((acc, t) => (t.type === "RECEIPT" ? acc.plus(money(t.amount)) : acc.minus(money(t.amount))), money(0));

  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(monthKey(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1))));
  const billedBy = new Map(months.map((m) => [m, money(0)]));
  const collectedBy = new Map(months.map((m) => [m, money(0)]));
  for (const i of trendInvoices) billedBy.set(monthKey(i.dueDate), (billedBy.get(monthKey(i.dueDate)) ?? money(0)).plus(money(i.total)));
  for (const p of trendPayments) collectedBy.set(monthKey(p.paymentDate), (collectedBy.get(monthKey(p.paymentDate)) ?? money(0)).plus(money(p.amount)));
  const revenueByBuilding = new Map<string, ReturnType<typeof money>>();
  for (const p of trendPayments) {
    const name = p.lease?.unit.property.name ?? "—";
    revenueByBuilding.set(name, (revenueByBuilding.get(name) ?? money(0)).plus(money(p.amount)));
  }

  return {
    expected,
    collected,
    collectionRate: expected.gt(0) ? Math.round(collectedAgainstMonth.div(expected).toNumber() * 1000) / 10 : 0,
    outstanding: aging.total,
    overdue: aging.total.minus(aging.current),
    aging,
    depositsHeld,
    pendingPayments,
    recentPayments,
    trend: months.map((m) => ({ month: m.slice(2), billed: billedBy.get(m)!.toNumber(), collected: collectedBy.get(m)!.toNumber() })),
    revenueByBuilding: [...revenueByBuilding.entries()].map(([name, v]) => ({ name, value: v.toNumber() })).sort((a, b) => b.value - a.value),
    expensesByCategory: expenses.map((e) => ({ name: e.category, value: money(e._sum.amount ?? 0).toNumber() })),
  };
}

export async function conciergeMetrics(ctx: AuthContext) {
  const startOfDay = new Date(Date.now() - 24 * 3600_000);
  const [onSite, expected, parcels, incidents] = await Promise.all([
    db.visitorLog.count({ where: { ...byPropertyWhere(ctx), checkInAt: { not: null }, checkOutAt: null } }),
    db.visitorLog.count({ where: { ...byPropertyWhere(ctx), preauthorized: true, checkInAt: null, expectedAt: { gte: startOfDay } } }),
    db.parcel.count({ where: { ...byPropertyWhere(ctx), collectedAt: null } }),
    db.incident.count({ where: { ...byPropertyWhere(ctx), status: "OPEN" } }),
  ]);
  return { onSite, expected, parcels, incidents };
}

export async function myWorkOrders(ctx: AuthContext) {
  return db.maintenanceRequest.findMany({
    where: { ...maintenanceWhere(ctx), status: { in: [...OPEN_WORK_ORDER_STATUSES] } },
    orderBy: [{ safetyIssue: "desc" }, { priority: "desc" }, { createdAt: "asc" }],
    take: 10,
    include: { property: { select: { name: true } }, unit: { select: { number: true } } },
  });
}

export async function recentAudit(ctx: AuthContext) {
  return db.auditLog.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, take: 8 });
}
