/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, invoiceWhere, paymentWhere, requireContext, tenantWhere } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDate, formatDay, formatMoney } from "@/lib/format";
import { money, type Decimal } from "@/lib/money";
import { Input, PageHeader, buttonClass, str } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { dayString, parseDay } from "@/services/finance-extra";
import { financeMessages, invoiceMessages } from "../../messages";

export const metadata = { title: "Tenant statement" };

interface Entry {
  date: Date;
  order: number;
  label: string;
  href?: string;
  debit: Decimal;
  credit: Decimal;
}

function dayOf(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export default async function TenantStatementPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId } = await params;
  const ctx = await requireContext("invoice.view");
  const { t, locale } = await getT(financeMessages, invoiceMessages);
  const sp = await searchParams;
  const tenant = await db.tenant.findFirst({ where: { AND: [tenantWhere(ctx), { id: tenantId }] }, select: { id: true, legalName: true, reference: true, postalAddress: true, email: true, phone: true } });
  if (!tenant) notFound();
  const from = parseDay(str(sp.from));
  const to = parseDay(str(sp.to));
  const canPayments = can(ctx, "payment.view");

  const [settings, invoices, payments] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.invoice.findMany({
      where: { AND: [invoiceWhere(ctx), { tenantId: tenant.id, status: { notIn: ["DRAFT", "VOID"] } }] },
      select: { id: true, number: true, issueDate: true, total: true, creditNotes: { select: { number: true, amount: true, createdAt: true } } },
    }),
    db.payment.findMany({
      where: { AND: [paymentWhere(ctx), { tenantId: tenant.id, status: { in: ["CONFIRMED", "REVERSED"] } }] },
      select: { id: true, reference: true, paymentDate: true, amount: true, status: true, reversal: { select: { createdAt: true } } },
    }),
  ]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const zero = money(0);

  const entries: Entry[] = [];
  for (const inv of invoices) {
    entries.push({ date: inv.issueDate, order: 0, label: t("inv.stmt.invoice", { n: inv.number }), href: `/invoices/${inv.id}`, debit: money(inv.total), credit: zero });
    for (const cn of inv.creditNotes) {
      entries.push({ date: dayOf(cn.createdAt), order: 1, label: t("inv.stmt.creditNote", { n: cn.number, inv: inv.number }), href: `/invoices/${inv.id}`, debit: zero, credit: money(cn.amount) });
    }
  }
  for (const p of payments) {
    const href = canPayments ? `/payments/${p.id}` : undefined;
    entries.push({ date: p.paymentDate, order: 2, label: t("inv.stmt.payment", { n: p.reference }), href, debit: zero, credit: money(p.amount) });
    if (p.status === "REVERSED") {
      entries.push({ date: dayOf(p.reversal?.createdAt ?? p.paymentDate), order: 3, label: t("inv.stmt.reversal", { n: p.reference }), href, debit: money(p.amount), credit: zero });
    }
  }
  entries.sort((a, b) => a.date.getTime() - b.date.getTime() || a.order - b.order);

  let opening = money(0);
  const inPeriod: (Entry & { running: Decimal })[] = [];
  let running = money(0);
  for (const e of entries) {
    if (from && e.date < from) {
      opening = opening.plus(e.debit).minus(e.credit);
      running = opening;
      continue;
    }
    if (to && e.date > to) continue;
    running = running.plus(e.debit).minus(e.credit);
    inPeriod.push({ ...e, running });
  }
  const closing = running;
  const totalDebit = inPeriod.reduce((s, e) => s.plus(e.debit), money(0));
  const totalCredit = inPeriod.reduce((s, e) => s.plus(e.credit), money(0));
  const periodLabel = from || to ? `${from ? formatDay(from, df) : "…"} → ${to ? formatDay(to, df) : "…"}` : t("inv.stmt.allTime");

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={t("inv.statement")}
          description={`${tenant.legalName} · ${tenant.reference}`}
          breadcrumbs={[{ label: t("inv.title"), href: "/invoices" }, { label: t("inv.statement") }]}
          actions={<PrintButton label={t("fin.print")} />}
        />
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <Input label={t("fin.from")} name="from" type="date" defaultValue={from ? dayString(from) : ""} wrapperClassName="w-full sm:w-44" />
          <Input label={t("fin.to")} name="to" type="date" defaultValue={to ? dayString(to) : ""} wrapperClassName="w-full sm:w-44" />
          <button type="submit" className={buttonClass("secondary")}>{t("common.filter")}</button>
        </form>
      </div>

      <article className="mx-auto max-w-4xl rounded-lg border border-slate-200 bg-white p-6 text-slate-900 shadow-sm sm:p-8 print:border-0 print:shadow-none">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {settings?.logoUrl ? <img src={settings.logoUrl} alt="" className="mb-2 h-10 w-auto" /> : null}
            <div className="font-semibold">{settings?.companyName || settings?.appName}</div>
            <div className="text-xs text-slate-600">{settings?.address}</div>
            <div className="text-xs text-slate-600">{[settings?.phone, settings?.email].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="sm:text-right">
            <div className="text-xl font-semibold uppercase">{t("inv.stmt.title")}</div>
            <div className="text-xs text-slate-600">{t("inv.stmt.period")}: {periodLabel}</div>
            <div className="text-xs text-slate-600">{t("inv.stmt.generated", { date: formatDate(new Date(), df) })}</div>
          </div>
        </header>
        <section className="mt-4 text-sm">
          <div className="font-medium">{tenant.legalName}</div>
          <div className="text-xs text-slate-600">{tenant.reference}</div>
          {tenant.postalAddress && <div className="text-xs text-slate-600">{tenant.postalAddress}</div>}
        </section>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-1 pr-2">{t("common.date")}</th>
                <th className="py-1 pr-2">{t("inv.stmt.entry")}</th>
                <th className="py-1 pr-2 text-right">{t("inv.stmt.debit")}</th>
                <th className="py-1 pr-2 text-right">{t("inv.stmt.credit")}</th>
                <th className="py-1 text-right">{t("inv.stmt.running")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100 font-medium">
                <td className="py-1 pr-2">{from ? formatDay(from, df) : ""}</td>
                <td className="py-1 pr-2">{t("inv.stmt.opening")}</td>
                <td /><td />
                <td className="py-1 text-right tabular-nums">{formatMoney(opening, fmt)}</td>
              </tr>
              {inPeriod.length === 0 && (
                <tr><td colSpan={5} className="py-3 text-center text-slate-500">{t("inv.stmt.empty")}</td></tr>
              )}
              {inPeriod.map((e, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="whitespace-nowrap py-1 pr-2">{formatDay(e.date, df)}</td>
                  <td className="py-1 pr-2">{e.href ? <Link href={e.href} className="hover:underline print:no-underline">{e.label}</Link> : e.label}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{e.debit.gt(0) ? formatMoney(e.debit, fmt) : ""}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{e.credit.gt(0) ? formatMoney(e.credit, fmt) : ""}</td>
                  <td className="py-1 text-right tabular-nums">{formatMoney(e.running, fmt)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="pt-3" />
                <td className="pt-3 pr-2">{t("inv.stmt.closing")}</td>
                <td className="pt-3 pr-2 text-right tabular-nums">{formatMoney(totalDebit, fmt)}</td>
                <td className="pt-3 pr-2 text-right tabular-nums">{formatMoney(totalCredit, fmt)}</td>
                <td className="pt-3 text-right tabular-nums">{formatMoney(closing, fmt)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {settings?.invoiceFooter && <footer className="mt-8 border-t border-slate-200 pt-3 text-xs text-slate-600">{settings.invoiceFooter}</footer>}
      </article>
    </>
  );
}
