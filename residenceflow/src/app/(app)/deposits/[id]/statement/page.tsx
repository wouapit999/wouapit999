/* eslint-disable @next/next/no-img-element */
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { leaseWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDate, formatDay, formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { depositTotals } from "@/services/deposits";
import { financeMessages } from "../../../invoices/messages";
import { depositMessages } from "../../messages";

export const metadata = { title: "Deposit statement" };

export default async function DepositStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("deposit.view");
  const { t, locale } = await getT(financeMessages, depositMessages);
  const deposit = await db.securityDeposit.findFirst({
    where: { id, organizationId: ctx.organizationId, lease: leaseWhere(ctx) },
    include: {
      transactions: { where: { status: "APPROVED" }, orderBy: { createdAt: "asc" } },
      lease: {
        select: {
          reference: true, currency: true, startDate: true, endDate: true, moveOutDate: true,
          tenant: { select: { legalName: true, reference: true, postalAddress: true } },
          unit: { select: { number: true, property: { select: { name: true, address: true, city: true } } } },
        },
      },
    },
  });
  if (!deposit) notFound();
  const settings = await getOrgSettings(ctx.organizationId);
  const fmt = { locale, currency: deposit.lease.currency || settings?.currency || "XAF" };
  const df = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const totals = depositTotals(deposit.transactions);
  const of = (type: string) => deposit.transactions.filter((x) => x.type === type);

  const section = (title: string, type: string, emptyLabel?: string) => {
    const rows = of(type);
    return (
      <section className="mt-6">
        <h2 className="border-b border-slate-200 pb-1 text-xs font-semibold uppercase text-slate-500">{title}</h2>
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">{emptyLabel ?? "—"}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((x) => (
                <tr key={x.id} className="border-b border-slate-100">
                  <td className="w-32 whitespace-nowrap py-1 pr-2 align-top">{formatDate(x.createdAt, df)}</td>
                  <td className="py-1 pr-2">{x.description || t(`dep.type.${x.type}`)}{x.method ? ` · ${t(`fin.method.${x.method}`)}` : ""}</td>
                  <td className="py-1 text-right tabular-nums">{formatMoney(x.amount, fmt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  };

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={t("dep.statement")}
          breadcrumbs={[{ label: t("dep.title"), href: "/deposits" }, { label: deposit.lease.reference, href: `/deposits/${deposit.id}` }, { label: t("dep.statement") }]}
          actions={<PrintButton label={t("fin.print")} />}
        />
      </div>
      <article className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 text-slate-900 shadow-sm sm:p-8 print:border-0 print:shadow-none">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {settings?.logoUrl ? <img src={settings.logoUrl} alt="" className="mb-2 h-10 w-auto" /> : null}
            <div className="font-semibold">{settings?.companyName || settings?.appName}</div>
            <div className="text-xs text-slate-600">{settings?.address}</div>
            <div className="text-xs text-slate-600">{[settings?.phone, settings?.email].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="sm:text-right">
            <div className="text-xl font-semibold uppercase">{t("dep.stmt.title")}</div>
            <div className="text-xs text-slate-600">{formatDate(new Date(), df)}</div>
          </div>
        </header>
        <section className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase text-slate-500">{t("common.tenant")}</div>
            <div className="font-medium">{deposit.lease.tenant.legalName}</div>
            <div className="text-xs text-slate-600">{deposit.lease.tenant.reference}</div>
            {deposit.lease.tenant.postalAddress && <div className="text-xs text-slate-600">{deposit.lease.tenant.postalAddress}</div>}
          </div>
          <div className="sm:text-right">
            <div className="text-xs uppercase text-slate-500">{t("dep.stmt.lease")}</div>
            <div className="font-mono text-xs">{deposit.lease.reference}</div>
            <div className="text-xs text-slate-600">{deposit.lease.unit.property.name} · {deposit.lease.unit.number}</div>
            <div className="text-xs text-slate-600">{t("dep.stmt.period")}: {formatDay(deposit.lease.startDate, df)} → {formatDay(deposit.lease.endDate, df)}</div>
            <div className="text-xs text-slate-600">{t("dep.stmt.moveOut")}: {formatDay(deposit.lease.moveOutDate, df)}</div>
          </div>
        </section>

        {section(t("dep.stmt.receipts"), "RECEIPT")}
        {section(t("dep.stmt.deductions"), "DEDUCTION", t("dep.stmt.noDeductions"))}
        {section(t("dep.stmt.refunds"), "REFUND")}

        <table className="mt-6 w-full text-sm">
          <tbody>
            <tr><td className="py-1">{t("dep.required")}</td><td className="py-1 text-right tabular-nums">{formatMoney(deposit.required, fmt)}</td></tr>
            <tr><td className="py-1">{t("dep.received")}</td><td className="py-1 text-right tabular-nums">{formatMoney(totals.received, fmt)}</td></tr>
            <tr><td className="py-1">− {t("dep.deducted")}</td><td className="py-1 text-right tabular-nums">{formatMoney(totals.deducted, fmt)}</td></tr>
            <tr><td className="py-1">− {t("dep.refunded")}</td><td className="py-1 text-right tabular-nums">{formatMoney(totals.refunded, fmt)}</td></tr>
            <tr className="border-t border-slate-300 font-semibold"><td className="py-2">{t("dep.stmt.balance")}</td><td className="py-2 text-right tabular-nums">{formatMoney(totals.held, fmt)}</td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">{t("dep.stmt.onlyApproved")}</p>

        <div className="mt-12 grid grid-cols-2 gap-8 text-xs text-slate-600">
          <div className="border-t border-slate-400 pt-1">{t("dep.stmt.signTenant")}</div>
          <div className="border-t border-slate-400 pt-1">{t("dep.stmt.signManager")}</div>
        </div>
      </article>
    </>
  );
}
