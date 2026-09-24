import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/format";
import { InlineAction } from "@/components/forms";
import { Badge, Card, DescriptionList, LinkButton, PageHeader, Table, Td, Th, Tr, EmptyState } from "@/components/ui";
import { archivePropertyAction } from "../actions";
import { propertyMessages } from "../messages";

export const metadata = { title: "Building" };

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("building.view");
  const { t, locale } = await getT(propertyMessages);
  const property = await db.property.findFirst({
    where: { ...propertyWhere(ctx), id },
    include: {
      owner: { select: { name: true } },
      units: {
        orderBy: [{ block: "asc" }, { floor: "asc" }, { number: "asc" }],
        include: { leases: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, include: { tenant: { select: { legalName: true, id: true } } } } },
      },
      scopes: { include: { user: { select: { name: true, roles: { include: { role: { select: { name: true } } } } } } } },
    },
  });
  if (!property) notFound();
  const settings = await getOrgSettings(ctx.organizationId);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const showTenants = can(ctx, "tenant.view");
  const showRent = can(ctx, "unit.view");

  return (
    <>
      <PageHeader
        title={property.name}
        description={`${property.reference} · ${t(`prop.type.${property.type}`)}`}
        breadcrumbs={[{ label: t("prop.title"), href: "/properties" }, { label: property.name }]}
        actions={
          <>
            {can(ctx, "unit.manage") && <LinkButton href={`/units/new?propertyId=${property.id}`}>{t("prop.addUnit")}</LinkButton>}
            {can(ctx, "building.update") && <LinkButton variant="secondary" href={`/properties/${property.id}/edit`}>{t("common.edit")}</LinkButton>}
            {can(ctx, "building.archive") && property.status !== "ARCHIVED" && (
              <InlineAction action={archivePropertyAction} label={t("prop.archive")} variant="danger" confirm={t("prop.archiveConfirm")} hidden={{ id: property.id }} />
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={t("prop.units")}>
          {property.units.length === 0 ? (
            <EmptyState title={t("common.empty")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("common.unit")}</Th>
                  <Th>Type</Th>
                  {showRent && <Th>Rent</Th>}
                  {showTenants && <Th>{t("common.tenant")}</Th>}
                  <Th>{t("common.status")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {property.units.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      <Link className="font-medium text-[var(--brand)] hover:underline" href={`/units/${u.id}`}>
                        {u.block ? `${u.block} · ` : ""}{u.number}
                      </Link>
                      <div className="text-xs text-slate-500">Floor {u.floor}</div>
                    </Td>
                    <Td>{u.type} · {u.bedrooms} bd</Td>
                    {showRent && <Td>{formatMoney(u.defaultRent, fmt)}</Td>}
                    {showTenants && (
                      <Td>
                        {u.leases[0] ? <Link className="hover:underline" href={`/tenants/${u.leases[0].tenant.id}`}>{u.leases[0].tenant.legalName}</Link> : "—"}
                      </Td>
                    )}
                    <Td><Badge status={u.status} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Details">
            <DescriptionList
              items={[
                { label: t("common.status"), value: <Badge status={property.status}>{t(`prop.status.${property.status}`)}</Badge> },
                { label: t("prop.address"), value: [property.address, property.city].filter(Boolean).join(", ") },
                { label: t("prop.floors"), value: property.floors },
                { label: t("prop.blocks"), value: property.blocks },
                { label: t("prop.owner"), value: property.owner?.name },
                { label: t("prop.amenities"), value: property.amenities.join(", ") },
                { label: t("prop.utilities"), value: property.utilities },
                {
                  label: "Map",
                  value: property.latitude && property.longitude ? (
                    <a className="text-[var(--brand)] hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${property.latitude}&mlon=${property.longitude}#map=17/${property.latitude}/${property.longitude}`}>
                      {property.latitude.toString()}, {property.longitude.toString()}
                    </a>
                  ) : null,
                },
              ]}
            />
            {property.description && <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{property.description}</p>}
          </Card>
          {can(ctx, "users.view") && (
            <Card title={t("prop.staff")}>
              <ul className="space-y-1 text-sm">
                {property.scopes.map((s, i) => (
                  <li key={i}>{s.user.name} <span className="text-xs text-slate-500">({s.user.roles.map((r) => r.role.name).join(", ")})</span></li>
                ))}
                {property.scopes.length === 0 && <li className="text-slate-500">{t("common.none")}</li>}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
