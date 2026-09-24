import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { byPropertyWhere, maintenanceWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { OPEN_WORK_ORDER_STATUSES } from "@/domain/work-order";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input, PageHeader, Select, str } from "@/components/ui";
import { LocationPicker } from "@/components/ops/location-picker";
import { locationOptions } from "@/services/maintenance";
import { createExpenseAction } from "../actions";
import { EXPENSE_CATEGORIES } from "../constants";
import { expenseMessages } from "../messages";

export const metadata = { title: "New expense" };

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("expense.create");
  const { t } = await getT(expenseMessages);
  const sp = await searchParams;
  const since = new Date(Date.now() - 180 * 86400_000);
  const woScope = { AND: [maintenanceWhere(ctx), byPropertyWhere(ctx)] };
  const [{ buildings, units }, vendors, workOrders, settings] = await Promise.all([
    locationOptions(ctx),
    db.vendor.findMany({ where: { organizationId: ctx.organizationId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.maintenanceRequest.findMany({
      where: { AND: [woScope, { OR: [{ status: { in: [...OPEN_WORK_ORDER_STATUSES] } }, { updatedAt: { gte: since } }, ...(str(sp.workOrderId) ? [{ id: str(sp.workOrderId) }] : [])] }] },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { id: true, number: true, title: true, propertyId: true, unitId: true, vendorId: true },
    }),
    getOrgSettings(ctx.organizationId),
  ]);
  const presetWo = workOrders.find((w) => w.id === str(sp.workOrderId));
  const today = formatInTimeZone(new Date(), settings?.timezone ?? "Africa/Douala", "yyyy-MM-dd");

  return (
    <>
      <PageHeader title={t("exp.new")} breadcrumbs={[{ label: t("exp.title"), href: "/expenses" }, { label: t("exp.new") }]} />
      <Card>
        <ActionForm action={createExpenseAction}>
          <div className="grid gap-4 sm:grid-cols-2">
            <LocationPicker
              buildings={buildings}
              units={units}
              buildingRequired={ctx.propertyIds !== "ALL"}
              defaultPropertyId={presetWo?.propertyId}
              defaultUnitId={presetWo?.unitId ?? undefined}
              labels={{ building: t("common.building"), unit: t("common.unit"), none: ctx.propertyIds === "ALL" ? t("exp.orgWide") : t("common.none"), choose: t("exp.choose") }}
            />
            <Select label={t("exp.workOrder")} name="workOrderId" defaultValue={presetWo?.id ?? ""} placeholder={t("common.none")} options={workOrders.map((w) => ({ value: w.id, label: `${w.number} — ${w.title}` }))} />
            <Select label={t("exp.vendor")} name="vendorId" defaultValue={presetWo?.vendorId ?? ""} placeholder={t("common.none")} options={vendors.map((v) => ({ value: v.id, label: v.name }))} />
            <Select label={t("exp.category")} name="category" required defaultValue={presetWo ? "MAINTENANCE" : ""} placeholder={t("exp.choose")} options={EXPENSE_CATEGORIES.map((v) => ({ value: v, label: t(`exp.cat.${v}`) }))} />
            <Input label={t("common.amount")} name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" required />
            <Input label={t("exp.date")} name="expenseDate" type="date" required defaultValue={today} />
            <Input label={t("exp.billReference")} name="billReference" maxLength={120} />
          </div>
          <Input label={t("exp.description")} name="description" required minLength={2} maxLength={500} defaultValue={presetWo ? `${presetWo.number} — ${presetWo.title}` : ""} />
          <Field label={t("exp.attachment")} name="attachment" hint={t("exp.attachmentHint")}>
            <input id="attachment" name="attachment" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="block w-full text-sm" />
          </Field>
          <SubmitButton>{t("common.save")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
