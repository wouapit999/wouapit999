import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { LocationPicker } from "@/components/ops/location-picker";
import { locationOptions } from "@/services/maintenance";
import { UTILITY_TYPES } from "@/domain/utilities";
import { createMeterAction } from "../actions";
import { utilitiesEnabled } from "../flag";
import { utilityMessages } from "../messages";

export const metadata = { title: "New meter" };

export default async function NewMeterPage() {
  const ctx = await requireContext("unit.manage");
  const { t } = await getT(utilityMessages);
  if (!(await utilitiesEnabled(ctx.organizationId))) return <EmptyState title={t("util.disabled")} description={t("util.disabledHint")} />;
  const { buildings, units } = await locationOptions(ctx);

  return (
    <>
      <PageHeader title={t("util.newMeter")} breadcrumbs={[{ label: t("util.title"), href: "/utilities" }, { label: t("util.newMeter") }]} />
      <Card>
        <ActionForm action={createMeterAction}>
          <div className="grid gap-4 sm:grid-cols-2">
            <LocationPicker buildings={buildings} units={units} buildingRequired labels={{ building: t("common.building"), unit: t("util.unitOptional"), none: t("util.shared"), choose: t("util.choose") }} />
            <Select label={t("util.utility")} name="utility" required placeholder={t("util.choose")} options={UTILITY_TYPES.map((v) => ({ value: v, label: t(`util.type.${v}`) }))} />
            <Input label={t("util.serial")} name="serial" required maxLength={80} />
            <Input label={t("util.tariff")} name="tariff" type="number" min="0" step="0.0001" inputMode="decimal" required defaultValue="0" />
            <Input label={t("util.fixedFee")} name="fixedFee" type="number" min="0" step="0.01" inputMode="decimal" defaultValue="0" />
          </div>
          <SubmitButton>{t("common.save")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
