import { db } from "@/lib/db";
import { invoiceWhere, leaseWhere, requireContext, tenantWhere } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay, formatMoney } from "@/lib/format";
import { sum } from "@/lib/money";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input, PageHeader, Select, Textarea, buttonClass, inputClass, str } from "@/components/ui";
import { invoiceBalance, todayUtc } from "@/services/billing";
import { OPEN_INVOICE_STATUSES, PAYMENT_METHODS, dayString } from "@/services/finance-extra";
import { recordPaymentAction } from "../actions";
import { financeMessages } from "../../invoices/messages";
import { paymentMessages } from "../messages";

export const metadata = { title: "Record payment" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("payment.record");
  const { t, locale } = await getT(financeMessages, paymentMessages);
  const sp = await searchParams;
  const tenantId = str(sp.tenantId);
  const [settings, tenants] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.tenant.findMany({ where: { ...tenantWhere(ctx), status: { not: "ARCHIVED" } }, select: { id: true, legalName: true, reference: true }, orderBy: { legalName: "asc" }, take: 1000 }),
  ]);
  const tenant = tenantId ? tenants.find((x) => x.id === tenantId) : undefined;
  const [leases, openInvoices] = tenant
    ? await Promise.all([
        db.lease.findMany({
          where: { AND: [leaseWhere(ctx), { tenantId: tenant.id }] },
          select: { id: true, reference: true, status: true, unit: { select: { number: true, property: { select: { name: true } } } } },
          orderBy: { startDate: "desc" },
        }),
        db.invoice.findMany({
          where: { AND: [invoiceWhere(ctx), { tenantId: tenant.id, status: { in: [...OPEN_INVOICE_STATUSES] } }] },
          orderBy: { dueDate: "asc" },
        }),
      ])
    : [[], []];
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat };
  const methods = (settings?.enabledPaymentMethods ?? [...PAYMENT_METHODS]).filter((m) => (PAYMENT_METHODS as readonly string[]).includes(m));
  const scoped = ctx.propertyIds !== "ALL";
  const outstanding = sum(openInvoices.map(invoiceBalance));

  return (
    <>
      <PageHeader title={t("pay.new")} breadcrumbs={[{ label: t("pay.title"), href: "/payments" }, { label: t("pay.new") }]} />
      <Card className="mb-6">
        <form method="get" action="/payments/new" className="flex flex-wrap items-end gap-3">
          <Select label={t("common.tenant")} name="tenantId" defaultValue={tenant?.id ?? ""} placeholder={t("fin.selectTenant")} required options={tenants.map((x) => ({ value: x.id, label: `${x.legalName} (${x.reference})` }))} wrapperClassName="w-full sm:w-96" />
          <button type="submit" className={buttonClass("secondary")}>{t("fin.loadTenant")}</button>
        </form>
      </Card>
      {tenant && (
        <Card>
          <ActionForm action={recordPaymentAction}>
            <input type="hidden" name="tenantId" value={tenant.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label={t("fin.lease")}
                name="leaseId"
                required={scoped}
                hint={scoped ? t("fin.leaseRequiredScoped") : undefined}
                defaultValue={leases.find((l) => l.status === "ACTIVE")?.id ?? ""}
                placeholder={scoped ? "—" : t("fin.noLease")}
                options={leases.map((l) => ({ value: l.id, label: `${l.reference} · ${l.unit.property.name} ${l.unit.number}` }))}
              />
              <Input label={`${t("common.amount")} (${fmt.currency})`} name="amount" type="number" min="0.01" step="0.01" required inputMode="decimal" />
              <Input label={t("pay.date")} name="paymentDate" type="date" required defaultValue={dayString(todayUtc())} />
              <Select label={t("fin.method")} name="method" required options={methods.map((m) => ({ value: m, label: t(`fin.method.${m}`) }))} />
              <Input label={t("pay.externalRef")} name="externalRef" maxLength={120} hint={t("pay.externalRefHint")} />
              <Input label={t("pay.receivingAccount")} name="receivingAccount" maxLength={120} />
            </div>
            <Field label={t("pay.proof")} name="proof" hint={t("pay.proofHint")}>
              <input id="proof" name="proof" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className={inputClass} />
            </Field>
            <Textarea label={t("common.notes")} name="notes" maxLength={2000} />

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("pay.allocation")}</legend>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="allocMode" value="auto" defaultChecked className="accent-[var(--brand)]" /> {t("pay.alloc.auto")}</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="allocMode" value="manual" className="accent-[var(--brand)]" disabled={openInvoices.length === 0} /> {t("pay.alloc.manual")}</label>
              {openInvoices.length === 0 ? (
                <p className="text-sm text-slate-500">{t("pay.noOpenInvoices")}</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <tr>
                        <th className="px-3 py-2">{t("fin.invoice")}</th>
                        <th className="px-3 py-2">{t("fin.dueDate")}</th>
                        <th className="px-3 py-2 text-right">{t("fin.outstanding")}</th>
                        <th className="px-3 py-2">{t("pay.applyAmount")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {openInvoices.map((inv) => {
                        const bal = invoiceBalance(inv);
                        return (
                          <tr key={inv.id}>
                            <td className="px-3 py-2 font-mono text-xs">{inv.number}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{formatDay(inv.dueDate, df)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(bal, fmt)}</td>
                            <td className="px-3 py-2">
                              <input aria-label={`${t("pay.applyAmount")} ${inv.number}`} name={`alloc_${inv.id}`} type="number" min="0" step="0.01" max={bal.toFixed(2)} className={`${inputClass} w-36`} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="font-semibold">
                        <td className="px-3 py-2" colSpan={2}>{t("common.total")}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(outstanding, fmt)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </fieldset>
            <SubmitButton>{t("pay.record")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
