import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, invoiceWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDate, formatDay, formatMoney } from "@/lib/format";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, Input, LinkButton, PageHeader, Table, Td, Th, Textarea } from "@/components/ui";
import { InvoiceView } from "@/components/finance/invoice-view";
import { PrintButton } from "@/components/print-button";
import { invoiceBalance } from "@/services/billing";
import { creditInvoiceAction, emailInvoiceAction, issueInvoiceAction, voidInvoiceAction } from "../actions";
import { financeMessages, invoiceMessages } from "../messages";

export const metadata = { title: "Invoice" };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("invoice.view");
  const { t, locale } = await getT(financeMessages, invoiceMessages);
  const invoice = await db.invoice.findFirst({
    where: { AND: [invoiceWhere(ctx), { id }] },
    include: {
      lines: true,
      tenant: { select: { id: true, legalName: true, reference: true, postalAddress: true, email: true } },
      lease: { select: { id: true, reference: true, unit: { select: { number: true, property: { select: { name: true } } } } } },
      allocations: { orderBy: { createdAt: "asc" }, include: { payment: { select: { id: true, reference: true, status: true, paymentDate: true, method: true } } } },
      creditNotes: { orderBy: { createdAt: "asc" } },
      schedules: { orderBy: { periodStart: "asc" } },
    },
  });
  if (!invoice) notFound();
  const settings = await getOrgSettings(ctx.organizationId);
  const fmt = { locale, currency: invoice.currency };
  const df = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const balance = invoiceBalance(invoice);
  const isOpen = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(invoice.status);
  const unitLabel = invoice.lease ? `${invoice.lease.unit.property.name} · ${invoice.lease.unit.number}` : undefined;
  const canVoid = can(ctx, "invoice.void") && invoice.status !== "VOID";
  const canCredit = can(ctx, "invoice.void") && isOpen && balance.gt(0);

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={`${t("fin.invoice")} ${invoice.number}`}
          description={`${invoice.tenant.legalName} · ${invoice.tenant.reference}`}
          breadcrumbs={[{ label: t("inv.title"), href: "/invoices" }, { label: invoice.number }]}
          actions={
            <>
              <Badge status={invoice.status}>{t(`fin.invStatus.${invoice.status}`)}</Badge>
              <PrintButton label={t("fin.print")} />
              <LinkButton variant="secondary" href={`/invoices/statement/${invoice.tenant.id}`}>{t("inv.statement")}</LinkButton>
              {invoice.status === "DRAFT" && can(ctx, "invoice.issue") && (
                <InlineAction action={issueInvoiceAction} label={t("inv.issue")} variant="primary" confirm={t("inv.issueConfirm")} hidden={{ id: invoice.id }} />
              )}
              {can(ctx, "invoice.issue") && invoice.status !== "DRAFT" && invoice.status !== "VOID" && (
                <InlineAction action={emailInvoiceAction} label={t("inv.email")} variant="secondary" hidden={{ id: invoice.id }} />
              )}
            </>
          }
        />
        {invoice.status === "DRAFT" && <div className="mb-4"><Alert tone="info">{t("inv.draftNote")}</Alert></div>}
        {invoice.status === "VOID" && invoice.voidReason && <div className="mb-4"><Alert tone="error">{t("inv.voidedWithReason", { reason: invoice.voidReason })}</Alert></div>}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <InvoiceView invoice={invoice} lines={invoice.lines} tenant={invoice.tenant} settings={settings} unitLabel={unitLabel} locale={locale} />
        </div>
        <div className="no-print space-y-6">
          <Card title={t("inv.allocations")}>
            {invoice.allocations.length === 0 ? (
              <p className="text-sm text-slate-500">{t("inv.noAllocations")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {invoice.allocations.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      {can(ctx, "payment.view") ? (
                        <Link href={`/payments/${a.payment.id}`} className="font-mono text-xs text-[var(--brand)] hover:underline">{a.payment.reference}</Link>
                      ) : (
                        <span className="font-mono text-xs">{a.payment.reference}</span>
                      )}
                      <div className="text-xs text-slate-500">{formatDay(a.payment.paymentDate, df)} · {t(`fin.method.${a.payment.method}`)}</div>
                    </div>
                    <div className="text-right">
                      <div className={a.reversed ? "tabular-nums line-through text-slate-500" : "tabular-nums"}>{formatMoney(a.amount, fmt)}</div>
                      {a.reversed && <Badge tone="red">{t("fin.reversed")}</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {invoice.creditNotes.length > 0 && (
            <Card title={t("inv.creditNotes")}>
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {invoice.creditNotes.map((c) => (
                  <li key={c.id} className="py-2">
                    <div className="flex justify-between gap-2"><span className="font-mono text-xs">{c.number}</span><span className="tabular-nums">{formatMoney(c.amount, fmt)}</span></div>
                    <div className="text-xs text-slate-500">{formatDate(c.createdAt, df)} · {c.reason}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {invoice.schedules.length > 0 && (
            <Card title={t("inv.schedules")}>
              <Table>
                <thead><tr><Th>{t("inv.chargeType")}</Th><Th>{t("inv.period")}</Th><Th className="text-right">{t("common.amount")}</Th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {invoice.schedules.map((s) => (
                    <tr key={s.id}>
                      <Td>{t(`fin.charge.${s.chargeType}`)}</Td>
                      <Td className="whitespace-nowrap">{formatDay(s.periodStart, df)} → {formatDay(s.periodEnd, df)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(s.amount, fmt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          {canCredit && (
            <Card title={t("inv.credit")}>
              <ActionForm action={creditInvoiceAction} resetOnSuccess>
                <input type="hidden" name="id" value={invoice.id} />
                <Input label={t("inv.creditAmount")} name="amount" type="number" min="0.01" step="0.01" max={balance.toFixed(2)} required hint={`${t("fin.outstanding")}: ${formatMoney(balance, fmt)}`} />
                <Textarea label={t("common.reason")} name="reason" required minLength={3} maxLength={500} />
                <SubmitButton variant="secondary">{t("inv.credit")}</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {canVoid && (
            <Card title={t("inv.void")}>
              <ActionForm action={voidInvoiceAction} confirm={t("inv.voidConfirm")}>
                <input type="hidden" name="id" value={invoice.id} />
                <Textarea label={t("inv.voidReason")} name="reason" required minLength={3} maxLength={500} />
                <SubmitButton variant="danger">{t("inv.void")}</SubmitButton>
              </ActionForm>
            </Card>
          )}

        </div>
      </div>
    </>
  );
}
