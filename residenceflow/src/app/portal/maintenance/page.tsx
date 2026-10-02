import Link from "next/link";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { Badge, EmptyState, LinkButton, PageHeader, Pagination, parsePage } from "@/components/ui";
import { portalPage } from "../kit";

export const metadata = { title: "Maintenance" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

export default async function PortalMaintenancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, tenantId, t, df } = await portalPage();
  const page = parsePage((await searchParams).page);
  const where = { organizationId: ctx.organizationId, tenantId };
  const [total, rows] = await Promise.all([
    db.maintenanceRequest.count({ where }),
    db.maintenanceRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, number: true, title: true, category: true, priority: true, safetyIssue: true, status: true, createdAt: true, updatedAt: true },
    }),
  ]);
  return (
    <>
      <PageHeader
        title={t("nav.portal.maintenance")}
        description={t("portal.mnt.subtitle")}
        actions={<LinkButton href="/portal/maintenance/new">{t("portal.mnt.new")}</LinkButton>}
      />
      {rows.length === 0 ? (
        <EmptyState title={t("portal.mnt.none")} action={<LinkButton href="/portal/maintenance/new">{t("portal.mnt.new")}</LinkButton>} />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/portal/maintenance/${r.id}`} className="flex flex-wrap items-start justify-between gap-2 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 dark:text-white">{r.title}</div>
                  <div className="text-xs text-slate-500">
                    <span className="font-mono">{r.number}</span> · {t(`portal.cat.${r.category}`)} · {formatDateTime(r.createdAt, df)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {r.safetyIssue && <Badge tone="red">{t("portal.mnt.safety")}</Badge>}
                  {r.priority === "URGENT" && <Badge status="URGENT">{t("portal.prio.URGENT")}</Badge>}
                  <Badge status={r.status}>{t(`portal.wo.${r.status}`)}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/portal/maintenance" />
    </>
  );
}
