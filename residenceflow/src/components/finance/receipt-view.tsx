/* eslint-disable @next/next/no-img-element */
import { formatMoney } from "@/lib/format";

export interface ReceiptSnapshot {
  organization: { appName?: string; companyName?: string; address?: string; phone?: string; email?: string; taxId?: string; logoUrl?: string | null; receiptFooter?: string };
  tenant: { reference: string; name: string };
  unit: { property: string; number: string } | null;
  payment: { reference: string; amount: string; currency: string; date: string; method: string; externalRef?: string | null };
  allocations: { invoice: string; amount: string }[];
  unapplied: string;
  collector: string | null;
}

/** Printable receipt rendered from the immutable snapshot captured at issue time. */
export function ReceiptView({ number, issuedAt, verificationCode, snapshot, reversed, locale, verifyUrl }: {
  number: string;
  issuedAt: string;
  verificationCode: string;
  snapshot: ReceiptSnapshot;
  reversed?: boolean;
  locale: string;
  verifyUrl: string;
}) {
  const s = snapshot;
  const fmt = { locale, currency: s.payment.currency };
  const fr = locale === "fr";
  return (
    <article className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-8 text-slate-900 shadow-sm print:border-0 print:shadow-none">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          {s.organization.logoUrl ? <img src={s.organization.logoUrl} alt="" className="mb-2 h-10 w-auto" /> : null}
          <div className="font-semibold">{s.organization.companyName || s.organization.appName}</div>
          <div className="text-xs text-slate-600">{s.organization.address}</div>
          <div className="text-xs text-slate-600">{[s.organization.phone, s.organization.email].filter(Boolean).join(" · ")}</div>
          {s.organization.taxId && <div className="text-xs text-slate-600">NIU: {s.organization.taxId}</div>}
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold">{fr ? "REÇU" : "RECEIPT"}</div>
          <div className="font-mono text-sm">{number}</div>
          <div className="text-xs text-slate-600">{issuedAt}</div>
        </div>
      </header>
      {reversed && (
        <p className="mt-4 rounded border border-red-400 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
          {fr ? "PAIEMENT ANNULÉ — ce reçu n'est plus valide." : "PAYMENT REVERSED — this receipt is no longer valid."}
        </p>
      )}
      <section className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs uppercase text-slate-500">{fr ? "Reçu de" : "Received from"}</div>
          <div className="font-medium">{s.tenant.name}</div>
          <div className="text-xs text-slate-600">{s.tenant.reference}</div>
          {s.unit && <div className="text-xs text-slate-600">{s.unit.property} · {s.unit.number}</div>}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase text-slate-500">{fr ? "Montant" : "Amount"}</div>
          <div className="text-2xl font-semibold">{formatMoney(s.payment.amount, fmt)}</div>
          <div className="text-xs text-slate-600">{s.payment.method.replace(/_/g, " ")} · {s.payment.date}</div>
          {s.payment.externalRef && <div className="text-xs text-slate-600">Ref: {s.payment.externalRef}</div>}
          <div className="text-xs text-slate-600">{fr ? "Paiement" : "Payment"} {s.payment.reference}</div>
        </div>
      </section>
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="py-1">{fr ? "Facture" : "Invoice"}</th>
            <th className="py-1 text-right">{fr ? "Montant affecté" : "Amount applied"}</th>
          </tr>
        </thead>
        <tbody>
          {s.allocations.map((a, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="py-1 font-mono">{a.invoice}</td>
              <td className="py-1 text-right">{formatMoney(a.amount, fmt)}</td>
            </tr>
          ))}
          {Number(s.unapplied) > 0 && (
            <tr>
              <td className="py-1">{fr ? "Crédit non affecté" : "Unapplied credit"}</td>
              <td className="py-1 text-right">{formatMoney(s.unapplied, fmt)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <footer className="mt-8 flex items-end justify-between gap-4 text-xs text-slate-600">
        <div>
          {s.collector && <div>{fr ? "Encaissé par" : "Collected by"}: {s.collector}</div>}
          <div className="mt-1">{s.organization.receiptFooter}</div>
        </div>
        <div className="text-right">
          <div>{fr ? "Code de vérification" : "Verification code"}</div>
          <div className="font-mono text-sm text-slate-900">{verificationCode}</div>
          <div className="break-all">{verifyUrl}</div>
        </div>
      </footer>
    </article>
  );
}
