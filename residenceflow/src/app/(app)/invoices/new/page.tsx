import { db } from "@/lib/db";
import { can, leaseWhere, requireContext, tenantWhere } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Checkbox, Input, PageHeader, Select, Textarea, buttonClass, str } from "@/components/ui";
import { todayUtc } from "@/services/billing";
import { CHARGE_TYPES, dayString } from "@/services/finance-extra";
import { createInvoiceAction } from "../actions";
import { financeMessages, invoiceMessages } from "../messages";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("invoice.create");
  const { t } = await getT(financeMessages, invoiceMessages);
  const sp = await searchParams;
  const tenantId = str(sp.tenantId);
  const [settings, tenants] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.tenant.findMany({ where: { ...tenantWhere(ctx), status: { not: "ARCHIVED" } }, select: { id: true, legalName: true, reference: true }, orderBy: { legalName: "asc" }, take: 1000 }),
  ]);
  const tenant = tenantId ? tenants.find((x) => x.id === tenantId) : undefined;
  const leases = tenant
    ? await db.lease.findMany({
        where: { AND: [leaseWhere(ctx), { tenantId: tenant.id }] },
        select: { id: true, reference: true, status: true, unit: { select: { number: true, property: { select: { name: true } } } } },
        orderBy: { startDate: "desc" },
      })
    : [];
  const today = todayUtc();
  const scoped = ctx.propertyIds !== "ALL";

  return (
    <>
      <PageHeader title={t("inv.new")} breadcrumbs={[{ label: t("inv.title"), href: "/invoices" }, { label: t("inv.new") }]} />
      <Card className="mb-6">
        <form method="get" action="/invoices/new" className="flex flex-wrap items-end gap-3">
          <Select label={t("common.tenant")} name="tenantId" defaultValue={tenant?.id ?? ""} placeholder={t("fin.selectTenant")} required options={tenants.map((x) => ({ value: x.id, label: `${x.legalName} (${x.reference})` }))} wrapperClassName="w-full sm:w-96" />
          <button type="submit" className={buttonClass("secondary")}>{t("fin.loadTenant")}</button>
        </form>
      </Card>
      {tenant && (
        <Card>
          <ActionForm action={createInvoiceAction}>
            <input type="hidden" name="tenantId" value={tenant.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                label={t("fin.lease")}
                name="leaseId"
                required={scoped}
                hint={scoped ? t("fin.leaseRequiredScoped") : undefined}
                defaultValue={leases.find((l) => l.status === "ACTIVE")?.id ?? ""}
                placeholder={scoped ? "—" : t("fin.noLease")}
                options={leases.map((l) => ({ value: l.id, label: `${l.reference} · ${l.unit.property.name} ${l.unit.number} (${l.status})` }))}
              />
              <Input label={t("fin.issueDate")} name="issueDate" type="date" required defaultValue={dayString(today)} />
              <Input label={t("fin.dueDate")} name="dueDate" type="date" required defaultValue={dayString(today)} />
            </div>
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("inv.lines")}</legend>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("inv.linesHint", { currency: settings?.currency ?? "XAF", tax: settings?.taxRatePercent.toString() ?? "0" })}</p>
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-12 sm:border-0 sm:p-0 dark:border-slate-700">
                  <Select label={t("inv.chargeType")} name={`line_${i}_chargeType`} defaultValue={i === 0 ? "RENT" : "OTHER"} options={CHARGE_TYPES.map((c) => ({ value: c, label: t(`fin.charge.${c}`) }))} wrapperClassName="sm:col-span-3" />
                  <Input label={i === 0 ? t("inv.description") : `${t("inv.description")} (${t("inv.lineN", { n: i + 1 })})`} name={`line_${i}_description`} maxLength={300} required={i === 0} wrapperClassName="sm:col-span-5" />
                  <Input label={t("inv.qty")} name={`line_${i}_quantity`} type="number" min="0.01" step="0.01" defaultValue="1" wrapperClassName="sm:col-span-1" />
                  <Input label={t("inv.unitPrice")} name={`line_${i}_unitPrice`} type="number" min="0" step="0.01" required={i === 0} wrapperClassName="sm:col-span-3" />
                </div>
              ))}
            </fieldset>
            <Textarea label={t("common.notes")} name="notes" maxLength={2000} />
            {can(ctx, "invoice.issue") && <Checkbox label={t("inv.issueNow")} name="issueNow" />}
            <SubmitButton>{t("inv.create")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
