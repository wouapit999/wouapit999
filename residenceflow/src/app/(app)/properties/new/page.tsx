import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { Card, PageHeader } from "@/components/ui";
import { PropertyForm } from "../property-form";
import { createPropertyAction } from "../actions";
import { propertyMessages } from "../messages";

export const metadata = { title: "New building" };

export default async function NewPropertyPage() {
  const ctx = await requireContext("building.create");
  const { t } = await getT(propertyMessages);
  const owners = await db.user.findMany({
    where: { organizationId: ctx.organizationId, roles: { some: { role: { key: "owner" } } } },
    select: { id: true, name: true },
  });
  return (
    <>
      <PageHeader title={t("prop.new")} breadcrumbs={[{ label: t("prop.title"), href: "/properties" }, { label: t("prop.new") }]} />
      <Card><PropertyForm action={createPropertyAction} owners={owners} t={t} /></Card>
    </>
  );
}
