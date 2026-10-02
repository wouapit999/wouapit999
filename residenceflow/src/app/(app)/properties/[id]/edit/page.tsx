import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { Card, PageHeader } from "@/components/ui";
import { PropertyForm } from "../../property-form";
import { updatePropertyAction } from "../../actions";
import { propertyMessages } from "../../messages";

export const metadata = { title: "Edit building" };

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("building.update");
  const { t } = await getT(propertyMessages);
  const property = await db.property.findFirst({ where: { ...propertyWhere(ctx), id } });
  if (!property) notFound();
  const owners = await db.user.findMany({
    where: { organizationId: ctx.organizationId, roles: { some: { role: { key: "owner" } } } },
    select: { id: true, name: true },
  });
  return (
    <>
      <PageHeader title={t("prop.edit")} breadcrumbs={[{ label: t("prop.title"), href: "/properties" }, { label: property.name, href: `/properties/${id}` }, { label: t("common.edit") }]} />
      <Card><PropertyForm action={updatePropertyAction} property={property} owners={owners} t={t} /></Card>
    </>
  );
}
