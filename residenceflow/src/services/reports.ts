import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, maintenanceWhere, type AuthContext } from "@/lib/auth/context";
import { hasAnyPermission, type Permission } from "@/lib/permissions";
import { money, sum, type Decimal } from "@/lib/money";
import { AGING_BUCKETS, ageBalances } from "@/domain/aging";

// Operational and financial reports. Every query is scoped to the organization and to the
// buildings the user may see (optionally narrowed to one building). Page, CSV export and print
// all use these same functions, so the numbers always match.

export type Cell = string | number | null;
export type ColumnKind = "text" | "money" | "number" | "percent" | "day" | "status";
export interface ReportColumn { key: string; label: string; kind?: ColumnKind }
export interface ReportTable { title?: string; columns: ReportColumn[]; rows: Record<string, Cell>[]; totals?: Record<string, Cell> }
export interface ReportResult { tables: ReportTable[]; notice?: string }

export type ReportFilter = "property" | "range" | "date" | "days" | "month";
export interface ReportParams {
  propertyId: string;
  from: Date;
  to: Date;
  date: Date;
  days: number;
  month: string; // yyyy-mm
}

export interface ReportDef {
  key: string;
  group: "operational" | "financial";
  filters: ReportFilter[];
  /** Extra permissions needed besides the group's view permission. */
  requires?: Permission[];
  /** Custom visibility rule (replaces the group permission check). */
  visible?: (ctx: AuthContext) => boolean;
  run: (ctx: AuthContext, p: ReportParams) => Promise<ReportResult>;
}

// ───────────────────────── Params ─────────────────────────

const DAY = 86_400_000;
const OPEN_INVOICE = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] as const;

export function utcToday() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
export function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function parseDay(s: string | undefined | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}
function monthStart(y: number, m: number) {
  return new Date(Date.UTC(y, m, 1));
}

type Search = Record<string, string | string[] | undefined> | URLSearchParams;
function read(sp: Search, k: string): string {
  if (sp instanceof URLSearchParams) return sp.get(k) ?? "";
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Parses filter params with per-report defaults. Invalid values fall back to defaults. */
export function parseReportParams(key: string, sp: Search): ReportParams {
  const today = utcToday();
  const propertyId = /^[0-9a-f-]{36}$/i.test(read(sp, "propertyId")) ? read(sp, "propertyId") : "";
  const defaultFrom = key === "billed-collected"
    ? monthStart(today.getUTCFullYear(), today.getUTCMonth() - 11)
    : monthStart(today.getUTCFullYear(), today.getUTCMonth() - 2);
  let from = parseDay(read(sp, "from")) ?? defaultFrom;
  let to = parseDay(read(sp, "to")) ?? today;
  if (from > to) [from, to] = [to, from];
  // Keep ranges bounded (max ~3 years) to protect the database.
  if (to.getTime() - from.getTime() > 1100 * DAY) from = new Date(to.getTime() - 1100 * DAY);
  const date = parseDay(read(sp, "date")) ?? today;
  const daysRaw = Number(read(sp, "days"));
  const days = [30, 60, 90].includes(daysRaw) ? daysRaw : 90;
  const monthRaw = read(sp, "month");
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthRaw) ? monthRaw : iso(today).slice(0, 7);
  return { propertyId, from, to, date, days, month };
}

export function paramsToQuery(p: ReportParams, filters: ReportFilter[]) {
  const q = new URLSearchParams();
  if (filters.includes("property") && p.propertyId) q.set("propertyId", p.propertyId);
  if (filters.includes("range")) { q.set("from", iso(p.from)); q.set("to", iso(p.to)); }
  if (filters.includes("date")) q.set("date", iso(p.date));
  if (filters.includes("days")) q.set("days", String(p.days));
  if (filters.includes("month")) q.set("month", p.month);
  return q.toString();
}

// ───────────────────────── Scoping ─────────────────────────

type Scope = "ALL" | string[];

/** Buildings in play: the user's scope, narrowed to one building when requested (never widened). */
function scopeOf(ctx: AuthContext, propertyId: string): Scope {
  if (propertyId) return ctx.propertyIds === "ALL" || ctx.propertyIds.includes(propertyId) ? [propertyId] : [];
  return ctx.propertyIds;
}
const byProp = (s: Scope) => (s === "ALL" ? {} : { propertyId: { in: s } });
const propWhere = (ctx: AuthContext, s: Scope): Prisma.PropertyWhereInput => ({ organizationId: ctx.organizationId, ...(s === "ALL" ? {} : { id: { in: s } }) });
const leaseScope = (ctx: AuthContext, s: Scope): Prisma.LeaseWhereInput => ({ organizationId: ctx.organizationId, ...(s === "ALL" ? {} : { unit: { propertyId: { in: s } } }) });
const invoiceScope = (ctx: AuthContext, s: Scope): Prisma.InvoiceWhereInput => ({ organizationId: ctx.organizationId, ...(s === "ALL" ? {} : { lease: { unit: { propertyId: { in: s } } } }) });
const paymentScope = (ctx: AuthContext, s: Scope): Prisma.PaymentWhereInput => ({ organizationId: ctx.organizationId, ...(s === "ALL" ? {} : { lease: { unit: { propertyId: { in: s } } } }) });
const tenantScope = (ctx: AuthContext, s: Scope): Prisma.TenantWhereInput => ({ organizationId: ctx.organizationId, ...(s === "ALL" ? {} : { leases: { some: { unit: { propertyId: { in: s } } } } }) });
const expenseScope = (ctx: AuthContext, s: Scope): Prisma.ExpenseWhereInput => ({ organizationId: ctx.organizationId, ...byProp(s) });

const m2 = (d: Decimal) => d.toFixed(2);
const pct = (num: Decimal, den: Decimal) => (den.gt(0) ? Math.round(num.div(den).mul(1000).toNumber()) / 10 : null);
const endOfDay = (d: Date) => new Date(d.getTime() + DAY); // exclusive bound for DateTime columns

function invBalance(i: { total: Prisma.Decimal; amountPaid: Prisma.Decimal; amountCredited: Prisma.Decimal }) {
  const b = money(i.total).minus(money(i.amountPaid)).minus(money(i.amountCredited));
  return b.isNegative() ? money(0) : b;
}

