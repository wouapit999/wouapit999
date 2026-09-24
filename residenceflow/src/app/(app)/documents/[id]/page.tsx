import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime, formatDay } from "@/lib/format";
import { canAccessDocument } from "@/lib/storage";
import { Badge, Card, DescriptionList, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { UploadForm } from "../upload-form";
import { documentMessages } from "../i18n";

export const metadata = { title: "Document" };
export const dynamic = "force-dynamic";

const META = {
  id: true, organizationId: true, name: true, category: true, mimeType: true, size: true, checksum: true, version: true, previousId: true,
  tenantId: true, propertyId: true, leaseId: true, workOrderId: true, visibleToTenant: true, sensitive: true, expiresAt: true,
  scanStatus: true, uploadedById: true, createdAt: true,
} as const;

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("document.view");
  const { t } = await getT(documentMessages);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const org = ctx.organizationId;
  const doc = await db.document.findFirst({ where: { id, organizationId: org }, select: META });
  if (!doc || !(await canAccessDocument(ctx, doc))) notFound();
  const settings = await getOrgSettings(org);
  const df = { dateFormat: settings?.dateFormat ?? "dd/MM/yyyy", timezone: settings?.timezone ?? "Africa/Douala" };

  // Version chain: walk back through previousId, then forward through documents replacing this one.
  const chain = [doc];
  let cursor = doc.previousId;
  for (let i = 0; cursor && i < 50; i++) {
    const prev = await db.document.findFirst({ where: { id: cursor, organizationId: org }, select: META });
    if (!prev) break;
    chain.unshift(prev);
    cursor = prev.previousId;
  }
  let head = doc;
  for (let i = 0; i < 50; i++) {
    const next = await db.document.findFirst({ where: { previousId: head.id, organizationId: org }, select: META, orderBy: { createdAt: "desc" } });
    if (!next) break;
    chain.push(next);
    head = next;
  }
  const allowed = await Promise.all(chain.map((d) => canAccessDocument(ctx, d)));
  const versions = chain.filter((_, i) => allowed[i]).reverse();
  const isLatest = head.id === doc.id;

  const [property, tenant, lease, uploader] = await Promise.all([
    doc.propertyId ? db.property.findFirst({ where: { id: doc.propertyId, organizationId: org }, select: { id: true, name: true } }) : null,
    doc.tenantId ? db.tenant.findFirst({ where: { id: doc.tenantId, organizationId: org }, select: { id: true, legalName: true } }) : null,
    doc.leaseId ? db.lease.findFirst({ where: { id: doc.leaseId, organizationId: org }, select: { id: true, reference: true } }) : null,
    doc.uploadedById ? db.user.findFirst({ where: { id: doc.uploadedById }, select: { name: true } }) : null,
  ]);

  return (
    <>
      <PageHeader
        title={doc.name}
        description={`${t(`doc.cat.${doc.category}`)} · v${doc.version}`}
        breadcrumbs={[{ label: t("doc.title"), href: "/documents" }, { label: doc.name }]}
        actions={
          <>
            <LinkButton href={`/api/documents/${doc.id}`}>{t("doc.download")}</LinkButton>
            {doc.mimeType !== "text/csv" && <a className="inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800" target="_blank" rel="noopener noreferrer" href={`/api/documents/${doc.id}?inline=1`}>{t("doc.preview")}</a>}
          </>
        }
      />
      {!isLatest && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t("doc.olderVersion")} <Link className="font-medium underline" href={`/documents/${head.id}`}>{t("doc.openLatest")}</Link>
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("doc.details")}>
            <DescriptionList
              items={[
                { label: t("doc.category"), value: t(`doc.cat.${doc.category}`) },
                { label: t("doc.type"), value: `${doc.mimeType} · ${Math.max(1, Math.round(doc.size / 1024))} KB` },
                { label: t("common.building"), value: property ? (can(ctx, "building.view") ? <Link className="hover:underline" href={`/properties/${property.id}`}>{property.name}</Link> : property.name) : null },
                { label: t("common.tenant"), value: tenant ? (can(ctx, "tenant.view") ? <Link className="hover:underline" href={`/tenants/${tenant.id}`}>{tenant.legalName}</Link> : tenant.legalName) : null },
                { label: t("doc.lease"), value: lease ? (can(ctx, "lease.view") ? <Link className="hover:underline" href={`/leases/${lease.id}`}>{lease.reference}</Link> : lease.reference) : null },
                { label: t("doc.uploaded"), value: `${formatDateTime(doc.createdAt, df)}${uploader ? ` · ${uploader.name}` : ""}` },
                { label: t("doc.expiresAt"), value: doc.expiresAt ? formatDay(doc.expiresAt, df) : null },
                {
                  label: t("doc.flags"),
                  value: (
                    <span className="flex flex-wrap gap-1">
                      {doc.sensitive ? <Badge tone="red">{t("doc.sensitiveBadge")}</Badge> : <Badge tone="slate">{t("doc.notSensitive")}</Badge>}
                      {doc.visibleToTenant ? <Badge tone="blue">{t("doc.tenantVisible")}</Badge> : <Badge tone="slate">{t("doc.staffOnly")}</Badge>}
                    </span>
                  ),
                },
                { label: t("doc.scan"), value: doc.scanStatus },
                { label: t("doc.checksum"), value: <span className="break-all font-mono text-xs">{doc.checksum}</span> },
              ]}
            />
          </Card>
          <Card title={t("doc.history")}>
            <Table>
              <thead>
                <tr>
                  <Th>{t("doc.version")}</Th>
                  <Th>{t("common.name")}</Th>
                  <Th>{t("doc.uploaded")}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {versions.map((v) => (
                  <Tr key={v.id}>
                    <Td>v{v.version} {v.id === head.id && <Badge tone="green">{t("doc.current")}</Badge>}</Td>
                    <Td>{v.id === doc.id ? <strong>{v.name}</strong> : <Link className="text-[var(--brand)] hover:underline" href={`/documents/${v.id}`}>{v.name}</Link>}</Td>
                    <Td className="whitespace-nowrap">{formatDateTime(v.createdAt, df)}</Td>
                    <Td><a className="text-sm text-[var(--brand)] hover:underline" href={`/api/documents/${v.id}`}>{t("doc.download")}</a></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
        {can(ctx, "document.upload") && isLatest && (
          <Card title={t("doc.newVersion")}>
            <UploadForm t={t} properties={[]} tenants={[]} previousId={doc.id} requireLink={false} canSensitive={can(ctx, "document.sensitive.view")} defaultSensitive={doc.sensitive} />
          </Card>
        )}
      </div>
    </>
  );
}
