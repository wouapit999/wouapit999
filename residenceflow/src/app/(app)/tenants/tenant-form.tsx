import type { Tenant } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Checkbox, Input, Select, Textarea } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import type { T } from "@/i18n";
import { dayInput } from "../leases/fields";
import { COMM_PREFS, ID_TYPES, TENANT_STATUSES, TENANT_TYPES } from "./messages";

export function TenantForm({
  action,
  tenant,
  showNotes,
  t,
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  tenant?: Tenant;
  showNotes: boolean;
  t: T;
}) {
  const prefs = tenant?.commPreferences ?? ["EMAIL", "IN_APP"];
  return (
    <ActionForm action={action} dict={{ "Please correct the highlighted fields.": t("tenant.fixFields") }}>
      {tenant && <input type="hidden" name="id" value={tenant.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label={t("tenant.type")} name="type" defaultValue={tenant?.type ?? "INDIVIDUAL"} options={TENANT_TYPES.map((v) => ({ value: v, label: t(`tenant.type.${v}`) }))} />
        {tenant && (
          <Select label={t("common.status")} name="status" defaultValue={tenant.status} options={TENANT_STATUSES.map((v) => ({ value: v, label: t(`tenant.status.${v}`) }))} />
        )}
        <Input label={t("tenant.legalName")} name="legalName" defaultValue={tenant?.legalName} required minLength={2} maxLength={200} />
        <Input label={t("tenant.preferredName")} name="preferredName" defaultValue={tenant?.preferredName} maxLength={200} />
        <Input label={t("common.email")} name="email" type="email" defaultValue={tenant?.email} maxLength={200} />
        <Input label={t("common.phone")} name="phone" type="tel" defaultValue={tenant?.phone} maxLength={40} />
        <Input label={t("tenant.altPhone")} name="altPhone" type="tel" defaultValue={tenant?.altPhone} maxLength={40} />
        <Input label={t("tenant.employer")} name="employer" defaultValue={tenant?.employer} maxLength={200} />
        <Textarea label={t("tenant.postalAddress")} name="postalAddress" defaultValue={tenant?.postalAddress} maxLength={500} />
        <Textarea label={t("tenant.previousAddress")} name="previousAddress" defaultValue={tenant?.previousAddress} maxLength={500} />
        <Select label={t("tenant.idType")} name="idType" defaultValue={tenant?.idType ?? ""} placeholder="—" options={ID_TYPES.map((v) => ({ value: v, label: t(`tenant.idType.${v}`) }))} />
        <Input
          label={t("tenant.idNumber")}
          name="idNumber"
          autoComplete="off"
          maxLength={60}
          hint={tenant?.idNumberMasked ? t("tenant.idNumberEditHint", { masked: tenant.idNumberMasked }) : t("tenant.idNumberHint")}
        />
        <Input label={t("tenant.idIssueDate")} name="idIssueDate" type="date" defaultValue={dayInput(tenant?.idIssueDate)} />
        <Input label={t("tenant.idExpiryDate")} name="idExpiryDate" type="date" defaultValue={dayInput(tenant?.idExpiryDate)} />
        <Select label={t("tenant.language")} name="language" defaultValue={tenant?.language ?? "fr"} options={["fr", "en"].map((v) => ({ value: v, label: t(`tenant.lang.${v}`) }))} />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{t("tenant.comm")}</legend>
        <div className="flex flex-wrap gap-4">
          {COMM_PREFS.map((p) => (
            <Checkbox key={p} label={t(`tenant.comm.${p}`)} name="commPreferences" value={p} defaultChecked={prefs.includes(p)} />
          ))}
        </div>
      </fieldset>
      {showNotes && <Textarea label={t("tenant.notes")} name="notes" defaultValue={tenant?.notes} hint={t("tenant.notesHint")} maxLength={8000} />}
      <SubmitButton>{t("common.save")}</SubmitButton>
    </ActionForm>
  );
}
