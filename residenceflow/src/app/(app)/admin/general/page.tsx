import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { getOrgSettings } from "@/lib/settings";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Checkbox, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { adminMessages, adminDict } from "../messages";
import { CURRENCIES, DATE_FORMATS, FEATURE_FLAGS, TIMEZONES } from "../constants";
import { saveGeneralSettingsAction } from "./actions";

export const metadata = { title: "General settings" };

export default async function GeneralSettingsPage() {
  const ctx = await requireContext("settings.general.manage");
  const { t } = await getT(adminMessages);
  const s = await getOrgSettings(ctx.organizationId);
  if (!s) notFound();
  const flags = (s.featureFlags && typeof s.featureFlags === "object" && !Array.isArray(s.featureFlags) ? s.featureFlags : {}) as Record<string, unknown>;
  const months = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: t(`adm.month.${i + 1}`) }));

  return (
    <>
      <PageHeader title={t("adm.general.title")} description={t("adm.general.subtitle")} />
      <ActionForm action={saveGeneralSettingsAction} dict={adminDict(t)}>
        <Card title={t("adm.general.identity")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t("adm.general.companyName")} name="companyName" defaultValue={s.companyName} required maxLength={200} />
            <Input label={t("adm.general.appName")} name="appName" defaultValue={s.appName} required maxLength={60} />
            <Input label={t("adm.general.shortName")} name="shortName" defaultValue={s.shortName} required maxLength={6} hint={t("adm.general.shortNameHint")} />
            <Input label={t("adm.general.taxId")} name="taxId" defaultValue={s.taxId} maxLength={60} />
            <Input label={t("adm.general.address")} name="address" defaultValue={s.address} maxLength={300} wrapperClassName="sm:col-span-2" />
            <Input label={t("common.phone")} name="phone" defaultValue={s.phone} maxLength={40} type="tel" />
            <Input label={t("common.email")} name="email" defaultValue={s.email} type="email" maxLength={200} />
            <Input label={t("adm.general.website")} name="website" defaultValue={s.website} type="url" placeholder="https://" maxLength={200} />
          </div>
        </Card>
        <Card title={t("adm.general.regional")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Select label={t("adm.general.timezone")} name="timezone" defaultValue={s.timezone} options={TIMEZONES.map((z) => ({ value: z, label: z }))} />
            <Select label={t("adm.general.dateFormat")} name="dateFormat" defaultValue={s.dateFormat} options={DATE_FORMATS.map((f) => ({ value: f, label: f }))} />
            <Select label={t("adm.general.language")} name="defaultLanguage" defaultValue={s.defaultLanguage} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }]} />
            <Select label={t("adm.general.currency")} name="currency" defaultValue={s.currency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            <Select label={t("adm.general.fyStart")} name="financialYearStartMonth" defaultValue={String(s.financialYearStartMonth)} options={months} />
            <Input label={t("adm.general.visitorRetention")} name="visitorRetentionDays" type="number" min={1} max={3650} defaultValue={s.visitorRetentionDays} />
          </div>
        </Card>
        <Card title={t("adm.general.operations")}>
          <Textarea label={t("adm.general.emergency")} name="emergencyInstructions" defaultValue={s.emergencyInstructions} rows={4} maxLength={2000} />
        </Card>
        <Card title={t("adm.general.features")}>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t("adm.general.featuresHint")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {FEATURE_FLAGS.map((f) => (
              <Checkbox key={f} name={`flag_${f}`} label={t(`adm.flag.${f}`)} defaultChecked={flags[f] === true} />
            ))}
            <Checkbox name="sharedTenancyEnabled" label={t("adm.flag.sharedTenancy")} defaultChecked={s.sharedTenancyEnabled} />
          </div>
        </Card>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </ActionForm>
    </>
  );
}
