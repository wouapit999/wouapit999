import Link from "next/link";
import { can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay, formatDateTime, formatMoney } from "@/lib/format";
import { AGING_BUCKETS } from "@/domain/aging";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { BilledCollectedChart, DonutChart, OccupancyTrendChart, SimpleBarChart } from "@/components/charts/charts";
import { conciergeMetrics, financialMetrics, myWorkOrders, occupancyTrend, operationalMetrics, recentAudit } from "@/services/dashboard";
import { dashboardMessages } from "./messages";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await requireContext("dashboard.view");
  const { t, locale } = await getT(dashboardMessages);
  const settings = await getOrgSettings(ctx.organizationId);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat ?? "dd/MM/yyyy", timezone: settings?.timezone ?? "Africa/Douala" };

  const showOps = can(ctx, "building.view") && ctx.scope !== "OWN";
  const showFinance = can(ctx, "dashboard.financial.view");
  const showConcierge = can(ctx, "concierge.visitors.manage");
  const showMyWork = can(ctx, "maintenance.view") && ctx.scope === "OWN";
  const showAudit = can(ctx, "audit.view");

  const [ops, trend, fin, desk, work, events] = await Promise.all([
    showOps ? operationalMetrics(ctx) : null,
    showOps ? occupancyTrend(ctx) : null,
    showFinance ? financialMetrics(ctx) : null,
    showConcierge ? conciergeMetrics(ctx) : null,
    showMyWork ? myWorkOrders(ctx) : null,
    showAudit ? recentAudit(ctx) : null,
  ]);

  return (
    <>
      <PageHeader title={t("dash.title")} description={t("dash.welcome", { name: ctx.user.name })} />

      {ops && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label={t("dash.buildings")} value={ops.buildings} href="/properties" />
          <Stat label={t("dash.units")} value={ops.totalUnits} href="/units" />
          <Stat label={t("dash.occupied")} value={ops.occupied} tone="good" />
          <Stat label={t("dash.vacant")} value={ops.vacant} tone={ops.vacant ? "warn" : "default"} href="/units?status=VACANT" />
          <Stat label={t("dash.maintenanceUnits")} value={ops.underMaintenance} />
          <Stat label={t("dash.occupancy")} value={`${ops.occupancyRate}%`} />
        </div>
      )}

      {fin && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label={t("dash.expected")} value={formatMoney(fin.expected, fmt)} />
          <Stat label={t("dash.collected")} value={formatMoney(fin.collected, fmt)} tone="good" href="/payments" />
          <Stat label={t("dash.collectionRate")} value={`${fin.collectionRate}%`} tone={fin.collectionRate < 80 ? "warn" : "good"} />
          <Stat label={t("dash.outstanding")} value={formatMoney(fin.outstanding, fmt)} href="/invoices" />
          <Stat label={t("dash.overdue")} value={formatMoney(fin.overdue, fmt)} tone={fin.overdue.gt(0) ? "bad" : "default"} href="/arrears" />
          <Stat label={t("dash.deposits")} value={formatMoney(fin.depositsHeld, fmt)} href="/deposits" />
        </div>
      )}

      {ops && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("dash.expiring")} value={`${ops.expiring.d30} / ${ops.expiring.d60} / ${ops.expiring.d90}`} hint={`${t("dash.days", { n: 30 })} / 60 / 90`} href="/leases?expiring=90" />
          <Stat label={t("dash.openWo")} value={ops.openWo} href="/maintenance" />
          <Stat label={t("dash.overdueWo")} value={ops.overdueWo} tone={ops.overdueWo ? "warn" : "default"} />
          {fin && <Stat label={t("dash.pendingPayments")} value={fin.pendingPayments} tone={fin.pendingPayments ? "warn" : "default"} href="/payments?status=PENDING" />}
        </div>
      )}

      {desk && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("dash.visitorsOnSite")} value={desk.onSite} href="/concierge/visitors" />
          <Stat label={t("dash.expectedVisitors")} value={desk.expected} href="/concierge/visitors" />
          <Stat label={t("dash.parcelsWaiting")} value={desk.parcels} href="/concierge/parcels" />
          <Stat label={t("dash.openIncidents")} value={desk.incidents} tone={desk.incidents ? "warn" : "default"} href="/concierge/incidents" />
        </div>
      )}

      {work && (
        <Card title={t("dash.myWork")} className="mt-6">
          {work.length === 0 ? <EmptyState title={t("common.empty")} /> : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {work.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/maintenance/${w.id}`} className="font-medium text-[var(--brand)] hover:underline">{w.number} · {w.title}</Link>
                  <span className="text-xs text-slate-500">{w.property.name}{w.unit ? ` · ${w.unit.number}` : ""}</span>
                  <span className="flex gap-1"><Badge status={w.priority} /><Badge status={w.status} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {fin && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card title={t("dash.billedVsCollected")} className="lg:col-span-2">
            <BilledCollectedChart data={fin.trend} labels={{ billed: t("dash.billed"), collected: t("dash.collectedShort") }} />
          </Card>
          <Card title={t("dash.aging")}>
            <table className="w-full text-sm">
              <tbody>
                {AGING_BUCKETS.map((b) => (
                  <tr key={b} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="py-1.5">{t(`aging.${b}`)}</td>
                    <td className="py-1.5 text-right font-medium">{formatMoney(fin.aging[b], fmt)}</td>
                  </tr>
                ))}
                <tr><td className="pt-2 font-semibold">{t("common.total")}</td><td className="pt-2 text-right font-semibold">{formatMoney(fin.aging.total, fmt)}</td></tr>
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {(trend || fin) && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {trend && <Card title={t("dash.occupancyTrend")}><OccupancyTrendChart data={trend} label={t("dash.occupancy")} /></Card>}
          {fin && fin.revenueByBuilding.length > 0 && <Card title={t("dash.revenueByBuilding")}><SimpleBarChart data={fin.revenueByBuilding} label={t("dash.collectedShort")} /></Card>}
          {fin && fin.expensesByCategory.length > 0 && <Card title={t("dash.expenseCategories")}><DonutChart data={fin.expensesByCategory} label={t("dash.expenseCategories")} /></Card>}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {fin && (
          <Card title={t("dash.recentPayments")}>
            {fin.recentPayments.length === 0 ? <EmptyState title={t("common.empty")} /> : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {fin.recentPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/payments/${p.id}`} className="hover:underline">{p.tenant.legalName}</Link>
                    <span className="text-xs text-slate-500">{formatDay(p.paymentDate, df)} · {p.method.replace(/_/g, " ")}</span>
                    <span className="flex items-center gap-2 font-medium">{formatMoney(p.amount, fmt)} <Badge status={p.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {ops && (
          <Card title={t("dash.upcomingExpirations")}>
            {ops.expiring.list.length === 0 ? <EmptyState title={t("common.empty")} /> : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {ops.expiring.list.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/leases/${l.id}`} className="hover:underline">{l.tenant.legalName}</Link>
                    <span className="text-xs text-slate-500">{l.unit.property.name} · {l.unit.number}</span>
                    <span className="font-medium">{formatDay(l.endDate, df)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {ops && (
          <Card title={t("dash.criticalMaintenance")}>
            {ops.urgentWo.length === 0 ? <EmptyState title={t("common.empty")} /> : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {ops.urgentWo.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/maintenance/${w.id}`} className="hover:underline">{w.number} · {w.title}</Link>
                    <span className="text-xs text-slate-500">{w.property.name}{w.unit ? ` · ${w.unit.number}` : ""}</span>
                    <span className="flex gap-1">{w.safetyIssue && <Badge tone="red">Safety</Badge>}<Badge status={w.priority} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {events && (
          <Card title={t("dash.recentAudit")} actions={<Link href="/admin/audit-logs" className="text-xs text-[var(--brand)] hover:underline">→</Link>}>
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="font-mono text-xs">{e.action}</span>
                  <span className="truncate text-xs text-slate-500">{e.actorName ?? "system"}</span>
                  <span className="text-xs text-slate-500">{formatDateTime(e.createdAt, df)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
