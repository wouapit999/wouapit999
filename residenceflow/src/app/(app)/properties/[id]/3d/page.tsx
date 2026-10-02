import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { buildModel, ROOM_COLORS, STATUS_COLORS } from "@/domain/building-3d";
import { BuildingViewerLoader } from "@/components/three/building-viewer-loader";
import { propertyMessages } from "../../messages";
import { threeDMessages } from "./messages";

export const metadata = { title: "3D view" };
export const dynamic = "force-dynamic";

export default async function Property3DPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ unit?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireContext("building.view");
  const { t, locale } = await getT(threeDMessages, propertyMessages);
  const property = await db.property.findFirst({
    where: { ...propertyWhere(ctx), id },
    include: {
      units: {
        where: { archived: false },
        orderBy: [{ block: "asc" }, { floor: "asc" }, { number: "asc" }],
        include: { leases: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, include: { tenant: { select: { legalName: true } } }, take: 1 } },
      },
    },
  });
  if (!property) notFound();
  const settings = await getOrgSettings(ctx.organizationId);
  const showTenants = can(ctx, "tenant.view");
  const showRent = can(ctx, "unit.view");
  const fmt = { locale, currency: settings?.currency ?? "XAF" };

  const model = buildModel(
    { floors: property.floors, blocks: property.blocks },
    property.units.map((u) => ({
      id: u.id, number: u.number, block: u.block, floor: u.floor, type: u.type, bedrooms: u.bedrooms, bathrooms: u.bathrooms,
      area: u.area ? Number(u.area) : null, status: u.status,
      tenantName: showTenants ? u.leases[0]?.tenant.legalName ?? null : null,
      rent: showRent ? formatMoney(u.defaultRent, fmt) : null,
    })),
  );
  const pick = (prefix: string, keys: string[]) => Object.fromEntries(keys.map((k) => [k, t(`${prefix}.${k}`)]));
  const labels = {
    floor: t("3d.floor"), ground: t("3d.ground"), allFloors: t("3d.allFloors"), explode: t("3d.explode"), interior: t("3d.interior"),
    close: t("3d.close"), openUnit: t("3d.openUnit"), legend: t("3d.legend"), tenant: t("3d.tenant"), rent: t("3d.rent"), area: t("3d.area"),
    bedrooms: t("3d.bedrooms"), bathrooms: t("3d.bathrooms"), block: t("3d.block"), noUnits: t("3d.noUnits"), controlsHint: t("3d.controlsHint"),
    statuses: pick("3d.status", Object.keys(STATUS_COLORS)),
    rooms: pick("3d.room", Object.keys(ROOM_COLORS)),
    types: pick("3d.type", ["APARTMENT", "STUDIO", "SHOP", "OFFICE", "HOUSE", "ROOM"]),
  };
  const initialUnitId = sp.unit && property.units.some((u) => u.id === sp.unit) ? sp.unit : null;

  return (
    <>
      <PageHeader
        title={`${property.name} — ${t("3d.title")}`}
        description={t("3d.subtitle")}
        breadcrumbs={[{ label: t("prop.title"), href: "/properties" }, { label: property.name, href: `/properties/${property.id}` }, { label: t("3d.title") }]}
      />
      <BuildingViewerLoader model={model} name={property.name} labels={labels} initialUnitId={initialUnitId} canOpenUnits={can(ctx, "unit.view")} />
    </>
  );
}
