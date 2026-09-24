import { formatInTimeZone } from "date-fns-tz";
import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Input, PageHeader, Textarea } from "@/components/ui";
import { createSessionAction } from "../actions";
import { reconciliationMessages } from "../messages";

export const metadata = { title: "New reconciliation" };

export default async function NewReconciliationPage() {
  const ctx = await requireContext("payment.approve");
  const { t } = await getT(reconciliationMessages);
  const settings = await getOrgSettings(ctx.organizationId);
  const tz = settings?.timezone ?? "Africa/Douala";
  const now = new Date();
  const monthStart = formatInTimeZone(now, tz, "yyyy-MM-01");
  const today = formatInTimeZone(now, tz, "yyyy-MM-dd");

  return (
    <>
      <PageHeader title={t("rec.new")} breadcrumbs={[{ label: t("rec.title"), href: "/reconciliation" }, { label: t("rec.new") }]} />
      <Card>
        <ActionForm action={createSessionAction}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label={t("rec.account")} name="account" required minLength={2} maxLength={120} hint={t("rec.accountHint")} />
            <Input label={t("rec.periodStart")} name="periodStart" type="date" required defaultValue={monthStart} />
            <Input label={t("rec.periodEnd")} name="periodEnd" type="date" required defaultValue={today} />
          </div>
          <Textarea label={t("rec.csv")} name="csv" required rows={14} hint={t("rec.csvHint")} className="font-mono" placeholder={"date,reference,amount,description\n2026-03-02,MOMO123456,50000,Rent March"} />
          <Textarea label={t("rec.notes")} name="notes" maxLength={2000} rows={2} />
          <SubmitButton>{t("common.create")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
