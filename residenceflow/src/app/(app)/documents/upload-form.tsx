import type { T } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Checkbox, Input, Select } from "@/components/ui";
import { uploadDocumentAction } from "./actions";
import { DOCUMENT_CATEGORIES } from "./scope";

export const DOC_ERROR_KEYS = ["doc.err.fileRequired", "doc.err.notLatest", "doc.err.linkRequired", "doc.err.tenantForVisibility", "doc.err.category"];

/** Upload form: a new document, or (with previousId) a new version of an existing one. */
export function UploadForm({ t, properties, tenants, previousId, requireLink, canSensitive, defaultSensitive }: {
  t: T;
  properties: { id: string; name: string }[];
  tenants: { id: string; legalName: string; reference: string }[];
  previousId?: string;
  requireLink: boolean;
  canSensitive: boolean;
  defaultSensitive?: boolean;
}) {
  const dict = Object.fromEntries(DOC_ERROR_KEYS.map((k) => [k, t(k)]));
  return (
    <ActionForm action={uploadDocumentAction} dict={dict}>
      {previousId ? (
        <input type="hidden" name="previousId" value={previousId} />
      ) : (
        <>
          <Select label={t("doc.category")} name="category" required defaultValue="OTHER" options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: t(`doc.cat.${c}`) }))} />
          <Select label={t("common.building")} name="propertyId" placeholder={requireLink ? "" : t("common.none")} options={properties.map((p) => ({ value: p.id, label: p.name }))} hint={requireLink ? t("doc.linkHint") : undefined} />
          <Select label={t("common.tenant")} name="tenantId" placeholder={t("common.none")} options={tenants.map((x) => ({ value: x.id, label: `${x.legalName} (${x.reference})` }))} />
        </>
      )}
      <Input label={t("doc.file")} name="file" type="file" required accept="application/pdf,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv" hint={t("doc.fileHint")} />
      <Input label={t("doc.displayName")} name="name" maxLength={200} hint={t("doc.displayNameHint")} />
      <Input label={t("doc.expiresAt")} name="expiresAt" type="date" />
      <Checkbox label={t("doc.visibleToTenant")} name="visibleToTenant" />
      <Checkbox label={t("doc.sensitive")} name="sensitive" defaultChecked={defaultSensitive} />
      {!canSensitive && <p className="text-xs text-slate-500">{t("doc.sensitiveHint")}</p>}
      <SubmitButton>{previousId ? t("doc.uploadVersion") : t("doc.upload")}</SubmitButton>
    </ActionForm>
  );
}
