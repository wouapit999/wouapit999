import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, propertyWhere, requireContext, tenantWhere } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay } from "@/lib/format";
import { Badge, Card, EmptyState, FilterBar, Input, PageHeader, Pagination, Select, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { DOCUMENT_CATEGORIES, documentScopeWhere } from "./scope";
import { UploadForm } from "./upload-form";
import { documentMessages } from "./i18n";

export const metadata = { title: "Documents" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("document.view");
  const { t } = await getT(documentMessages);
  const settings = await getOrgSettings(ctx.organizationId);
  const df = { dateFormat: settings?.dateFormat ?? "dd/MM/yyyy" };
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const category = str(sp.category);
  const propertyId = str(sp.propertyId);
  const tenantId = str(sp.tenantId);
  const expiring = str(sp.expiring) === "on";
  const allVersions = str(sp.versions) === "all";
  const page = parsePage(sp.page);

  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86_400_000);
  const [properties, tenants, superseded] = await Promise.all([
    db.property.findMany({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.tenant.findMany({ where: { ...tenantWhere(ctx), status: { in: ["ACTIVE", "FORMER"] } }, select: { id: true, legalName: true, reference: true }, orderBy: { legalName: "asc" }, take: 500 }),
    allVersions ? Promise.resolve([]) : db.document.findMany({ where: { organizationId: ctx.organizationId, previousId: { not: null } }, select: { previousId: true } }),
  ]);
  const supersededIds = superseded.map((d) => d.previousId).filter((x): x is string => !!x);

  const where: Prisma.DocumentWhereInput = {
    AND: [
      documentScopeWhere(ctx),
      category && (DOCUMENT_CATEGORIES as readonly string[]).includes(category) ? { category } : {},
      UUID.test(propertyId) ? { OR: [{ propertyId }, { lease: { unit: { propertyId } } }] } : {},
      UUID.test(tenantId) ? { tenantId } : {},
      expiring ? { expiresAt: { gte: now, lte: in30 } } : {},
      q ? { name: { contains: q, mode: "insensitive" } } : {},
      supersededIds.length ? { id: { notIn: supersededIds } } : {},
    ],
  };
  const [total, rows, expiringCount] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, name: true, category: true, size: true, version: true, createdAt: true, expiresAt: true, sensitive: true, visibleToTenant: true, scanStatus: true,
        property: { select: { name: true } },
        tenant: { select: { legalName: true } },
      },
    }),
    db.document.count({ where: { AND: [documentScopeWhere(ctx), { expiresAt: { gte: now, lte: in30 } }] } }),
  ]);

  return (
    <>
      <PageHeader title={t("doc.title")} description={t("doc.subtitle")} />
      <div className="grid gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <FilterBar action="/documents">
            <Input label={t("common.search")} name="q" defaultValue={q} wrapperClassName="w-44" />
            <Select label={t("doc.category")} name="category" defaultValue={category} placeholder={t("common.all")} options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: t(`doc.cat.${c}`) }))} wrapperClassName="w-40" />
            <Select label={t("common.building")} name="propertyId" defaultValue={propertyId} placeholder={t("common.all")} options={properties.map((p) => ({ value: p.id, label: p.name }))} wrapperClassName="w-44" />
            <Select label={t("common.tenant")} name="tenantId" defaultValue={tenantId} placeholder={t("common.all")} options={tenants.map((x) => ({ value: x.id, label: x.legalName }))} wrapperClassName="w-44" />
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="expiring" defaultChecked={expiring} className="h-4 w-4 accent-[var(--brand)]" />{t("doc.expiringSoon")} ({expiringCount})</label>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="versions" value="all" defaultChecked={allVersions} className="h-4 w-4 accent-[var(--brand)]" />{t("doc.allVersions")}</label>
          </FilterBar>
          {rows.length === 0 ? (
            <EmptyState title={t("doc.none")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("common.name")}</Th>
                  <Th>{t("doc.category")}</Th>
                  <Th>{t("doc.linkedTo")}</Th>
                  <Th>{t("doc.uploaded")}</Th>
                  <Th>{t("doc.expiresAt")}</Th>
                  <Th>{t("doc.flags")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((d) => {
                  const soon = d.expiresAt && d.expiresAt >= now && d.expiresAt <= in30;
                  const expired = d.expiresAt && d.expiresAt < now;
                  return (
                    <Tr key={d.id}>
                      <Td>
                        <Link href={`/documents/${d.id}`} className="break-all font-medium text-[var(--brand)] hover:underline">{d.name}</Link>
                        <div className="text-xs text-slate-500">v{d.version} · {Math.max(1, Math.round(d.size / 1024))} KB</div>
                      </Td>
                      <Td>{t(`doc.cat.${d.category}`)}</Td>
                      <Td className="text-xs">{[d.property?.name, d.tenant?.legalName].filter(Boolean).join(" · ") || "—"}</Td>
                      <Td className="whitespace-nowrap">{formatDay(d.createdAt, df)}</Td>
                      <Td className="whitespace-nowrap">
                        {d.expiresAt ? formatDay(d.expiresAt, df) : "—"}
                        {soon && <div><Badge tone="amber">{t("doc.expiringSoon")}</Badge></div>}
                        {expired && <div><Badge tone="red">{t("doc.expired")}</Badge></div>}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {d.sensitive && <Badge tone="red">{t("doc.sensitiveBadge")}</Badge>}
                          {d.visibleToTenant && <Badge tone="blue">{t("doc.tenantVisible")}</Badge>}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/documents" params={{ q, category, propertyId, tenantId, expiring: expiring ? "on" : undefined, versions: allVersions ? "all" : undefined }} />
        </div>
        {can(ctx, "document.upload") && (
          <Card title={t("doc.upload")}>
            <UploadForm t={t} properties={properties} tenants={tenants} requireLink={ctx.propertyIds !== "ALL"} canSensitive={can(ctx, "document.sensitive.view")} />
          </Card>
        )}
      </div>
    </>
  );
}
