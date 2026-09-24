import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, Textarea, str } from "@/components/ui";
import { PLAN_FREQUENCIES } from "@/domain/payment-plan";
import { dayInput, todayUtcDay } from "../../leases/fields";
import { createPaymentPlanAction } from "../actions";
import { tenantsEligibleForPlan } from "../data";
import { paymentPlanMessages } from "../messages";

export const metadata = { title: "New payment plan" };

export default async function NewPaymentPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("arrears.manage");
  const { t, locale } = await getT(paymentPlanMessages);
  const sp = await searchParams;
  const tenantId = str(sp.tenantId);
  const [settings, tenants] = await Promise.all([getOrgSettings(ctx.organizationId), tenantsEligibleForPlan(ctx)]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const selected = tenants.find((x) => x.id === tenantId);
  const header = <PageHeader title={t("pp.new")} breadcrumbs={[{ label: t("pp.title"), href: "/payment-plans" }, { label: t("pp.new") }]} />;
  if (tenants.length === 0) {
    return (
      <>
        {header}
        <EmptyState title={t("pp.noTenants")} action={<LinkButton variant="secondary" href="/arrears">{t("common.back")}</LinkButton>} />
      </>
    );
  }
  return (
    <>
      {header}
      <Card>
        <ActionForm action={createPaymentPlanAction} dict={{ "Please correct the highlighted fields.": t("pp.fixFields") }}>
          <Select
            label={t("pp.tenant")}
            name="tenantId"
            required
            defaultValue={selected?.id ?? ""}
            placeholder={t("common.none")}
            hint={t("pp.tenantHint")}
            options={tenants.map((x) => ({ value: x.id, label: `${x.legalName} · ${x.reference} — ${t("pp.outstanding")}: ${formatMoney(x.outstanding, fmt)}` }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t("pp.totalAmount")} name="totalAmount" type="number" min="0.01" step="0.01" inputMode="decimal" required defaultValue={selected ? selected.outstanding.toFixed(2) : undefined} hint={t("pp.totalHint")} />
            <Input label={t("pp.count")} name="count" type="number" min={2} max={24} required defaultValue={3} hint={t("pp.countHint")} />
            <Input label={t("pp.firstDue")} name="firstDue" type="date" required defaultValue={dayInput(todayUtcDay())} />
            <Select label={t("pp.frequency")} name="frequency" defaultValue="MONTHLY" options={PLAN_FREQUENCIES.map((f) => ({ value: f, label: t(`pp.freq.${f}`) }))} />
          </div>
          <Textarea label={t("pp.notes")} name="notes" maxLength={4000} />
          <SubmitButton>{t("common.create")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
