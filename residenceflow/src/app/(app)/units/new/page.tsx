import { db } from "@/lib/db";
import { propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { Alert, Card, PageHeader, str } from "@/components/ui";
import { leaseMessages } from "../../leases/messages";
import { UnitForm } from "../unit-form";
import { createUnitAction } from "../actions";
import { unitMessages } from "../messages";

export const metadata = { title: "New unit" };

export default async function NewUnitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("unit.manage");
  const { t } = await getT(unitMessages, leaseMessages);
  const sp = await searchParams;
  const properties = await db.property.findMany({
    where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const wanted = str(sp.propertyId);
  const defaultPropertyId = properties.some((p) => p.id === wanted) ? wanted : undefined;
  return (
    <>
      <PageHeader title={t("unit.new")} breadcrumbs={[{ label: t("unit.title"), href: "/units" }, { label: t("unit.new") }]} />
      {properties.length === 0 ? (
        <Alert tone="warn">{t("unit.noBuildings")}</Alert>
      ) : (
        <Card><UnitForm action={createUnitAction} properties={properties} defaultPropertyId={defaultPropertyId} t={t} /></Card>
      )}
    </>
  );
}
