import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, invoiceWhere, requireContext, tenantWhere } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, Select, Stat, Table, Td, Th, Textarea } from "@/components/ui";
import { AGING_BUCKETS, ageBalances, daysOverdue } from "@/domain/aging";
import { invoiceBalance, todayUtc } from "@/services/billing";
import { COLLECTION_NOTE_KINDS, OPEN_INVOICE_STATUSES } from "@/services/finance-extra";
import { addCollectionNoteAction } from "../actions";
import { financeMessages } from "../../invoices/messages";
import { arrearsMessages } from "../messages";

export const metadata = { title: "Arrears" };

export default async function TenantArrearsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireContext("arrears.view");
  const { t, locale } = await getT(financeMessages, arrearsMessages);
  const tenant = await db.tenant.findFirst({ where: { AND: [tenantWhere(ctx), { id: tenantId }] }, select: { id: true, legalName: true, reference: true, phone: true, email: true } });
  if (!tenant) notFound();
  const [settings, invoices, notes] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.invoice.findMany({
      where: { AND: [invoiceWhere(ctx), { tenantId: tenant.id, status: { in: [...OPEN_INVOICE_STATUSES] } }] },
      orderBy: { dueDate: "asc" },
      include: { lease: { select: { unit: { select: { number: true, property: { select: { name: true } } } } } } },
    }),
    db.collectionNote.findMany({ where: { organizationId: ctx.organizationId, tenantId: tenant.id }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const authorIds = [...new Set(notes.map((n) => n.createdById).filter((x): x is string => !!x))];
  const authors = authorIds.length ? await db.user.findMany({ where: { id: { in: authorIds }, organizationId: ctx.organizationId }, select: { id: true, name: true } }) : [];
  const today = todayUtc();
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const aged = ageBalances(invoices.map((i) => ({ dueDate: i.dueDate, balance: invoiceBalance(i) })), today);

  return (
    <>
      <PageHeader
        title={tenant.legalName}
        description={[tenant.reference, tenant.phone, tenant.email].filter(Boolean).join(" · ")}
        breadcrumbs={[{ label: t("arr.title"), href: "/arrears" }, { label: tenant.legalName }]}
        actions={
          <>
            {can(ctx, "invoice.view") && <LinkButton variant="secondary" href={`/invoices/statement/${tenant.id}`}>{t("arr.statement")}</LinkButton>}
            {can(ctx, "arrears.manage") && <LinkButton variant="secondary" href={`/arrears/${tenant.id}/notice`}>{t("arr.notice")}</LinkButton>}
            {can(ctx, "payment.record") && <LinkButton href={`/payments/new?tenantId=${tenant.id}`}>{t("arr.recordPayment")}</LinkButton>}
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {AGING_BUCKETS.map((b) => (
          <Stat key={b} label={t(`arr.bucket.${b}`)} value={formatMoney(aged[b], fmt)} tone={b === "current" || aged[b].lte(0) ? "default" : b === "d1_30" ? "warn" : "bad"} />
        ))}
        <Stat label={t("arr.total")} value={formatMoney(aged.total, fmt)} tone={aged.total.gt(0) ? "bad" : "good"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={t("arr.openInvoices")}>
            {invoices.length === 0 ? (
              <EmptyState title={t("arr.empty")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("fin.number")}</Th>
                    <Th>{t("common.unit")}</Th>
                    <Th>{t("fin.dueDate")}</Th>
                    <Th className="text-right">{t("arr.daysLate")}</Th>
                    <Th className="text-right">{t("fin.outstanding")}</Th>
                    <Th>{t("common.status")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {invoices.map((inv) => {
                    const late = Math.max(0, daysOverdue(inv.dueDate, today));
                    return (
                      <tr key={inv.id}>
                        <Td>
                          {can(ctx, "invoice.view") ? <Link href={`/invoices/${inv.id}`} className="font-mono text-xs text-[var(--brand)] hover:underline">{inv.number}</Link> : <span className="font-mono text-xs">{inv.number}</span>}
                        </Td>
                        <Td>{inv.lease ? `${inv.lease.unit.property.name} · ${inv.lease.unit.number}` : "—"}</Td>
                        <Td className="whitespace-nowrap">{formatDay(inv.dueDate, df)}</Td>
                        <Td className={`text-right tabular-nums ${late > 0 ? "text-red-700 dark:text-red-400" : ""}`}>{late}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(invoiceBalance(inv), fmt)}</Td>
                        <Td><Badge status={inv.status}>{t(`fin.invStatus.${inv.status}`)}</Badge></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {can(ctx, "arrears.manage") && (
            <Card title={t("arr.addNote")}>
              <ActionForm action={addCollectionNoteAction} resetOnSuccess>
                <input type="hidden" name="tenantId" value={tenant.id} />
                <Select label={t("arr.kind")} name="kind" options={COLLECTION_NOTE_KINDS.map((k) => ({ value: k, label: t(`arr.kind.${k}`) }))} />
                <Textarea label={t("arr.note")} name="note" required minLength={2} maxLength={2000} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label={t("arr.promisedAmount")} name="promisedAmount" type="number" min="0.01" step="0.01" hint={t("arr.promiseHint")} />
                  <Input label={t("arr.promisedDate")} name="promisedDate" type="date" />
                </div>
                <Input label={t("arr.escalation")} name="escalation" maxLength={120} hint={t("arr.escalationHint")} />
                <SubmitButton>{t("arr.addNote")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card title={t("arr.notes")}>
            {notes.length === 0 ? (
              <p className="text-sm text-slate-500">{t("arr.noNotes")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {notes.map((n) => (
                  <li key={n.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={n.kind === "ESCALATION" ? "red" : n.kind === "PROMISE_TO_PAY" ? "amber" : "slate"}>{t(`arr.kind.${n.kind}`)}</Badge>
                      <span className="text-xs text-slate-500">
                        {formatDateTime(n.createdAt, df)}
                        {n.createdById ? ` · ${t("arr.by", { name: authors.find((a) => a.id === n.createdById)?.name ?? "—" })}` : ""}
                      </span>
                    </div>
                    {n.kind === "PROMISE_TO_PAY" && n.promisedAmount && (
                      <div className="mt-1 text-xs font-medium">{t("arr.promise", { amount: formatMoney(n.promisedAmount, fmt), date: formatDay(n.promisedDate, df) })}</div>
                    )}
                    {n.kind === "ESCALATION" && n.escalation && <div className="mt-1 text-xs font-medium">{n.escalation}</div>}
                    <p className="mt-1 whitespace-pre-line">{n.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
