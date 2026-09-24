import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, paymentWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { money, sum } from "@/lib/money";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, DescriptionList, LinkButton, PageHeader, Textarea, str } from "@/components/ui";
import { approvePaymentAction, rejectPaymentAction, reversePaymentAction } from "../actions";
import { financeMessages } from "../../invoices/messages";
import { paymentMessages } from "../messages";

export const metadata = { title: "Payment" };

export default async function PaymentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireContext("payment.view");
  const { t, locale } = await getT(financeMessages, paymentMessages);
  const payment = await db.payment.findFirst({
    where: { AND: [paymentWhere(ctx), { id }] },
    include: {
      tenant: { select: { id: true, legalName: true, reference: true } },
      lease: { select: { reference: true, unit: { select: { number: true, property: { select: { name: true } } } } } },
      allocations: { orderBy: { createdAt: "asc" }, include: { invoice: { select: { id: true, number: true, status: true } } } },
      receipt: { select: { id: true, number: true } },
      reversal: true,
    },
  });
  if (!payment) notFound();
  const settings = await getOrgSettings(ctx.organizationId);
  const userIds = [payment.recordedById, payment.approvedById, payment.reversal?.reversedById].filter((x): x is string => !!x);
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds }, organizationId: ctx.organizationId }, select: { id: true, name: true } })
    : [];
  const nameOf = (uid: string | null | undefined) => users.find((u) => u.id === uid)?.name ?? "—";
  const fmt = { locale, currency: payment.currency };
  const df = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const allocatedLive = sum(payment.allocations.filter((a) => !a.reversed).map((a) => a.amount));
  const unapplied = payment.status === "CONFIRMED" ? money(payment.amount).minus(allocatedLive) : money(0);
  const recorded = str(sp.recorded);

  return (
    <>
      <PageHeader
        title={`${t("fin.payment")} ${payment.reference}`}
        description={`${payment.tenant.legalName} · ${payment.tenant.reference}`}
        breadcrumbs={[{ label: t("pay.title"), href: "/payments" }, { label: payment.reference }]}
        actions={
          <>
            <Badge status={payment.status}>{t(`fin.payStatus.${payment.status}`)}</Badge>
            {payment.receipt && can(ctx, "receipt.view") && <LinkButton variant="secondary" href={`/receipts/${payment.receipt.id}`}>{t("pay.viewReceipt")}</LinkButton>}
            {payment.proofDocumentId && <a className="text-sm font-medium text-[var(--brand)] hover:underline" href={`/api/documents/${payment.proofDocumentId}`}>{t("pay.downloadProof")}</a>}
          </>
        }
      />
      <div className="mb-4 space-y-2">
        {recorded === "confirmed" && payment.status === "CONFIRMED" && <Alert tone="success">{t("pay.recordedConfirmed")}</Alert>}
        {recorded === "pending" && payment.status === "PENDING" && <Alert tone="warn">{t("pay.recordedPending")}</Alert>}
        {recorded !== "pending" && payment.status === "PENDING" && <Alert tone="warn">{t("pay.pendingInfo")}</Alert>}
        {payment.status === "REJECTED" && <Alert tone="error">{t("pay.rejectedInfo", { reason: payment.rejectionReason ?? "" })}</Alert>}
        {payment.reversal && (
          <Alert tone="error">{t("pay.reversalInfo", { date: formatDateTime(payment.reversal.createdAt, df), by: nameOf(payment.reversal.reversedById), reason: payment.reversal.reason })}</Alert>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("pay.details")}>
            <DescriptionList
              items={[
                { label: t("common.amount"), value: <span className="text-lg font-semibold">{formatMoney(payment.amount, fmt)}</span> },
                { label: t("pay.date"), value: formatDay(payment.paymentDate, df) },
                { label: t("fin.method"), value: t(`fin.method.${payment.method}`) },
                { label: t("pay.externalRef"), value: payment.externalRef },
                { label: t("pay.receivingAccount"), value: payment.receivingAccount },
                { label: t("common.tenant"), value: payment.tenant.legalName },
                { label: t("fin.lease"), value: payment.lease ? `${payment.lease.reference} · ${payment.lease.unit.property.name} ${payment.lease.unit.number}` : null },
                { label: t("pay.recordedBy"), value: payment.submittedByTenant ? t("pay.submittedByTenant") : nameOf(payment.recordedById) },
                { label: t("pay.approvedBy"), value: payment.approvedById ? `${nameOf(payment.approvedById)} · ${formatDateTime(payment.approvedAt, df)}` : null },
                { label: t("fin.receipt"), value: payment.receipt?.number },
                { label: t("common.notes"), value: payment.notes },
              ]}
            />
          </Card>
          <Card title={t("pay.allocations")}>
            {payment.allocations.length === 0 ? (
              <p className="text-sm text-slate-500">{t("pay.noAllocations")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {payment.allocations.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="flex items-center gap-2">
                      {can(ctx, "invoice.view") ? (
                        <Link href={`/invoices/${a.invoice.id}`} className="font-mono text-xs text-[var(--brand)] hover:underline">{a.invoice.number}</Link>
                      ) : (
                        <span className="font-mono text-xs">{a.invoice.number}</span>
                      )}
                      <Badge status={a.invoice.status}>{t(`fin.invStatus.${a.invoice.status}`)}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={a.reversed ? "tabular-nums line-through text-slate-500" : "tabular-nums"}>{formatMoney(a.amount, fmt)}</span>
                      {a.reversed && <Badge tone="red">{t("fin.reversed")}</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {unapplied.gt(0) && (
              <p className="mt-3 flex justify-between border-t border-slate-200 pt-2 text-sm dark:border-slate-700">
                <span>{t("pay.unapplied")}</span><span className="tabular-nums">{formatMoney(unapplied, fmt)}</span>
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {payment.status === "PENDING" && can(ctx, "payment.approve") && (
            <Card title={t("pay.approve")}>
              <div className="space-y-4">
                <InlineAction action={approvePaymentAction} label={t("pay.approve")} variant="primary" confirm={t("pay.approveConfirm")} hidden={{ id: payment.id }} />
                <ActionForm action={rejectPaymentAction} confirm={t("pay.rejectConfirm")}>
                  <input type="hidden" name="id" value={payment.id} />
                  <Textarea label={t("pay.rejectionReason")} name="reason" required minLength={3} maxLength={500} />
                  <SubmitButton variant="danger">{t("pay.reject")}</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          )}
          {payment.status === "CONFIRMED" && can(ctx, "payment.reverse") && (
            <Card title={t("pay.reverse")}>
              <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">{t("pay.reverseHint")}</p>
              <ActionForm action={reversePaymentAction} confirm={t("pay.reverseConfirm")}>
                <input type="hidden" name="id" value={payment.id} />
                <Textarea label={t("common.reason")} name="reason" required minLength={5} maxLength={500} />
                <SubmitButton variant="danger">{t("pay.reverse")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