function monthsBetween(from: Date, to: Date) {
  const out: string[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  while (y < to.getUTCFullYear() || (y === to.getUTCFullYear() && m <= to.getUTCMonth())) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

const UNASSIGNED = "—";
const LIMIT = 5000;

// ───────────────────────── Operational ─────────────────────────

async function buildingRegister(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const units = await db.unit.findMany({
    where: { organizationId: ctx.organizationId, archived: false, ...byProp(s), property: { status: { not: "ARCHIVED" } } },
    orderBy: [{ property: { name: "asc" } }, { block: "asc" }, { floor: "asc" }, { number: "asc" }],
    include: { property: { select: { name: true, reference: true } } },
    take: LIMIT,
  });
  return {
    tables: [{
      columns: [
        { key: "building", label: "rep.col.building" },
        { key: "ref", label: "rep.col.reference" },
        { key: "block", label: "rep.col.block" },
        { key: "floor", label: "rep.col.floor", kind: "number" },
        { key: "unit", label: "rep.col.unit" },
        { key: "type", label: "rep.col.type" },
        { key: "bedrooms", label: "rep.col.bedrooms", kind: "number" },
        { key: "area", label: "rep.col.area", kind: "number" },
        { key: "rent", label: "rep.col.defaultRent", kind: "money" },
        { key: "status", label: "rep.col.status", kind: "status" },
      ],
      rows: units.map((u) => ({
        building: u.property.name, ref: u.property.reference, block: u.block, floor: u.floor, unit: u.number, type: u.type,
        bedrooms: u.bedrooms, area: u.area ? Number(u.area) : null, rent: m2(money(u.defaultRent)), status: u.status,
      })),
      totals: { building: `${units.length}`, rent: m2(sum(units.map((u) => u.defaultRent))) },
    }],
  };
}

async function occupancy(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const props = await db.property.findMany({
    where: { ...propWhere(ctx, s), status: { not: "ARCHIVED" } },
    orderBy: { name: "asc" },
    select: { name: true, units: { where: { archived: false }, select: { status: true } } },
  });
  const tot = { units: 0, occupied: 0, notice: 0, vacant: 0, reserved: 0, other: 0 };
  const rows = props.map((pr) => {
    const c = (st: string[]) => pr.units.filter((u) => st.includes(u.status)).length;
    const r = {
      units: pr.units.length,
      occupied: c(["OCCUPIED"]),
      notice: c(["NOTICE_GIVEN"]),
      vacant: c(["VACANT"]),
      reserved: c(["RESERVED"]),
      other: c(["UNDER_INSPECTION", "UNDER_MAINTENANCE", "UNAVAILABLE"]),
    };
    for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += r[k];
    return { building: pr.name, ...r, rate: r.units ? Math.round(((r.occupied + r.notice) / r.units) * 1000) / 10 : null, vacancy: r.units ? Math.round((r.vacant / r.units) * 1000) / 10 : null };
  });
  return {
    tables: [{
      columns: [
        { key: "building", label: "rep.col.building" },
        { key: "units", label: "rep.col.units", kind: "number" },
        { key: "occupied", label: "rep.col.occupied", kind: "number" },
        { key: "notice", label: "rep.col.noticeGiven", kind: "number" },
        { key: "vacant", label: "rep.col.vacant", kind: "number" },
        { key: "reserved", label: "rep.col.reserved", kind: "number" },
        { key: "other", label: "rep.col.unavailable", kind: "number" },
        { key: "rate", label: "rep.col.occupancyRate", kind: "percent" },
        { key: "vacancy", label: "rep.col.vacancyRate", kind: "percent" },
      ],
      rows,
      totals: {
        building: "rep.total", ...tot,
        rate: tot.units ? Math.round(((tot.occupied + tot.notice) / tot.units) * 1000) / 10 : null,
        vacancy: tot.units ? Math.round((tot.vacant / tot.units) * 1000) / 10 : null,
      },
    }],
  };
}

async function tenantDirectory(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const tenants = await db.tenant.findMany({
    where: { ...tenantScope(ctx, s), status: "ACTIVE" },
    orderBy: { legalName: "asc" },
    take: LIMIT,
    select: {
      reference: true, legalName: true, phone: true, email: true, language: true,
      leases: {
        where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, ...(s === "ALL" ? {} : { unit: { propertyId: { in: s } } }) },
        select: { reference: true, unit: { select: { number: true, property: { select: { name: true } } } } },
      },
    },
  });
  return {
    tables: [{
      columns: [
        { key: "ref", label: "rep.col.reference" },
        { key: "name", label: "rep.col.tenant" },
        { key: "phone", label: "rep.col.phone" },
        { key: "email", label: "rep.col.email" },
        { key: "building", label: "rep.col.building" },
        { key: "unit", label: "rep.col.unit" },
        { key: "lease", label: "rep.col.lease" },
      ],
      rows: tenants.map((x) => ({
        ref: x.reference, name: x.legalName, phone: x.phone, email: x.email,
        building: x.leases.map((l) => l.unit.property.name).join(", ") || UNASSIGNED,
        unit: x.leases.map((l) => l.unit.number).join(", ") || UNASSIGNED,
        lease: x.leases.map((l) => l.reference).join(", ") || UNASSIGNED,
      })),
      totals: { ref: `${tenants.length}` },
    }],
  };
}

async function leaseExpirations(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const today = utcToday();
  const until = new Date(today.getTime() + p.days * DAY);
  const leases = await db.lease.findMany({
    where: { ...leaseScope(ctx, s), status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, endDate: { gte: today, lte: until } },
    orderBy: { endDate: "asc" },
    take: LIMIT,
    include: { tenant: { select: { legalName: true } }, unit: { select: { number: true, property: { select: { name: true } } } } },
  });
  return {
    tables: [{
      columns: [
        { key: "lease", label: "rep.col.lease" },
        { key: "tenant", label: "rep.col.tenant" },
        { key: "building", label: "rep.col.building" },
        { key: "unit", label: "rep.col.unit" },
        { key: "end", label: "rep.col.endDate", kind: "day" },
        { key: "daysLeft", label: "rep.col.daysLeft", kind: "number" },
        { key: "rent", label: "rep.col.rent", kind: "money" },
        { key: "status", label: "rep.col.status", kind: "status" },
      ],
      rows: leases.map((l) => ({
        lease: l.reference, tenant: l.tenant.legalName, building: l.unit.property.name, unit: l.unit.number, end: iso(l.endDate),
        daysLeft: Math.round((l.endDate.getTime() - today.getTime()) / DAY), rent: m2(money(l.rentAmount)), status: l.status,
      })),
      totals: { lease: `${leases.length}`, rent: m2(sum(leases.map((l) => l.rentAmount))) },
    }],
  };
}

async function moveInOut(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const range = { gte: p.from, lte: p.to };
  const leases = await db.lease.findMany({
    where: {
      ...leaseScope(ctx, s),
      status: { notIn: ["DRAFT", "PENDING_APPROVAL"] },
      OR: [{ moveInDate: range }, { moveInDate: null, startDate: range }, { moveOutDate: range }],
    },
    take: LIMIT,
    include: { tenant: { select: { legalName: true } }, unit: { select: { number: true, property: { select: { name: true } } } } },
  });
  const rows: Record<string, Cell>[] = [];
  for (const l of leases) {
    const inDate = l.moveInDate ?? l.startDate;
    const base = { lease: l.reference, tenant: l.tenant.legalName, building: l.unit.property.name, unit: l.unit.number };
    if (inDate >= p.from && inDate <= p.to) rows.push({ date: iso(inDate), kind: "MOVE_IN", ...base });
    if (l.moveOutDate && l.moveOutDate >= p.from && l.moveOutDate <= p.to) rows.push({ date: iso(l.moveOutDate), kind: "MOVE_OUT", ...base });
  }
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const ins = rows.filter((r) => r.kind === "MOVE_IN").length;
  return {
    tables: [{
      columns: [
        { key: "date", label: "rep.col.date", kind: "day" },
        { key: "kind", label: "rep.col.movement", kind: "status" },
        { key: "tenant", label: "rep.col.tenant" },
        { key: "building", label: "rep.col.building" },
        { key: "unit", label: "rep.col.unit" },
        { key: "lease", label: "rep.col.lease" },
      ],
      rows,
      totals: { date: "rep.total", kind: `${ins} / ${rows.length - ins}` },
    }],
  };
}

async function maintenanceVolume(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const reqs = await db.maintenanceRequest.findMany({
    where: { AND: [maintenanceWhere(ctx), byProp(s), { createdAt: { gte: p.from, lt: endOfDay(p.to) } }] },
    select: { category: true, status: true, priority: true, safetyIssue: true, createdAt: true, closedAt: true, rating: true },
    take: 20_000,
  });
  const cats = new Map<string, typeof reqs>();
  for (const r of reqs) cats.set(r.category, [...(cats.get(r.category) ?? []), r]);
  const row = (label: string, list: typeof reqs) => {
    const closed = list.filter((r) => r.closedAt && ["CLOSED", "COMPLETED", "TENANT_CONFIRMATION"].includes(r.status));
    const hours = closed.map((r) => (r.closedAt!.getTime() - r.createdAt.getTime()) / 3_600_000);
    const rated = list.filter((r) => r.rating);
    return {
      category: label,
      total: list.length,
      open: list.filter((r) => !["COMPLETED", "TENANT_CONFIRMATION", "CLOSED", "CANCELLED"].includes(r.status)).length,
      done: list.filter((r) => ["COMPLETED", "TENANT_CONFIRMATION", "CLOSED"].includes(r.status)).length,
      cancelled: list.filter((r) => r.status === "CANCELLED").length,
      urgent: list.filter((r) => r.priority === "URGENT" || r.safetyIssue).length,
      avgHours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
      avgRating: rated.length ? Math.round((rated.reduce((a, r) => a + (r.rating ?? 0), 0) / rated.length) * 10) / 10 : null,
    };
  };
  return {
    tables: [{
      columns: [
        { key: "category", label: "rep.col.category" },
        { key: "total", label: "rep.col.requests", kind: "number" },
        { key: "open", label: "rep.col.open", kind: "number" },
        { key: "done", label: "rep.col.completed", kind: "number" },
        { key: "cancelled", label: "rep.col.cancelled", kind: "number" },
        { key: "urgent", label: "rep.col.urgentSafety", kind: "number" },
        { key: "avgHours", label: "rep.col.avgResolutionHours", kind: "number" },
        { key: "avgRating", label: "rep.col.avgRating", kind: "number" },
      ],
      rows: [...cats.entries()].sort((a, b) => b[1].length - a[1].length).map(([c, list]) => row(c, list)),
      totals: { ...row("rep.total", reqs) },
    }],
  };
}

async function visitorsIncidents(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const range = { gte: p.from, lt: endOfDay(p.to) };
  const org = ctx.organizationId;
  const [props, visitors, parcels, incidents] = await Promise.all([
    db.property.findMany({ where: { ...propWhere(ctx, s), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.visitorLog.groupBy({ by: ["propertyId", "kind"], where: { organizationId: org, ...byProp(s), createdAt: range }, _count: { _all: true } }),
    db.parcel.groupBy({ by: ["propertyId"], where: { organizationId: org, ...byProp(s), receivedAt: range }, _count: { _all: true } }),
    db.incident.findMany({ where: { organizationId: org, ...byProp(s), occurredAt: range }, select: { propertyId: true, status: true, severity: true, kind: true } }),
  ]);
  const zero = { visitors: 0, contractors: 0, deliveries: 0, parcels: 0, incidents: 0, openIncidents: 0, severe: 0, lostFound: 0 };
  const tot = { ...zero };
  const rows = props.map((pr) => {
    const v = (k: string) => visitors.find((x) => x.propertyId === pr.id && x.kind === k)?._count._all ?? 0;
    const inc = incidents.filter((i) => i.propertyId === pr.id);
    const r = {
      visitors: v("VISITOR"),
      contractors: v("CONTRACTOR"),
      deliveries: v("DELIVERY"),
      parcels: parcels.find((x) => x.propertyId === pr.id)?._count._all ?? 0,
      incidents: inc.filter((i) => i.kind === "INCIDENT").length,
      openIncidents: inc.filter((i) => i.kind === "INCIDENT" && i.status === "OPEN").length,
      severe: inc.filter((i) => ["HIGH", "CRITICAL"].includes(i.severity)).length,
      lostFound: inc.filter((i) => i.kind === "LOST_FOUND").length,
    };
    for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += r[k];
    return { building: pr.name, ...r };
  });
  return {
    tables: [{
      columns: [
        { key: "building", label: "rep.col.building" },
        { key: "visitors", label: "rep.col.visitors", kind: "number" },
        { key: "contractors", label: "rep.col.contractors", kind: "number" },
        { key: "deliveries", label: "rep.col.deliveries", kind: "number" },
        { key: "parcels", label: "rep.col.parcels", kind: "number" },
        { key: "incidents", label: "rep.col.incidents", kind: "number" },
        { key: "openIncidents", label: "rep.col.openIncidents", kind: "number" },
        { key: "severe", label: "rep.col.severeIncidents", kind: "number" },
        { key: "lostFound", label: "rep.col.lostFound", kind: "number" },
      ],
      rows,
      totals: { building: "rep.total", ...tot },
    }],
  };
}

// ───────────────────────── Financial ─────────────────────────

async function rentRoll(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const leases = await db.lease.findMany({
    where: { ...leaseScope(ctx, s), status: { in: ["ACTIVE", "NOTICE_GIVEN"] } },
    orderBy: [{ unit: { property: { name: "asc" } } }, { unit: { number: "asc" } }],
    take: LIMIT,
    include: {
      tenant: { select: { legalName: true } },
      unit: { select: { number: true, property: { select: { name: true } } } },
      deposit: { include: { transactions: { where: { status: "APPROVED" } } } },
    },
  });
  const balances = await db.invoice.groupBy({
    by: ["leaseId"],
    where: { organizationId: ctx.organizationId, leaseId: { in: leases.map((l) => l.id) }, status: { in: [...OPEN_INVOICE] } },
    _sum: { total: true, amountPaid: true, amountCredited: true },
  });
  const balBy = new Map(balances.map((b) => [b.leaseId, money(b._sum.total).minus(money(b._sum.amountPaid)).minus(money(b._sum.amountCredited))]));
  const rows = leases.map((l) => {
    const tx = l.deposit?.transactions ?? [];
    const held = sum(tx.filter((x) => x.type === "RECEIPT").map((x) => x.amount)).minus(sum(tx.filter((x) => x.type !== "RECEIPT").map((x) => x.amount)));
    const bal = balBy.get(l.id) ?? money(0);
    return {
      building: l.unit.property.name, unit: l.unit.number, tenant: l.tenant.legalName, lease: l.reference,
      start: iso(l.startDate), end: iso(l.endDate), frequency: l.frequency,
      rent: m2(money(l.rentAmount)), service: m2(money(l.serviceCharge)), deposit: m2(money(l.depositAmount)), held: m2(held),
      balance: m2(bal.isNegative() ? money(0) : bal), status: l.status,
    };
  });
  const tot = (k: string) => m2(sum(rows.map((r) => r[k as keyof (typeof rows)[number]] as string)));
  return {
    tables: [{
      columns: [
        { key: "building", label: "rep.col.building" },
        { key: "unit", label: "rep.col.unit" },
        { key: "tenant", label: "rep.col.tenant" },
        { key: "lease", label: "rep.col.lease" },
        { key: "start", label: "rep.col.startDate", kind: "day" },
        { key: "end", label: "rep.col.endDate", kind: "day" },
        { key: "frequency", label: "rep.col.frequency" },
        { key: "rent", label: "rep.col.rent", kind: "money" },
        { key: "service", label: "rep.col.serviceCharge", kind: "money" },
        { key: "deposit", label: "rep.col.deposit", kind: "money" },
        { key: "held", label: "rep.col.depositHeld", kind: "money" },
        { key: "balance", label: "rep.col.balance", kind: "money" },
        { key: "status", label: "rep.col.status", kind: "status" },
      ],
      rows,
      totals: { building: "rep.total", unit: `${rows.length}`, rent: tot("rent"), service: tot("service"), deposit: tot("deposit"), held: tot("held"), balance: tot("balance") },
    }],
  };
}

async function billedCollected(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const [invoices, payments] = await Promise.all([
    db.invoice.findMany({ where: { ...invoiceScope(ctx, s), status: { notIn: ["DRAFT", "VOID"] }, issueDate: { gte: p.from, lte: p.to } }, select: { issueDate: true, total: true } }),
    db.payment.findMany({ where: { ...paymentScope(ctx, s), status: "CONFIRMED", paymentDate: { gte: p.from, lte: p.to } }, select: { paymentDate: true, amount: true } }),
  ]);
  const billed = new Map<string, Decimal>();
  const collected = new Map<string, Decimal>();
  for (const i of invoices) { const k = iso(i.issueDate).slice(0, 7); billed.set(k, (billed.get(k) ?? money(0)).plus(money(i.total))); }
  for (const x of payments) { const k = iso(x.paymentDate).slice(0, 7); collected.set(k, (collected.get(k) ?? money(0)).plus(money(x.amount))); }
  const rows = monthsBetween(p.from, p.to).map((mo) => {
    const b = billed.get(mo) ?? money(0);
    const c = collected.get(mo) ?? money(0);
    return { month: mo, billed: m2(b), collected: m2(c), gap: m2(b.minus(c)), rate: pct(c, b) };
  });
  const tb = sum(invoices.map((i) => i.total));
  const tc = sum(payments.map((x) => x.amount));
  return {
    tables: [{
      columns: [
        { key: "month", label: "rep.col.month" },
        { key: "billed", label: "rep.col.billed", kind: "money" },
        { key: "collected", label: "rep.col.collected", kind: "money" },
        { key: "gap", label: "rep.col.difference", kind: "money" },
        { key: "rate", label: "rep.col.collectionRate", kind: "percent" },
      ],
      rows,
      totals: { month: "rep.total", billed: m2(tb), collected: m2(tc), gap: m2(tb.minus(tc)), rate: pct(tc, tb) },
    }],
  };
}

async function collectionRate(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const invoices = await db.invoice.findMany({
    where: { ...invoiceScope(ctx, s), status: { notIn: ["DRAFT", "VOID"] }, dueDate: { gte: p.from, lte: p.to } },
    select: { total: true, amountPaid: true, amountCredited: true, lease: { select: { unit: { select: { property: { select: { name: true } } } } } } },
  });
  const groups = new Map<string, typeof invoices>();
  for (const i of invoices) { const k = i.lease?.unit.property.name ?? UNASSIGNED; groups.set(k, [...(groups.get(k) ?? []), i]); }
  const row = (label: string, list: typeof invoices) => {
    const due = sum(list.map((i) => i.total));
    const credited = sum(list.map((i) => i.amountCredited));
    const paid = sum(list.map((i) => i.amountPaid));
    return { building: label, invoices: list.length, due: m2(due), credited: m2(credited), paid: m2(paid), outstanding: m2(sum(list.map(invBalance))), rate: pct(paid, due.minus(credited)) };
  };
  return {
    tables: [{
      columns: [
        { key: "building", label: "rep.col.building" },
        { key: "invoices", label: "rep.col.invoices", kind: "number" },
        { key: "due", label: "rep.col.amountDue", kind: "money" },
        { key: "credited", label: "rep.col.credited", kind: "money" },
        { key: "paid", label: "rep.col.paid", kind: "money" },
        { key: "outstanding", label: "rep.col.outstanding", kind: "money" },
        { key: "rate", label: "rep.col.collectionRate", kind: "percent" },
      ],
      rows: [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, list]) => row(k, list)),
      totals: row("rep.total", invoices),
    }],
  };
}

async function openInvoicesByTenant(ctx: AuthContext, s: Scope) {
  const invoices = await db.invoice.findMany({
    where: { ...invoiceScope(ctx, s), status: { in: [...OPEN_INVOICE] } },
    select: { tenantId: true, dueDate: true, status: true, total: true, amountPaid: true, amountCredited: true, tenant: { select: { legalName: true, reference: true, phone: true } } },
    take: 50_000,
  });
  const byTenant = new Map<string, typeof invoices>();
  for (const i of invoices) byTenant.set(i.tenantId, [...(byTenant.get(i.tenantId) ?? []), i]);
  return byTenant;
}

async function tenantBalances(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const today = utcToday();
  const byTenant = await openInvoicesByTenant(ctx, s);
  const rows = [...byTenant.values()].map((list) => {
    const outstanding = sum(list.map(invBalance));
    const overdue = sum(list.filter((i) => i.dueDate < today).map(invBalance));
    const oldest = list.reduce((a, i) => (i.dueDate < a ? i.dueDate : a), list[0].dueDate);
    return {
      ref: list[0].tenant.reference, tenant: list[0].tenant.legalName, phone: list[0].tenant.phone,
      invoices: list.length, outstanding: m2(outstanding), overdue: m2(overdue), oldest: iso(oldest),
      daysLate: Math.max(0, Math.round((today.getTime() - oldest.getTime()) / DAY)),
    };
  }).filter((r) => money(r.outstanding).gt(0)).sort((a, b) => money(b.outstanding).comparedTo(money(a.outstanding)));
  return {
    tables: [{
      columns: [
        { key: "ref", label: "rep.col.reference" },
        { key: "tenant", label: "rep.col.tenant" },
        { key: "phone", label: "rep.col.phone" },
        { key: "invoices", label: "rep.col.openInvoices", kind: "number" },
        { key: "outstanding", label: "rep.col.outstanding", kind: "money" },
        { key: "overdue", label: "rep.col.overdue", kind: "money" },
        { key: "oldest", label: "rep.col.oldestDue", kind: "day" },
        { key: "daysLate", label: "rep.col.daysLate", kind: "number" },
      ],
      rows,
      totals: { ref: "rep.total", tenant: `${rows.length}`, outstanding: m2(sum(rows.map((r) => r.outstanding))), overdue: m2(sum(rows.map((r) => r.overdue))) },
    }],
  };
}

async function arrearsAging(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const today = utcToday();
  const byTenant = await openInvoicesByTenant(ctx, s);
  const all: { dueDate: Date; balance: Decimal }[] = [];
  const rows = [...byTenant.values()].map((list) => {
    const items = list.map((i) => ({ dueDate: i.dueDate, balance: invBalance(i) }));
    all.push(...items);
    const a = ageBalances(items, today);
    return { ref: list[0].tenant.reference, tenant: list[0].tenant.legalName, ...Object.fromEntries(AGING_BUCKETS.map((b) => [b, m2(a[b])])), total: m2(a.total) };
  }).filter((r) => money(r.total).gt(0)).sort((a, b) => money(b.total).comparedTo(money(a.total)));
  const t = ageBalances(all, today);
  return {
    tables: [{
      columns: [
        { key: "ref", label: "rep.col.reference" },
        { key: "tenant", label: "rep.col.tenant" },
        ...AGING_BUCKETS.map((b) => ({ key: b, label: `rep.aging.${b}`, kind: "money" as const })),
        { key: "total", label: "rep.col.total", kind: "money" },
      ],
      rows,
      totals: { ref: "rep.total", tenant: `${rows.length}`, ...Object.fromEntries(AGING_BUCKETS.map((b) => [b, m2(t[b])])), total: m2(t.total) },
    }],
  };
}

async function dailyCollection(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const payments = await db.payment.findMany({
    where: { ...paymentScope(ctx, s), paymentDate: p.date },
    orderBy: { createdAt: "asc" },
    include: { tenant: { select: { legalName: true } }, receipt: { select: { number: true } }, lease: { select: { unit: { select: { number: true, property: { select: { name: true } } } } } } },
  });
  const userIds = [...new Set(payments.map((x) => x.recordedById).filter((x): x is string => !!x))];
  const users = await db.user.findMany({ where: { id: { in: userIds }, organizationId: ctx.organizationId }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const confirmed = payments.filter((x) => x.status === "CONFIRMED");
  const collectorOf = (x: (typeof payments)[number]) => (x.submittedByTenant ? "rep.portal" : nameOf.get(x.recordedById ?? "") ?? UNASSIGNED);
  const summarize = (keyOf: (x: (typeof payments)[number]) => string) => {
    const m = new Map<string, { count: number; amount: Decimal }>();
    for (const x of confirmed) {
      const k = keyOf(x);
      const cur = m.get(k) ?? { count: 0, amount: money(0) };
      m.set(k, { count: cur.count + 1, amount: cur.amount.plus(money(x.amount)) });
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, count: v.count, amount: m2(v.amount) }));
  };
  const total = m2(sum(confirmed.map((x) => x.amount)));
  return {
    tables: [
      {
        columns: [
          { key: "reference", label: "rep.col.payment" },
          { key: "receipt", label: "rep.col.receipt" },
          { key: "tenant", label: "rep.col.tenant" },
          { key: "unit", label: "rep.col.unit" },
          { key: "method", label: "rep.col.method" },
          { key: "externalRef", label: "rep.col.externalRef" },
          { key: "collector", label: "rep.col.collector" },
          { key: "status", label: "rep.col.status", kind: "status" },
          { key: "amount", label: "rep.col.amount", kind: "money" },
        ],
        rows: payments.map((x) => ({
          reference: x.reference, receipt: x.receipt?.number ?? "", tenant: x.tenant.legalName,
          unit: x.lease ? `${x.lease.unit.property.name} ${x.lease.unit.number}` : UNASSIGNED,
          method: x.method, externalRef: x.externalRef ?? "", collector: collectorOf(x), status: x.status, amount: m2(money(x.amount)),
        })),
        totals: { reference: "rep.totalConfirmed", amount: total },
      },
      {
        title: "rep.byMethod",
        columns: [{ key: "key", label: "rep.col.method" }, { key: "count", label: "rep.col.count", kind: "number" }, { key: "amount", label: "rep.col.amount", kind: "money" }],
        rows: summarize((x) => x.method),
        totals: { key: "rep.total", count: confirmed.length, amount: total },
      },
      {
        title: "rep.byCollector",
        columns: [{ key: "key", label: "rep.col.collector" }, { key: "count", label: "rep.col.count", kind: "number" }, { key: "amount", label: "rep.col.amount", kind: "money" }],
        rows: summarize(collectorOf),
        totals: { key: "rep.total", count: confirmed.length, amount: total },
      },
    ],
  };
}

async function revenueByBuilding(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const [props, invoices, payments] = await Promise.all([
    db.property.findMany({ where: propWhere(ctx, s), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.invoice.findMany({ where: { ...invoiceScope(ctx, s), status: { notIn: ["DRAFT", "VOID"] }, issueDate: { gte: p.from, lte: p.to } }, select: { total: true, lease: { select: { unit: { select: { propertyId: true } } } } } }),
    db.payment.findMany({ where: { ...paymentScope(ctx, s), status: "CONFIRMED", paymentDate: { gte: p.from, lte: p.to } }, select: { amount: true, lease: { select: { unit: { select: { propertyId: true } } } } } }),
  ]);
  const row = (label: string, pid: string | null) => {
    const b = sum(invoices.filter((i) => (i.lease?.unit.propertyId ?? null) === pid).map((i) => i.total));
    const c = sum(payments.filter((x) => (x.lease?.unit.propertyId ?? null) === pid).map((x) => x.amount));
    return { building: label, billed: m2(b), collected: m2(c), rate: pct(c, b) };
  };
  const rows = props.map((pr) => row(pr.name, pr.id));
  if (s === "ALL") {
    const un = row(UNASSIGNED, null);
    if (money(un.billed).gt(0) || money(un.collected).gt(0)) rows.push({ ...un, building: "rep.unassigned" });
  }
  const tb = sum(invoices.map((i) => i.total));
  const tc = sum(payments.map((x) => x.amount));
  return {
    tables: [{
      columns: [
        { key: "building", label: "rep.col.building" },
        { key: "billed", label: "rep.col.billed", kind: "money" },
        { key: "collected", label: "rep.col.collected", kind: "money" },
        { key: "rate", label: "rep.col.collectionRate", kind: "percent" },
      ],
      rows,
      totals: { building: "rep.total", billed: m2(tb), collected: m2(tc), rate: pct(tc, tb) },
    }],
  };
}

async function paymentMethods(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const groups = await db.payment.groupBy({
    by: ["method", "status"],
    where: { ...paymentScope(ctx, s), paymentDate: { gte: p.from, lte: p.to } },
    _count: { _all: true },
    _sum: { amount: true },
  });
  const methods = [...new Set(groups.map((g) => g.method))].sort();
  const get = (m: string | null, st: string) => groups.filter((g) => (m === null || g.method === m) && g.status === st);
  const row = (label: string, m: string | null) => {
    const c = get(m, "CONFIRMED"), pe = get(m, "PENDING"), rj = [...get(m, "REJECTED"), ...get(m, "REVERSED")];
    return {
      method: label,
      confirmedCount: c.reduce((a, g) => a + g._count._all, 0),
      confirmed: m2(sum(c.map((g) => money(g._sum.amount)))),
      pendingCount: pe.reduce((a, g) => a + g._count._all, 0),
      pending: m2(sum(pe.map((g) => money(g._sum.amount)))),
      rejectedCount: rj.reduce((a, g) => a + g._count._all, 0),
    };
  };
  const rows = methods.map((m) => row(m, m));
  const totals = row("rep.total", null);
  const totalConfirmed = money(totals.confirmed);
  return {
    tables: [{
      columns: [
        { key: "method", label: "rep.col.method" },
        { key: "confirmedCount", label: "rep.col.confirmedCount", kind: "number" },
        { key: "confirmed", label: "rep.col.confirmedAmount", kind: "money" },
        { key: "share", label: "rep.col.share", kind: "percent" },
        { key: "pendingCount", label: "rep.col.pendingCount", kind: "number" },
        { key: "pending", label: "rep.col.pendingAmount", kind: "money" },
        { key: "rejectedCount", label: "rep.col.rejectedCount", kind: "number" },
      ],
      rows: rows.map((r) => ({ ...r, share: pct(money(r.confirmed), totalConfirmed) })),
      totals: { ...totals, share: totalConfirmed.gt(0) ? 100 : null },
    }],
  };
}

async function depositLiability(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const deposits = await db.securityDeposit.findMany({
    where: { organizationId: ctx.organizationId, lease: leaseScope(ctx, s), status: { notIn: ["REFUNDED", "FORFEITED"] } },
    take: LIMIT,
    include: {
      transactions: { where: { status: "APPROVED" } },
      lease: { select: { reference: true, status: true, tenant: { select: { legalName: true } }, unit: { select: { number: true, property: { select: { name: true } } } } } },
    },
  });
  const rows = deposits.map((d) => {
    const by = (type: string) => sum(d.transactions.filter((x) => x.type === type).map((x) => x.amount));
    const received = by("RECEIPT"), deducted = by("DEDUCTION"), refunded = by("REFUND");
    return {
      tenant: d.lease.tenant.legalName, building: d.lease.unit.property.name, unit: d.lease.unit.number, lease: d.lease.reference,
      leaseStatus: d.lease.status, status: d.status, required: m2(money(d.required)), received: m2(received), deducted: m2(deducted),
      refunded: m2(refunded), held: m2(received.minus(deducted).minus(refunded)), shortfall: m2(money(d.required).minus(received).isNegative() ? money(0) : money(d.required).minus(received)),
    };
  }).sort((a, b) => a.building.localeCompare(b.building) || a.unit.localeCompare(b.unit));
  const tot = (k: "required" | "received" | "deducted" | "refunded" | "held" | "shortfall") => m2(sum(rows.map((r) => r[k])));
  return {
    tables: [{
      columns: [
        { key: "tenant", label: "rep.col.tenant" },
        { key: "building", label: "rep.col.building" },
        { key: "unit", label: "rep.col.unit" },
        { key: "lease", label: "rep.col.lease" },
        { key: "leaseStatus", label: "rep.col.leaseStatus", kind: "status" },
        { key: "status", label: "rep.col.depositStatus", kind: "status" },
        { key: "required", label: "rep.col.required", kind: "money" },
        { key: "received", label: "rep.col.received", kind: "money" },
        { key: "deducted", label: "rep.col.deducted", kind: "money" },
        { key: "refunded", label: "rep.col.refunded", kind: "money" },
        { key: "held", label: "rep.col.held", kind: "money" },
        { key: "shortfall", label: "rep.col.shortfall", kind: "money" },
      ],
      rows,
      totals: { tenant: "rep.total", building: `${rows.length}`, required: tot("required"), received: tot("received"), deducted: tot("deducted"), refunded: tot("refunded"), held: tot("held"), shortfall: tot("shortfall") },
    }],
  };
}

async function expensesByCategory(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const groups = await db.expense.groupBy({
    by: ["category", "status"],
    where: { ...expenseScope(ctx, s), expenseDate: { gte: p.from, lte: p.to } },
    _count: { _all: true },
    _sum: { amount: true },
  });
  const row = (label: string, cat: string | null) => {
    const g = groups.filter((x) => cat === null || x.category === cat);
    const amt = (st: string) => sum(g.filter((x) => x.status === st).map((x) => money(x._sum.amount)));
    return {
      category: label,
      count: g.reduce((a, x) => a + x._count._all, 0),
      pending: m2(amt("PENDING_APPROVAL")),
      approved: m2(amt("APPROVED")),
      paid: m2(amt("PAID")),
      committed: m2(amt("APPROVED").plus(amt("PAID"))),
      rejected: m2(amt("REJECTED")),
    };
  };
  const cats = [...new Set(groups.map((g) => g.category))].sort();
  return {
    tables: [{
      columns: [
        { key: "category", label: "rep.col.category" },
        { key: "count", label: "rep.col.count", kind: "number" },
        { key: "pending", label: "rep.col.pendingApproval", kind: "money" },
        { key: "approved", label: "rep.col.approved", kind: "money" },
        { key: "paid", label: "rep.col.paidExpenses", kind: "money" },
        { key: "committed", label: "rep.col.committed", kind: "money" },
        { key: "rejected", label: "rep.col.rejected", kind: "money" },
      ],
      rows: cats.map((c) => row(c, c)),
      totals: row("rep.total", null),
    }],
  };
}

async function netOperating(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  const s = scopeOf(ctx, p.propertyId);
  const [props, payments, expenses] = await Promise.all([
    db.property.findMany({ where: propWhere(ctx, s), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.payment.findMany({ where: { ...paymentScope(ctx, s), status: "CONFIRMED", paymentDate: { gte: p.from, lte: p.to } }, select: { amount: true, lease: { select: { unit: { select: { propertyId: true } } } } } }),
    db.expense.findMany({ where: { ...expenseScope(ctx, s), status: { in: ["APPROVED", "PAID"] }, expenseDate: { gte: p.from, lte: p.to } }, select: { amount: true, propertyId: true } }),
  ]);
  const row = (label: string, pid: string | null) => {
    const inc = sum(payments.filter((x) => (x.lease?.unit.propertyId ?? null) === pid).map((x) => x.amount));
    const exp = sum(expenses.filter((e) => e.propertyId === pid).map((e) => e.amount));
    return { building: label, income: m2(inc), expenses: m2(exp), net: m2(inc.minus(exp)), margin: pct(inc.minus(exp), inc) };
  };
  const rows = props.map((pr) => row(pr.name, pr.id));
  if (s === "ALL") {
    const un = row(UNASSIGNED, null);
    if (money(un.income).gt(0) || money(un.expenses).gt(0)) rows.push({ ...un, building: "rep.unassigned" });
  }
  const ti = sum(payments.map((x) => x.amount));
  const te = sum(expenses.map((e) => e.amount));
  return {
    tables: [{
      columns: [
        { key: "building", label: "rep.col.building" },
        { key: "income", label: "rep.col.collected", kind: "money" },
        { key: "expenses", label: "rep.col.expenses", kind: "money" },
        { key: "net", label: "rep.col.net", kind: "money" },
        { key: "margin", label: "rep.col.margin", kind: "percent" },
      ],
      rows,
      totals: { building: "rep.total", income: m2(ti), expenses: m2(te), net: m2(ti.minus(te)), margin: pct(ti.minus(te), ti) },
    }],
  };
}

async function ownerStatement(ctx: AuthContext, p: ReportParams): Promise<ReportResult> {
  if (!p.propertyId) return { tables: [], notice: "rep.selectBuilding" };
  const s = scopeOf(ctx, p.propertyId);
  if (s !== "ALL" && s.length === 0) return { tables: [], notice: "rep.selectBuilding" };
  const [y, mo] = p.month.split("-").map(Number);
  const from = monthStart(y, mo - 1);
  const to = new Date(monthStart(y, mo).getTime() - DAY);
  const [payments, expenses] = await Promise.all([
    db.payment.findMany({
      where: { ...paymentScope(ctx, s), status: "CONFIRMED", paymentDate: { gte: from, lte: to } },
      orderBy: { paymentDate: "asc" },
      include: { tenant: { select: { legalName: true } }, lease: { select: { unit: { select: { number: true } } } } },
    }),
    db.expense.findMany({
      where: { ...expenseScope(ctx, s), status: { in: ["APPROVED", "PAID"] }, expenseDate: { gte: from, lte: to } },
      orderBy: { expenseDate: "asc" },
      include: { vendor: { select: { name: true } } },
    }),
  ]);
  const rows: Record<string, Cell>[] = [
    ...payments.map((x) => ({ date: iso(x.paymentDate), type: "INCOME", description: `${x.tenant.legalName}${x.lease ? ` · ${x.lease.unit.number}` : ""} (${x.method})`, reference: x.reference, income: m2(money(x.amount)), expense: null })),
    ...expenses.map((e) => ({ date: iso(e.expenseDate), type: "EXPENSE", description: `${e.category} · ${e.description}${e.vendor ? ` · ${e.vendor.name}` : ""}`, reference: e.billReference, income: null, expense: m2(money(e.amount)) })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const ti = sum(payments.map((x) => x.amount));
  const te = sum(expenses.map((e) => e.amount));
  const byCat = new Map<string, Decimal>();
  for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? money(0)).plus(money(e.amount)));
  return {
    tables: [
      {
        title: "rep.summary",
        columns: [{ key: "item", label: "rep.col.item" }, { key: "amount", label: "rep.col.amount", kind: "money" }],
        rows: [
          { item: "rep.os.income", amount: m2(ti) },
          ...[...byCat.entries()].map(([c, v]) => ({ item: `${c}`, amount: m2(v.negated()) })),
          { item: "rep.os.expenses", amount: m2(te.negated()) },
        ],
        totals: { item: "rep.os.net", amount: m2(ti.minus(te)) },
      },
      {
        title: "rep.details",
        columns: [
          { key: "date", label: "rep.col.date", kind: "day" },
          { key: "type", label: "rep.col.type", kind: "status" },
          { key: "description", label: "rep.col.description" },
          { key: "reference", label: "rep.col.reference" },
          { key: "income", label: "rep.col.income", kind: "money" },
          { key: "expense", label: "rep.col.expenses", kind: "money" },
        ],
        rows,
        totals: { date: "rep.total", income: m2(ti), expense: m2(te) },
      },
    ],
  };
}

// ───────────────────────── Catalogue ─────────────────────────

const CONCIERGE: Permission[] = ["concierge.visitors.manage", "concierge.parcels.manage", "concierge.incidents.manage", "concierge.shifts.manage"];

export const REPORTS: ReportDef[] = [
  { key: "building-register", group: "operational", filters: ["property"], requires: ["unit.view"], run: buildingRegister },
  { key: "occupancy", group: "operational", filters: ["property"], run: occupancy },
  { key: "tenant-directory", group: "operational", filters: ["property"], requires: ["tenant.view"], run: tenantDirectory },
  { key: "lease-expirations", group: "operational", filters: ["property", "days"], requires: ["lease.view"], run: leaseExpirations },
  { key: "move-in-out", group: "operational", filters: ["property", "range"], requires: ["lease.view"], run: moveInOut },
  { key: "maintenance-volume", group: "operational", filters: ["property", "range"], run: maintenanceVolume },
  {
    key: "visitors-incidents", group: "operational", filters: ["property", "range"], run: visitorsIncidents,
    visible: (ctx) => can(ctx, "report.operational.view") || hasAnyPermission(ctx.permissions, CONCIERGE),
  },
  { key: "rent-roll", group: "financial", filters: ["property"], run: rentRoll },
  { key: "billed-collected", group: "financial", filters: ["property", "range"], run: billedCollected },
  { key: "collection-rate", group: "financial", filters: ["property", "range"], run: collectionRate },
  { key: "tenant-balances", group: "financial", filters: ["property"], run: tenantBalances },
  { key: "arrears-aging", group: "financial", filters: ["property"], run: arrearsAging },
  { key: "daily-collection", group: "financial", filters: ["property", "date"], run: dailyCollection },
  { key: "revenue-by-building", group: "financial", filters: ["property", "range"], run: revenueByBuilding },
  { key: "payment-methods", group: "financial", filters: ["property", "range"], run: paymentMethods },
  { key: "deposit-liability", group: "financial", filters: ["property"], run: depositLiability },
  { key: "expenses-by-category", group: "financial", filters: ["property", "range"], requires: ["expense.view"], run: expensesByCategory },
  { key: "net-operating", group: "financial", filters: ["property", "range"], run: netOperating },
  { key: "owner-statement", group: "financial", filters: ["property", "month"], run: ownerStatement },
];

export const GROUP_PERMISSION: Record<ReportDef["group"], Permission> = {
  operational: "report.operational.view",
  financial: "report.financial.view",
};

export function getReport(key: string) {
  return REPORTS.find((r) => r.key === key) ?? null;
}

export function canViewReport(ctx: AuthContext, def: ReportDef) {
  const base = def.visible ? def.visible(ctx) : can(ctx, GROUP_PERMISSION[def.group]);
  return base && (def.requires ?? []).every((perm) => can(ctx, perm));
}

export function visibleReports(ctx: AuthContext) {
  return REPORTS.filter((r) => canViewReport(ctx, r));
}

// ───────────────────────── CSV ─────────────────────────

/** Escapes a CSV cell and neutralizes spreadsheet formulas (=, +, -, @, tab, CR prefixes). */
export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  const numeric = typeof v === "number" || /^-?\d+(\.\d+)?$/.test(s);
  if (!numeric && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(result: ReportResult, label: (key: string) => string, cellText: (c: Cell, kind?: ColumnKind) => Cell = (c) => c) {
  const lines: string[] = [];
  result.tables.forEach((tbl, i) => {
    if (i > 0) lines.push("");
    if (tbl.title) lines.push(csvCell(label(tbl.title)));
    lines.push(tbl.columns.map((c) => csvCell(label(c.label))).join(","));
    for (const r of tbl.rows) lines.push(tbl.columns.map((c) => csvCell(cellText(r[c.key] ?? null, c.kind))).join(","));
    if (tbl.totals) lines.push(tbl.columns.map((c) => csvCell(cellText(tbl.totals![c.key] ?? null, c.kind))).join(","));
  });
  return lines.join("\r\n");
}
