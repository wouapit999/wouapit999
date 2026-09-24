import type { Unit } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Input, Select, Textarea } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import type { T } from "@/i18n";
import { FREQUENCIES } from "../leases/fields";
import { FURNISHINGS, UNIT_TYPES, formDict } from "./messages";

export function UnitForm({
  action,
  unit,
  properties,
  defaultPropertyId,
  t,
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  unit?: Unit & { property: { name: string } };
  properties: { id: string; name: string }[];
  defaultPropertyId?: string;
  t: T;
}) {
  return (
    <ActionForm action={action} dict={formDict(t)}>
      {unit && <input type="hidden" name="id" value={unit.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {unit ? (
          <Input label={t("unit.building")} name="propertyName" defaultValue={unit.property.name} disabled />
        ) : (
          <Select
            label={t("unit.building")}
            name="propertyId"
            required
            defaultValue={defaultPropertyId ?? ""}
            placeholder="—"
            options={properties.map((p) => ({ value: p.id, label: p.name }))}
          />
        )}
        <Input label={t("unit.number")} name="number" defaultValue={unit?.number} required maxLength={40} />
        <Input label={t("unit.block")} name="block" defaultValue={unit?.block} maxLength={40} />
        <Input label={t("unit.floor")} name="floor" type="number" min={-10} max={200} defaultValue={unit?.floor ?? 0} />
        <Select label={t("unit.type")} name="type" defaultValue={unit?.type ?? "APARTMENT"} options={UNIT_TYPES.map((v) => ({ value: v, label: t(`unit.type.${v}`) }))} />
        <Select label={t("unit.furnishing")} name="furnishing" defaultValue={unit?.furnishing ?? "UNFURNISHED"} options={FURNISHINGS.map((v) => ({ value: v, label: t(`unit.furnishing.${v}`) }))} />
        <Input label={t("unit.bedrooms")} name="bedrooms" type="number" min={0} max={50} defaultValue={unit?.bedrooms ?? 1} />
        <Input label={t("unit.bathrooms")} name="bathrooms" type="number" min={0} max={50} defaultValue={unit?.bathrooms ?? 1} />
        <Input label={t("unit.area")} name="area" type="number" min={0} step="0.01" defaultValue={unit?.area?.toString() ?? ""} />
        <Select label={t("unit.frequency")} name="billingFrequency" defaultValue={unit?.billingFrequency ?? "MONTHLY"} options={FREQUENCIES.map((v) => ({ value: v, label: t(`lease.freq.${v}`) }))} />
        <Input label={t("unit.rent")} name="defaultRent" type="number" min={0} step="0.01" required defaultValue={unit?.defaultRent.toString() ?? ""} />
        <Input label={t("unit.deposit")} name="defaultDeposit" type="number" min={0} step="0.01" defaultValue={unit?.defaultDeposit.toString() ?? "0"} />
        <Input label={t("unit.serviceCharge")} name="defaultServiceCharge" type="number" min={0} step="0.01" defaultValue={unit?.defaultServiceCharge.toString() ?? "0"} />
        <Input label={t("unit.meterIds")} name="meterIds" defaultValue={unit?.meterIds} maxLength={200} />
      </div>
      <Textarea label={t("common.notes")} name="notes" defaultValue={unit?.notes} maxLength={4000} />
      <SubmitButton>{t("common.save")}</SubmitButton>
    </ActionForm>
  );
}
