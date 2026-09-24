import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, leaseWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Badge, Card, DescriptionList, Field, Input, LinkButton, PageHeader, Select, Stat, Textarea, inputClass } from "@/components/ui";
import { depositEvidencePrefix, depositTotals } from "@/services/deposits";
import { PAYMENT_METHODS } from "@/services/finance-extra";
import { approveDepositTxAction, recordDepositTxAction, rejectDepositTxAction } from "../actions";
import { financeMessages } from "../../invoices/messages";
import { depositMessages } from "../messages";

export const metadata = { title: "Security deposit" };

export default async function DepositDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("deposit.view");
  const { t, locale } = await getT(financeMessages, depositMessages);
  const deposit = await db.securityDeposit.findFirst({
    where: { id, organizationId: ctx.organizationId, lease: leaseWhere(ctx) },
    include: {
      transactions: { orderBy: { createdAt: "asc" } },
      lease: {
        select: {
          id: true, reference: true, status: true, currency: true, startDate: true, endDate: true, moveOutDate: true,
          tenant: { select: { id: true, legalName: true, reference: true } },
          unit: { select: { number: true, property: { select: { name: true } } } },
        },
      },
    },
  });
  if (!deposit) notFound();
  const [settings, evidence] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.document.findMany({
      where: { organizationId: ctx.organizationId, leaseId: deposit.lease.id, category: "LEASE", name: { startsWith: "deposit-evidence-" } },
      select: { id: true, name: true },
    }),
  ]);
  const userIds = [...new Set(deposit.transactions.flatMap((x) => [x.createdById, x.approvedById]).filter((x): x is string => !!x))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds }, organizationId: ctx.organizationId }, select: { id: true, name: true } }) : [];
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const fmt = { locale, currency: deposit.lease.currency || settings?.currency || "XAF" };
  const df = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const totals = depositTotals(deposit.transactions);
  const available = totals.held.minus(totals.pendingOut);
  const methods = (settings?.enabledPaymentMethods ?? [...PAYMENT_METHODS]).filter((m) => (PAYMENT_METHODS as readonly string[]).includes(m));
  const methodOptions = methods.map((m) => ({ value: m, label: t(`fin.method.${m}`) }));
  const canManage = can(ctx, "deposit.manage");
  const canApprove = can(ctx, "deposit.approve");
  const thresholdHint = settings ? t("dep.thresholdHint", { amount: formatMoney(settings.expenseApprovalThreshold, fmt) }) : undefined;

  return (
    <>
      <PageHeader
        title={`${t("dep.title")} · ${deposit.lease.tenant.legalName}`}
        description={`${deposit.lease.reference} · ${deposit.lease.unit.property.name} ${deposit.lease.unit.number}`}
        breadcrumbs={[{ label: t("dep.title"), href: "/deposits" }, { label: deposit.lease.reference }]}
        actions={
          <>
            <Badge status={deposit.status}>{t(`dep.status.${deposit.status}`)}</Badge>
            <LinkButton variant="secondary" href={`/deposits/${deposit.id}/statement`}>{t("dep.statement")}</LinkButton>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={t("dep.required")} value={formatMoney(deposit.required, fmt)} />
        <Stat label={t("dep.received")} value={formatMoney(totals.received, fmt)} tone={totals.received.lt(deposit.required) ? "warn" : "good"} />
        <Stat label={t("dep.deducted")} value={formatMoney(totals.deducted, fmt)} />
        <Stat label={t("dep.refunded")} value={formatMoney(totals.refunded, fmt)} />
        <Stat label={t("dep.held")} value={formatMoney(totals.held, fmt)} hint={totals.pendingOut.gt(0) ? `${t("dep.pendingOut")}: ${formatMoney(totals.pendingOut, fmt)}` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("dep.transactions")}>
            {deposit.transactions.length === 0 ? (
              <p className="text-sm text-slate-500">{t("dep.noTransactions")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {deposit.transactions.map((x) => {
                  const docs = evidence.filter((d) => d.name.startsWith(depositEvidencePrefix(x.id)));
                  const isPending = x.status === "PENDING_APPROVAL";
                  return (
                    <li key={x.id} className="py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={x.type === "RECEIPT" ? "green" : x.type === "REFUND" ? "blue" : "violet"}>{t(`dep.type.${x.type}`)}</Badge>
                            <Badge status={x.status}>{t(`dep.txStatus.${x.status}`)}</Badge>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatDateTime(x.createdAt, df)} · {t("dep.by", { name: nameOf(x.createdById) })}
                            {x.approvedById && x.status === "APPROVED" && x.approvedById !== x.createdById ? ` · ${t("dep.approvedBy", { name: nameOf(x.approvedById) })}` : ""}
                            {x.method ? ` · ${t(`fin.method.${x.method}`)}` : ""}
                          </div>
                          {x.description && <p className="mt-1 whitespace-pre-line">{x.description}</p>}
                          {docs.map((d) => (
                            <a key={d.id} href={`/api/documents/${d.id}`} className="mt-1 block text-xs text-[var(--brand)] hover:underline">
                              {d.name.slice(depositEvidencePrefix(x.id).length) || d.name}
                            </a>
                          ))}
                        </div>
                        <div className={`text-right font-semibold tabular-nums ${x.status === "REJECTED" ? "line-through text-slate-400" : ""}`}>
                          {x.type === "RECEIPT" ? "+" : "−"}{formatMoney(x.amount, fmt)}
                        </div>
                      </div>
                      {isPending && canApprove && x.createdById !== ctx.user.id && (
                        <div className="mt-3 flex flex-wrap items-start gap-3 rounded-md bg-amber-50 p-3 dark:bg-amber-950/30">
                          <InlineAction action={approveDepositTxAction} label={t("dep.approve")} variant="primary" confirm={t("dep.approveConfirm")} hidden={{ depositId: deposit.id, transactionId: x.id }} />
                          <ActionForm action={rejectDepositTxAction} className="flex flex-1 flex-wrap items-end gap-2 space-y-0">
                            <input type="hidden" name="depositId" value={deposit.id} />
                            <input type="hidden" name="transactionId" value={x.id} />
                            <Input label={t("dep.rejectReason")} name="reason" required minLength={3} maxLength={500} wrapperClassName="min-w-48 flex-1" />
                            <SubmitButton variant="danger">{t("dep.reject")}</SubmitButton>
                          </ActionForm>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card>
            <DescriptionList
              items={[
                { label: t("common.tenant"), value: `${deposit.lease.tenant.legalName} (${deposit.lease.tenant.reference})` },
                { label: t("fin.lease"), value: `${deposit.lease.reference} · ${formatDay(deposit.lease.startDate, df)} → ${formatDay(deposit.lease.endDate, df)}` },
                { label: t("dep.heldIn"), value: deposit.heldIn },
                { label: t("dep.stmt.moveOut"), value: deposit.lease.moveOutDate ? formatDay(deposit.lease.moveOutDate, df) : null },
              ]}
            />
          </Card>
        </div>

        {canManage && (
          <div className="space-y-6">
            <Card title={t("dep.recordReceipt")}>
              <ActionForm action={recordDepositTxAction} resetOnSuccess>
                <input type="hidden" name="depositId" value={deposit.id} />
                <input type="hidden" name="type" value="RECEIPT" />
                <Input label={t("common.amount")} name="amount" type="number" min="0.01" step="0.01" required hint={thresholdHint} />
                <Select label={t("fin.method")} name="method" required options={methodOptions} />
                <Input label={t("dep.heldIn")} name="heldIn" maxLength={200} defaultValue={deposit.heldIn} hint={t("dep.heldInHint")} />
                <Textarea label={t("dep.description")} name="description" maxLength={1000} rows={2} />
                <SubmitButton>{t("dep.recordReceipt")}</SubmitButton>
              </ActionForm>
            </Card>
            <Card title={t("dep.recordDeduction")}>
              <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">{t("dep.available", { amount: formatMoney(available, fmt) })}</p>
              <ActionForm action={recordDepositTxAction} resetOnSuccess>
                <input type="hidden" name="depositId" value={deposit.id} />
                <input type="hidden" name="type" value="DEDUCTION" />
                <Textarea label={t("dep.description")} name="description" required maxLength={1000} rows={2} />
                <Input label={t("common.amount")} name="amount" type="number" min="0.01" step="0.01" max={available.gt(0) ? available.toFixed(2) : undefined} required hint={thresholdHint} />
                <Field label={t("dep.evidence")} name="evidence" hint={t("dep.evidenceHint")}>
                  <input id="evidence" name="evidence" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className={inputClass} />
                </Field>
                <SubmitButton variant="secondary">{t("dep.recordDeduction")}</SubmitButton>
              </ActionForm>
            </Card>
            <Card title={t("dep.recordRefund")}>
              <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">{t("dep.available", { amount: formatMoney(available, fmt) })}</p>
              <ActionForm action={recordDepositTxAction} resetOnSuccess>
                <input type="hidden" name="depositId" value={deposit.id} />
                <input type="hidden" name="type" value="REFUND" />
                <Input label={t("common.amount")} name="amount" type="number" min="0.01" step="0.01" max={available.gt(0) ? available.toFixed(2) : undefined} required hint={thresholdHint} />
                <Select label={t("fin.method")} name="method" required options={methodOptions} />
                <Textarea label={t("dep.description")} name="description" maxLength={1000} rows={2} />
                <SubmitButton variant="secondary">{t("dep.recordRefund")}</SubmitButton>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
