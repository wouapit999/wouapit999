import { db } from "@/lib/db";
import { propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { createPurchaseOrderAction } from "../actions";
import { purchaseOrderMessages } from "../messages";

export const metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage() {
  const ctx = await requireContext("expense.create");
  const { t } = await getT(purchaseOrderMessages);
  const [buildings, vendors] = await Promise.all([
    db.property.findMany({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.vendor.findMany({ where: { organizationId: ctx.organizationId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const buildingRequired = ctx.propertyIds !== "ALL";

  return (
    <>
      <PageHeader title={t("po.new")} breadcrumbs={[{ label: t("po.title"), href: "/purchase-orders" }, { label: t("po.new") }]} />
      <Card>
        <ActionForm action={createPurchaseOrderAction}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t("common.building")}
              name="propertyId"
              required={buildingRequired}
              defaultValue={buildings.length === 1 ? buildings[0].id : ""}
              placeholder={buildingRequired ? t("po.choose") : t("po.orgWide")}
              options={buildings.map((b) => ({ value: b.id, label: b.name }))}
            />
            <Select label={t("po.vendor")} name="vendorId" placeholder={t("common.none")} options={vendors.map((v) => ({ value: v.id, label: v.name }))} />
            <Input label={t("common.amount")} name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" required />
          </div>
          <Input label={t("po.description")} name="description" required minLength={2} maxLength={500} />
          <Textarea label={t("po.justification")} name="justification" maxLength={2000} rows={3} />
          <SubmitButton>{t("common.create")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
