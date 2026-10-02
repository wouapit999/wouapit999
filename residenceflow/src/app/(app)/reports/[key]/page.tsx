import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { can, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { Alert, Input, PageHeader, Select, buttonClass } from "@/components/ui";
import { ReportTableView } from "@/components/reports/report-table";
import { canViewReport, getReport, iso, paramsToQuery, parseReportParams } from "@/services/reports";
import { reportMessages } from "../i18n";

export const metadata = { title: "Report" };
export const dynamic = "force-dynamic";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { key } = await params;
  const def = getReport(key);
  if (!def) notFound();
  const ctx = await requireContext();
  if (!canViewReport(ctx, def)) redirect("/unauthorized");
  const { t, locale } = await getT(reportMessages);
  const settings = await getOrgSettings(ctx.organizationId);
  const p = parseReportParams(key, await searchParams);
  const [properties, result] = await Promise.all([
    db.property.findMany({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    def.run(ctx, p),
  ]);
  const query = paramsToQuery(p, def.filters);
  const building = properties.find((x) => x.id === p.propertyId)?.name ?? t("rep.allBuildings");
  const currency = settings?.currency ?? "XAF";
  const dateFormat = settings?.dateFormat ?? "dd/MM/yyyy";
  const title = t(`rep.r.${def.key}`);

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={title}
          description={t(`rep.r.${def.key}.d`)}
          breadcrumbs={[{ label: t("rep.title"), href: "/reports" }, { label: title }]}
          actions={
            <>
              <PrintButton label={t("rep.print")} />
              {can(ctx, "report.export") && <a className={buttonClass("secondary")} href={`/api/reports/${def.key}?${query}`}>{t("rep.export")}</a>}
            </>
          }
        />
        <form method="get" action={`/reports/${def.key}`} className="mb-4 flex flex-wrap items-end gap-3">
          {def.filters.includes("property") && (
            <Select
              label={t("rep.f.building")}
              name="propertyId"
              defaultValue={p.propertyId}
              placeholder={def.key === "owner-statement" ? "" : t("rep.allBuildings")}
              required={def.key === "owner-statement"}
              options={properties.map((x) => ({ value: x.id, label: x.name }))}
              wrapperClassName="w-56"
            />
          )}
          {def.filters.includes("range") && (
            <>
              <Input label={t("rep.f.from")} name="from" type="date" defaultValue={iso(p.from)} wrapperClassName="w-40" />
              <Input label={t("rep.f.to")} name="to" type="date" defaultValue={iso(p.to)} wrapperClassName="w-40" />
            </>
          )}
          {def.filters.includes("date") && <Input label={t("rep.f.date")} name="date" type="date" defaultValue={iso(p.date)} wrapperClassName="w-40" />}
          {def.filters.includes("days") && (
            <Select label={t("rep.f.days")} name="days" defaultValue={String(p.days)} options={[30, 60, 90].map((n) => ({ value: String(n), label: t("rep.f.daysN", { n }) }))} wrapperClassName="w-44" />
          )}
          {def.filters.includes("month") && <Input label={t("rep.f.month")} name="month" type="month" defaultValue={p.month} wrapperClassName="w-40" />}
          <button type="submit" className={buttonClass("primary")}>{t("rep.run")}</button>
        </form>
      </div>

      {/* Print header */}
      <div className="mb-3 hidden print:block">
        <div className="text-lg font-semibold">{settings?.companyName || settings?.appName} — {title}</div>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        {t("rep.scope")}: {building}
        {def.filters.includes("range") ? ` · ${iso(p.from)} → ${iso(p.to)}` : ""}
        {def.filters.includes("date") ? ` · ${iso(p.date)}` : ""}
        {def.filters.includes("month") ? ` · ${p.month}` : ""}
        {" · "}
        {t("rep.generated", { date: formatDateTime(new Date(), { timezone: settings?.timezone ?? "Africa/Douala", dateFormat }), name: ctx.user.name })}
      </p>
      {result.notice && <div className="mb-4"><Alert tone="info">{t(result.notice)}</Alert></div>}
      <div className="space-y-6">
        {result.tables.map((tbl, i) => (
          <ReportTableView key={i} table={tbl} t={t} locale={locale} currency={currency} dateFormat={dateFormat} />
        ))}
      </div>
    </>
  );
}
