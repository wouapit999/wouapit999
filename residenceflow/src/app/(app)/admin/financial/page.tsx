import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { getOrgSettings } from "@/lib/settings";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Checkbox, Input, PageHeader, Select } from "@/components/ui";
import { adminDict, adminMessages } from "../messages";
import { LATE_FEE_TYPES, PAYMENT_METHODS } from "../constants";
import { saveFinancialSettingsAction } from "./actions";

export const metadata = { title: "Financial settings" };

export default async function FinancialSettingsPage() {
  const ctx = await requireContext("settings.financial.manage");
  const { t } = await getT(adminMessages);
  const s = await getOrgSettings(ctx.organizationId);
  if (!s) notFound();
  return (
    <>
      <PageHeader title={t("adm.financial.title")} description={t("adm.financial.subtitle", { currency: s.currency })} />
      <ActionForm action={saveFinancialSettingsAction} dict={adminDict(t)}>
        <Card title={t("adm.financial.billing")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input label={t("adm.financial.graceDays")} name="defaultGraceDays" type="number" min={0} max={90} defaultValue={s.defaultGraceDays} />
            <Select label={t("adm.financial.lateFeeType")} name="lateFeeType" defaultValue={s.lateFeeType} options={LATE_FEE_TYPES.map((v) => ({ value: v, label: t(`adm.financial.lateFee.${v}`) }))} />
            <Input label={t("adm.financial.lateFeeValue")} name="lateFeeValue" inputMode="decimal" defaultValue={s.lateFeeValue.toString()} hint={t("adm.financial.lateFeeValueHint")} />
            <Input label={t("adm.financial.reminderDays")} name="reminderDaysBefore" type="number" min={0} max={60} defaultValue={s.reminderDaysBefore} />
            <Input label={t("adm.financial.leadDays")} name="invoiceLeadDays" type="number" min={0} max={60} defaultValue={s.invoiceLeadDays} />
            <Input label={t("adm.financial.taxRate")} name="taxRatePercent" inputMode="decimal" defaultValue={s.taxRatePercent.toString()} />
          </div>
        </Card>
        <Card title={t("adm.financial.methods")}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PAYMENT_METHODS.map((m) => (
              <Checkbox key={m} name="enabledPaymentMethods" value={m} label={t(`adm.method.${m}`)} defaultChecked={s.enabledPaymentMethods.includes(m)} />
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">{t("adm.financial.gatewayNote")}</p>
        </Card>
        <Card title={t("adm.financial.controls")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t("adm.financial.highValue")} name="highValueThreshold" inputMode="decimal" defaultValue={s.highValueThreshold.toString()} hint={t("adm.financial.highValueHint")} />
            <Input label={t("adm.financial.approvalThreshold")} name="expenseApprovalThreshold" inputMode="decimal" defaultValue={s.expenseApprovalThreshold.toString()} hint={t("adm.financial.approvalThresholdHint")} />
          </div>
          <div className="mt-4 space-y-2">
            <Checkbox name="separationOfDuties" label={t("adm.financial.sod")} defaultChecked={s.separationOfDuties} />
            <Checkbox name="sharedTenancyEnabled" label={t("adm.flag.sharedTenancy")} defaultChecked={s.sharedTenancyEnabled} />
          </div>
        </Card>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </ActionForm>
    </>
  );
}
