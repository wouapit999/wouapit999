import Link from "next/link";
import { db } from "@/lib/db";
import { formatDay, formatMoney } from "@/lib/format";
import { sum } from "@/lib/money";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, EmptyState, Input, PageHeader, Pagination, Select, Textarea, parsePage } from "@/components/ui";
import { invoiceBalance } from "@/services/billing";
import { dayIso, todayUtcDay } from "@/services/portal";
import { submitPaymentProofAction } from "../actions";
import { OccupantNotice, PORTAL_ERROR_KEYS, dictFor, portalPage } from "../kit";

export const metadata = { title: "Payments" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

export default async function PortalPaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, tenantId, t, fmt, df, settings, occupant } = await portalPage();
  if (occupant) return <OccupantNotice t={t} title={t("nav.portal.payments")} />;
  const org = ctx.organizationId;
  const page = parsePage((await searchParams).page);
  const where = { organizationId: org, tenantId };
  const [total, rows, open] = await Promise.all([
    db.payment.count({ where }),
    db.payment.findMany({
      where,
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { receipt: { select: { id: true, number: true } } },
    }),
    db.invoice.findMany({ where: { organizationId: org, tenantId, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } }, select: { total: true, amountPaid: true, amountCredited: true } }),
  ]);
  // Proof documents: only those tied to this tenant and visible to them.
  const proofIds = rows.map((p) => p.proofDocumentId).filter((x): x is string => !!x);
  const proofs = proofIds.length
    ? await db.document.findMany({ where: { id: { in: proofIds }, organizationId: org, tenantId, visibleToTenant: true, sensitive: false }, select: { id: true } })
    : [];
  const visibleProofs = new Set(proofs.map((d) => d.id));
  const outstanding = sum(open.map(invoiceBalance));
  const methods = (settings?.enabledPaymentMethods ?? []).filter((m) => m !== "CASH");

  return (
    <>
      <PageHeader title={t("nav.portal.payments")} description={t("portal.pay.subtitle")} />
      {rows.some((p) => p.status === "PENDING") && (
        <div className="mb-4"><Alert tone="info">{t("portal.pay.pendingInfo")}</Alert></div>
      )}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <h2 className="mb-2 text-sm font-semibold">{t("portal.pay.history")}</h2>
          {rows.length === 0 ? (
            <EmptyState title={t("portal.pay.none")} />
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
              {rows.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{formatMoney(p.amount, { ...fmt, currency: p.currency })}</div>
                    <div className="text-xs text-slate-500">
                      {formatDay(p.paymentDate, df)} · {t(`portal.method.${p.method}`)}{p.externalRef ? ` · ${t("portal.pay.ref")} ${p.externalRef}` : ""}
                    </div>
                    <div className="text-xs text-slate-500 font-mono">{p.reference}</div>
                    {p.status === "REJECTED" && p.rejectionReason && <div className="mt-1 text-xs text-red-700 dark:text-red-400">{t("portal.pay.rejectedReason")}: {p.rejectionReason}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right">
                    <Badge status={p.status}>{t(`portal.payStatus.${p.status}`)}</Badge>
                    {p.receipt && p.status !== "REVERSED" && (
                      <Link className="text-xs text-[var(--brand)] hover:underline" href={`/portal/receipts/${p.receipt.id}`}>{t("portal.rcpt.view")} {p.receipt.number}</Link>
                    )}
                    {p.proofDocumentId && visibleProofs.has(p.proofDocumentId) && (
                      <a className="text-xs text-[var(--brand)] hover:underline" href={`/api/documents/${p.proofDocumentId}`}>{t("portal.pay.proof")}</a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/portal/payments" />
        </div>

        <Card className="lg:col-span-2" title={t("portal.pay.submitProof")}>
          <div id="submit" />
          {methods.length === 0 ? (
            <p className="text-sm text-slate-500">{t("portal.pay.noMethods")}</p>
          ) : (
            <ActionForm action={submitPaymentProofAction} resetOnSuccess dict={dictFor(t, PORTAL_ERROR_KEYS)}>
              <p className="text-xs text-slate-500">{t("portal.pay.submitHint")}</p>
              <Input label={t("common.amount")} name="amount" inputMode="decimal" pattern="^\d{1,12}(\.\d{1,2})?$" defaultValue={outstanding.gt(0) ? outstanding.toFixed(0) : ""} required />
              <Input label={t("portal.pay.date")} name="paymentDate" type="date" max={dayIso(todayUtcDay())} defaultValue={dayIso(todayUtcDay())} required />
              <Select label={t("portal.pay.method")} name="method" required options={methods.map((m) => ({ value: m, label: t(`portal.method.${m}`) }))} />
              <Input label={t("portal.pay.reference")} name="reference" required minLength={2} maxLength={100} hint={t("portal.pay.referenceHint")} />
              <Input label={t("portal.pay.proofFile")} name="proof" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required hint={t("portal.pay.proofHint")} />
              <Textarea label={t("common.notes")} name="notes" maxLength={1000} />
              <SubmitButton>{t("portal.pay.submit")}</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
