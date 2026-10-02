import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireContext, unitWhere } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { Alert, Card, PageHeader } from "@/components/ui";
import { leaseMessages } from "../../../leases/messages";
import { UnitForm } from "../../unit-form";
import { updateUnitAction } from "../../actions";
import { unitMessages } from "../../messages";

export const metadata = { title: "Edit unit" };

export default async function EditUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("unit.manage");
  const { t } = await getT(unitMessages, leaseMessages);
  const unit = await db.unit.findFirst({ where: { ...unitWhere(ctx), id }, include: { property: { select: { name: true } } } });
  if (!unit) notFound();
  const label = `${unit.block ? `${unit.block} · ` : ""}${unit.number}`;
  return (
    <>
      <PageHeader title={t("unit.edit")} breadcrumbs={[{ label: t("unit.title"), href: "/units" }, { label: label, href: `/units/${id}` }, { label: t("common.edit") }]} />
      {unit.archived ? <Alert tone="warn">{t("unit.err.archived")}</Alert> : <Card><UnitForm action={updateUnitAction} unit={unit} properties={[]} t={t} /></Card>}
    </>
  );
}
