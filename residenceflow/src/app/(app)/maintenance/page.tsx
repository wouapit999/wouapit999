import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, maintenanceWhere, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { OPEN_WORK_ORDER_STATUSES } from "@/domain/work-order";
import { PRIORITY_RANK, WO_CATEGORIES, WO_PRIORITIES } from "@/services/maintenance";
import { Badge, EmptyState, FilterBar, LinkButton, PageHeader, Pagination, Select, parsePage, str } from "@/components/ui";
import { maintenanceMessages } from "./messages";

export const metadata = { title: "Maintenance" };
const PAGE_SIZE = 20;
const MAX_SORT = 2000;

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("maintenance.view");
  const { t } = await getT(maintenanceMessages);
  const sp = await searchParams;
  const state = ["open", "closed", "all"].includes(str(sp.state)) ? str(sp.state) : "open";
  const priority = (WO_PRIORITIES as readonly string[]).includes(str(sp.priority)) ? str(sp.priority) : "";
  const category = (WO_CATEGORIES as readonly string[]).includes(str(sp.category)) ? str(sp.category) : "";
  const propertyId = str(sp.propertyId);
  const mine = str(sp.mine) === "1" ? "1" : "";
  const page = parsePage(sp.page);

  const open = [...OPEN_WORK_ORDER_STATUSES];
  const where: Prisma.MaintenanceRequestWhereInput = {
    AND: [
      maintenanceWhere(ctx),
      state === "open" ? { status: { in: open } } : state === "closed" ? { status: { notIn: open } } : {},
      priority ? { priority } : {},
      category ? { category } : {},
      propertyId ? { propertyId } : {},
      mine ? { assignedToId: ctx.user.id } : {},
    ],
  };

  // Urgent and safety issues first: rank in memory on a light projection, then load the page.
  const [total, keys, buildings, settings] = await Promise.all([
    db.maintenanceRequest.count({ where }),
    db.maintenanceRequest.findMany({ where, select: { id: true, priority: true, safetyIssue: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: MAX_SORT }),
    db.property.findMany({ where: propertyWhere(ctx), orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getOrgSettings(ctx.organizationId),
  ]);
  keys.sort((a, b) => Number(b.safetyIssue) - Number(a.safetyIssue) || (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || b.createdAt.getTime() - a.createdAt.getTime());
  const pageIds = keys.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((k) => k.id);
  const rowsUnordered = await db.maintenanceRequest.findMany({
    where: { id: { in: pageIds } },
    include: { property: { select: { name: true } }, unit: { select: { number: true, block: true } }, assignedTo: { select: { name: true } }, vendor: { select: { name: true } } },
  });
  const rows = pageIds.map((id) => rowsUnordered.find((r) => r.id === id)!).filter(Boolean);
  const prefs = { timezone: settings?.timezone ?? "Africa/Douala", dateFormat: settings?.dateFormat };

  return (
    <>
      <PageHeader title={t("wo.title")} description={t("wo.subtitle")} actions={can(ctx, "maintenance.create") && <LinkButton href="/maintenance/new">{t("wo.new")}</LinkButton>} />
      <FilterBar action="/maintenance">
        <Select label={t("common.status")} name="state" defaultValue={state} options={["open", "closed", "all"].map((v) => ({ value: v, label: t(`wo.filter.${v}`) }))} wrapperClassName="w-40" />
        <Select label={t("wo.priority")} name="priority" defaultValue={priority} placeholder={t("common.all")} options={WO_PRIORITIES.map((v) => ({ value: v, label: t(`wo.priority.${v}`) }))} wrapperClassName="w-36" />
        <Select label={t("wo.category")} name="category" defaultValue={category} placeholder={t("common.all")} options={WO_CATEGORIES.map((v) => ({ value: v, label: t(`wo.category.${v}`) }))} wrapperClassName="w-48" />
        {buildings.length > 1 && <Select label={t("common.building")} name="propertyId" defaultValue={propertyId} placeholder={t("common.all")} options={buildings.map((b) => ({ value: b.id, label: b.name }))} wrapperClassName="w-48" />}
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" name="mine" value="1" defaultChecked={!!mine} className="h-4 w-4 accent-[var(--brand)]" />
          {t("wo.filter.mine")}
        </label>
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("wo.empty")} description={t("wo.emptyHint")} />
      ) : (
        <ul className="space-y-2">
          {rows.map((w) => (
            <li key={w.id}>
              <Link
                href={`/maintenance/${w.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:border-[var(--brand)] dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{w.number}</span>
                  <Badge status={w.status}>{t(`wo.status.${w.status}`)}</Badge>
                  <Badge status={w.priority}>{t(`wo.priority.${w.priority}`)}</Badge>
                  {w.safetyIssue && <Badge tone="red">⚠ {t("wo.safety")}</Badge>}
                </div>
                <p className="mt-1 font-medium text-slate-900 dark:text-white">{w.title}</p>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                  {w.property.name}
                  {w.unit ? ` · ${w.unit.block ? `${w.unit.block} · ` : ""}${w.unit.number}` : ` · ${t("wo.commonArea")}`}
                  {" · "}
                  {t(`wo.category.${w.category}`)}
                  {" · "}
                  {formatDateTime(w.createdAt, prefs)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t("wo.assignedTo")}: {[w.assignedTo?.name, w.vendor?.name].filter(Boolean).join(" / ") || t("wo.unassigned")}
                  {w.scheduledAt && ` · ${t("wo.scheduled")}: ${formatDateTime(w.scheduledAt, prefs)}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={Math.min(total, MAX_SORT)} basePath="/maintenance" params={{ state, priority, category, propertyId, mine }} />
    </>
  );
}
