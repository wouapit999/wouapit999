import type { Property } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Input, Select, Textarea } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import type { T } from "@/i18n";

export const PROPERTY_TYPES = ["RESIDENTIAL", "MIXED_USE", "COMPOUND", "HOUSE", "COMMERCIAL"];

export function PropertyForm({
  action,
  property,
  owners,
  t,
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  property?: Property;
  owners: { id: string; name: string }[];
  t: T;
}) {
  return (
    <ActionForm action={action}>
      {property && <input type="hidden" name="id" value={property.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t("common.name")} name="name" defaultValue={property?.name} required maxLength={120} />
        <Select label={t("prop.type")} name="type" defaultValue={property?.type ?? "RESIDENTIAL"} options={PROPERTY_TYPES.map((v) => ({ value: v, label: t(`prop.type.${v}`) }))} />
        <Input label={t("prop.address")} name="address" defaultValue={property?.address} />
        <Input label={t("prop.city")} name="city" defaultValue={property?.city} />
        <Input label={t("prop.floors")} name="floors" type="number" min={0} defaultValue={property?.floors ?? 1} />
        <Input label={t("prop.blocks")} name="blocks" type="number" min={1} defaultValue={property?.blocks ?? 1} />
        <Input label={t("prop.latitude")} name="latitude" type="number" step="0.000001" defaultValue={property?.latitude?.toString() ?? ""} />
        <Input label={t("prop.longitude")} name="longitude" type="number" step="0.000001" defaultValue={property?.longitude?.toString() ?? ""} />
        <Select label={t("common.status")} name="status" defaultValue={property?.status === "ARCHIVED" ? "INACTIVE" : property?.status ?? "ACTIVE"} options={["ACTIVE", "INACTIVE", "RENOVATION"].map((v) => ({ value: v, label: t(`prop.status.${v}`) }))} />
        <Select label={t("prop.owner")} name="ownerId" defaultValue={property?.ownerId ?? ""} placeholder={t("common.none")} options={owners.map((o) => ({ value: o.id, label: o.name }))} />
      </div>
      <Input label={t("prop.amenities")} name="amenities" defaultValue={property?.amenities.join(", ")} hint={t("prop.amenitiesHint")} />
      <Textarea label={t("prop.utilities")} name="utilities" defaultValue={property?.utilities} />
      <Textarea label={t("prop.description")} name="description" defaultValue={property?.description} />
      <Textarea label={t("common.notes")} name="notes" defaultValue={property?.notes} />
      <SubmitButton>{t("common.save")}</SubmitButton>
    </ActionForm>
  );
}
