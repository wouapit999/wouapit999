/* eslint-disable @next/next/no-img-element */
import type { Invoice, InvoiceLine, OrganizationSettings, Tenant } from "@prisma/client";
import { formatDay, formatMoney } from "@/lib/format";
import { money } from "@/lib/money";

/** Printable, branded invoice. */
export function InvoiceView({ invoice, lines, tenant, settings, unitLabel, locale }: {
  invoice: Invoice;
  lines: InvoiceLine[];
  tenant: Pick<Tenant, "legalName" | "reference" | "postalAddress" | "email">;
  settings: OrganizationSettings | null;
  unitLabel?: string;
  locale: string;
}) {
  const fmt = { locale, currency: invoice.currency };
  const df = { dateFormat: settings?.dateFormat ?? "dd/MM/yyyy" };
  const fr = locale === "fr";
  const balance = money(invoice.total).minus(money(invoice.amountPaid)).minus(money(invoice.amountCredited));
  return (
    <article className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-8 text-slate-900 shadow-sm print:border-0 print:shadow-none">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          {settings?.logoUrl ? <img src={settings.logoUrl} alt="" className="mb-2 h-10 w-auto" /> : null}
          <div className="font-semibold">{settings?.companyName || settings?.appName}</div>
          <div className="text-xs text-slate-600">{settings?.address}</div>
          <div className="text-xs text-slate-600">{[settings?.phone, settings?.email].filter(Boolean).join(" · ")}</div>
          {settings?.taxId && <div className="text-xs text-slate-600">NIU: {settings.taxId}</div>}
          {settings?.invoiceHeader && <div className="mt-2 text-xs">{settings.invoiceHeader}</div>}
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold">{fr ? "FACTURE" : "INVOICE"}</div>
          <div className="font-mono text-sm">{invoice.number}</div>
          <div className="text-xs text-slate-600">{fr ? "Émise le" : "Issued"} {formatDay(invoice.issueDate, df)}</div>
          <div className="text-xs font-medium">{fr ? "Échéance" : "Due"} {formatDay(invoice.dueDate, df)}</div>
          {invoice.status === "VOID" && <div className="mt-1 text-sm font-bold text-red-700">{fr ? "ANNULÉE" : "VOID"}</div>}
        </div>
      </header>
      <section className="mt-4 text-sm">
        <div className="text-xs uppercase text-slate-500">{fr ? "Facturé à" : "Bill to"}</div>
        <div className="font-medium">{tenant.legalName}</div>
        <div className="text-xs text-slate-600">{tenant.reference}{unitLabel ? ` · ${unitLabel}` : ""}</div>
        {tenant.postalAddress && <div className="text-xs text-slate-600">{tenant.postalAddress}</div>}
      </section>
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="py-1">{fr ? "Description" : "Description"}</th>
            <th className="py-1 text-right">{fr ? "Qté" : "Qty"}</th>
            <th className="py-1 text-right">{fr ? "Prix unitaire" : "Unit price"}</th>
            <th className="py-1 text-right">{fr ? "Montant" : "Amount"}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-slate-100">
              <td className="py-1">{l.description}</td>
              <td className="py-1 text-right">{money(l.quantity).toString()}</td>
              <td className="py-1 text-right">{formatMoney(l.unitPrice, fmt)}</td>
              <td className="py-1 text-right">{formatMoney(l.amount, fmt)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-sm">
          <tr><td colSpan={3} className="pt-3 text-right">{fr ? "Sous-total" : "Subtotal"}</td><td className="pt-3 text-right">{formatMoney(invoice.subtotal, fmt)}</td></tr>
          {money(invoice.taxAmount).gt(0) && <tr><td colSpan={3} className="text-right">{fr ? "Taxes" : "Tax"}</td><td className="text-right">{formatMoney(invoice.taxAmount, fmt)}</td></tr>}
          <tr className="font-semibold"><td colSpan={3} className="text-right">{fr ? "Total" : "Total"}</td><td className="text-right">{formatMoney(invoice.total, fmt)}</td></tr>
          <tr><td colSpan={3} className="text-right">{fr ? "Payé" : "Paid"}</td><td className="text-right">{formatMoney(invoice.amountPaid, fmt)}</td></tr>
          {money(invoice.amountCredited).gt(0) && <tr><td colSpan={3} className="text-right">{fr ? "Avoirs" : "Credited"}</td><td className="text-right">{formatMoney(invoice.amountCredited, fmt)}</td></tr>}
          <tr className="font-semibold"><td colSpan={3} className="text-right">{fr ? "Solde dû" : "Balance due"}</td><td className="text-right">{formatMoney(balance.isNegative() ? 0 : balance, fmt)}</td></tr>
        </tfoot>
      </table>
      {invoice.notes && <p className="mt-6 text-sm">{invoice.notes}</p>}
      {settings?.invoiceFooter && <footer className="mt-8 border-t border-slate-200 pt-3 text-xs text-slate-600">{settings.invoiceFooter}</footer>}
    </article>
  );
}
