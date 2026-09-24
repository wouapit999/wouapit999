import type { Vendor } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Input, Select, Textarea } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import type { T } from "@/i18n";

export const VENDOR_CATEGORIES = ["GENERAL", "PLUMBING", "ELECTRICAL", "HVAC", "CLEANING", "SECURITY", "PEST", "PAINTING", "CARPENTRY", "GARDENING", "OTHER"] as const;

export function vendorCategoryLabel(t: T, c: string) {
  return (VENDOR_CATEGORIES as readonly string[]).includes(c) ? t(`ven.cat.${c}`) : c;
}

export function VendorForm({ action, vendor, t }: { action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>; vendor?: Vendor; t: T }) {
  return (
    <ActionForm action={action}>
      {vendor && <input type="hidden" name="id" value={vendor.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t("common.name")} name="name" defaultValue={vendor?.name} required minLength={2} maxLength={150} />
        <Select
          label={t("ven.category")}
          name="category"
          defaultValue={vendor && (VENDOR_CATEGORIES as readonly string[]).includes(vendor.category) ? vendor.category : vendor ? "OTHER" : "GENERAL"}
          options={VENDOR_CATEGORIES.map((c) => ({ value: c, label: t(`ven.cat.${c}`) }))}
        />
        <Input label={t("ven.contactName")} name="contactName" defaultValue={vendor?.contactName} maxLength={120} />
        <Input label={t("common.phone")} name="phone" type="tel" defaultValue={vendor?.phone} maxLength={40} />
        <Input label={t("common.email")} name="email" type="email" defaultValue={vendor?.email} maxLength={200} />
        <Input label={t("ven.taxId")} name="taxId" defaultValue={vendor?.taxId} maxLength={60} />
      </div>
      <Textarea label={t("common.notes")} name="notes" defaultValue={vendor?.notes} maxLength={4000} />
      <SubmitButton>{t("common.save")}</SubmitButton>
    </ActionForm>
  );
}
