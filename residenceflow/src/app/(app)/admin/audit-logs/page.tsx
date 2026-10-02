import { db } from "@/lib/db";
import { can, requireContext } from "@/lib/auth/context";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/i18n";
import { Badge, EmptyState, FilterBar, Input, PageHeader, Pagination, Select, parsePage, str, buttonClass } from "@/components/ui";
import { auditWhere, type AuditFilters } from "@/services/admin";
import { adminMessages } from "../messages";

export const metadata = { title: "Audit log" };
const PAGE_SIZE = 50;

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-800 dark:bg-slate-800 dark:text-slate-200">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("audit.view");
  const { t } = await getT(adminMessages);
  const sp = await searchParams;
  const filters: AuditFilters = {
    actor: str(sp.actor).trim(),
    from: str(sp.from),
    to: str(sp.to),
    module: str(sp.module),
    action: str(sp.action).trim(),
    entityId: str(sp.entityId).trim(),
    result: str(sp.result),
  };
  const page = parsePage(sp.page);
  const settings = await getOrgSettings(ctx.organizationId);
  const tz = settings?.timezone ?? "UTC";
  const fmt = { timezone: tz, dateFormat: settings?.dateFormat };
  const where = auditWhere(ctx.organizationId, filters, tz);
  const [total, rows, modules] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.auditLog.findMany({ where: { organizationId: ctx.organizationId || "__none__" }, distinct: ["module"], select: { module: true }, orderBy: { module: "asc" } }),
  ]);
  const params = Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, v || undefined])) as Record<string, string | undefined>;
  const exportQs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title={t("adm.audit.title")}
        description={t("adm.audit.subtitle")}
        actions={can(ctx, "audit.export") && <a className={buttonClass("secondary")} href={`/api/audit-export${exportQs ? `?${exportQs}` : ""}`}>{t("common.export")}</a>}
      />
      <FilterBar action="/admin/audit-logs">
        <Input label={t("adm.audit.actor")} name="actor" defaultValue={filters.actor} wrapperClassName="w-full sm:w-44" />
        <Input label={t("adm.audit.from")} name="from" type="date" defaultValue={filters.from} wrapperClassName="w-full sm:w-40" />
        <Input label={t("adm.audit.to")} name="to" type="date" defaultValue={filters.to} wrapperClassName="w-full sm:w-40" />
        <Select label={t("adm.audit.module")} name="module" defaultValue={filters.module} placeholder={t("common.all")} options={modules.map((m) => ({ value: m.module, label: m.module }))} wrapperClassName="w-full sm:w-40" />
        <Input label={t("adm.audit.action")} name="action" defaultValue={filters.action} wrapperClassName="w-full sm:w-44" />
        <Input label={t("adm.audit.entityId")} name="entityId" defaultValue={filters.entityId} wrapperClassName="w-full sm:w-64" />
        <Select label={t("adm.audit.result")} name="result" defaultValue={filters.result} placeholder={t("common.all")} options={["SUCCESS", "FAILURE", "DENIED"].map((r) => ({ value: r, label: r }))} wrapperClassName="w-full sm:w-36" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("common.empty")} />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
          {rows.map((r) => (
            <li key={r.id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-col gap-1 px-3 py-2 text-sm hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-3 dark:hover:bg-slate-800/50">
                  <span className="whitespace-nowrap font-mono text-xs text-slate-500">{formatDateTime(r.createdAt, fmt)}</span>
                  <span className="font-medium">{r.action}</span>
                  <span className="text-xs text-slate-500">{r.module}</span>
                  <span className="text-xs sm:ml-auto">{r.actorName ?? t("adm.audit.system")}</span>
                  <Badge status={r.result}>{r.result}</Badge>
                </summary>
                <div className="space-y-2 bg-slate-50/50 px-3 pb-3 text-xs dark:bg-slate-900">
                  <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                    <div><dt className="inline text-slate-500">{t("adm.audit.entity")}: </dt><dd className="inline font-mono">{r.entityType ?? "—"} {r.entityId ?? ""}</dd></div>
                    <div><dt className="inline text-slate-500">IP: </dt><dd className="inline font-mono">{r.ip ?? "—"}</dd></div>
                    <div><dt className="inline text-slate-500">{t("adm.audit.correlation")}: </dt><dd className="inline font-mono">{r.correlationId ?? "—"}</dd></div>
                    <div><dt className="inline text-slate-500">{t("adm.audit.actorId")}: </dt><dd className="inline font-mono">{r.actorId ?? "—"}</dd></div>
                  </dl>
                  <div className="grid gap-2 lg:grid-cols-3">
                    <Json label={t("adm.audit.metadata")} value={r.metadata} />
                    <Json label={t("adm.audit.before")} value={r.before} />
                    <Json label={t("adm.audit.after")} value={r.after} />
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/audit-logs" params={params} />
    </>
  );
}
