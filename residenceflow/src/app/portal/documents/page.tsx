import { db } from "@/lib/db";
import { formatDay } from "@/lib/format";
import { Badge, EmptyState, PageHeader, Pagination, parsePage } from "@/components/ui";
import { portalPage } from "../kit";

export const metadata = { title: "Documents" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;
const FINANCIAL = ["INVOICE", "RECEIPT", "PAYMENT_PROOF", "LEASE"];

export default async function PortalDocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, tenantId, t, df, occupant } = await portalPage();
  const page = parsePage((await searchParams).page);
  // Same rule as canAccessDocument for portal users: own + visibleToTenant + not sensitive.
  const where = {
    organizationId: ctx.organizationId,
    tenantId,
    visibleToTenant: true,
    sensitive: false,
    ...(occupant ? { category: { notIn: FINANCIAL } } : {}),
  };
  const [total, docs] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, category: true, size: true, createdAt: true, expiresAt: true, version: true },
    }),
  ]);
  return (
    <>
      <PageHeader title={t("nav.portal.documents")} description={t("portal.docs.subtitle")} />
      {docs.length === 0 ? (
        <EmptyState title={t("portal.docs.none")} />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <a href={`/api/documents/${d.id}`} className="break-all font-medium text-[var(--brand)] hover:underline">{d.name}</a>
                <div className="text-xs text-slate-500">
                  {formatDay(d.createdAt, df)} · {Math.max(1, Math.round(d.size / 1024))} KB · v{d.version}
                  {d.expiresAt ? ` · ${t("portal.docs.expires")} ${formatDay(d.expiresAt, df)}` : ""}
                </div>
              </div>
              <Badge tone="slate">{t(`portal.docCat.${d.category}`)}</Badge>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/portal/documents" />
    </>
  );
}
