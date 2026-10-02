import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { invoiceWhere, paymentWhere, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay, formatMoney } from "@/lib/format";
import { money, type Decimal } from "@/lib/money";
import { EmptyState, FilterBar, PageHeader, Select, Table, Td, Th, str } from "@/components/ui";
import { AGING_BUCKETS, ageBalances, type AgingBucket } from "@/domain/aging";
import { invoiceBalance, todayUtc } from "@/services/billing";
import { OPEN_INVOICE_STATUSES } from "@/services/finance-extra";
import { financeMessages } from "../invoices/messages";
import { arrearsMessages } from "./messages";

export const metadata = { title: "Arrears" };

type Aged = Record<AgingBucket, Decimal> & { total: Decimal };

export default async function ArrearsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("arrears.view");
  const { t, locale } = await getT(financeMessages, arrearsMessages);
  const sp = await searchParams;
  const propertyId = str(sp.propertyId);
  const today = todayUtc();

  const filters: Prisma.InvoiceWhereInput[] = [invoiceWhere(ctx), { status: { in: [...OPEN_INVOICE_STATUSES] } }];
  if (propertyId) filters.push({ lease: { unit: { propertyId } } });

  const [settings, properties, invoices] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.property.findMany({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.invoice.findMany({
      where: { AND: filters },
      select: { tenantId: true, dueDate: true, total: true, amountPaid: true, amountCredited: true, tenant: { select: { legalName: true, reference: true } } },
    }),
  ]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat };

  const byTenant = new Map<string, { name: string; reference: string; items: { dueDate: Date; balance: Decimal }[] }>();
  for (const inv of invoices) {
    const e = byTenant.get(inv.tenantId) ?? { name: inv.tenant.legalName, reference: inv.tenant.reference, items: [] };
    e.items.push({ dueDate: inv.dueDate, balance: invoiceBalance(inv) });
    byTenant.set(inv.tenantId, e);
  }
  const rows = [...byTenant.entries()]
    .map(([tenantId, e]) => ({ tenantId, name: e.name, reference: e.reference, aged: ageBalances(e.items, today) as Aged }))
    .filter((r) => r.aged.total.gt(0))
    .sort((a, b) => b.aged.total.comparedTo(a.aged.total));
  const ids = rows.map((r) => r.tenantId);

  const [lastPayments, latestNotes] = ids.length
    ? await Promise.all([
        db.payment.groupBy({
          by: ["tenantId"],
          where: { AND: [paymentWhere(ctx), { tenantId: { in: ids }, status: "CONFIRMED" }] },
          _max: { paymentDate: true },
        }),
        db.collectionNote.findMany({
          where: { organizationId: ctx.organizationId, tenantId: { in: ids } },
          orderBy: { createdAt: "desc" },
          distinct: ["tenantId"],
        }),
      ])
    : [[], []];

  const totals = AGING_BUCKETS.reduce((acc, b) => ({ ...acc, [b]: rows.reduce((s, r) => s.plus(r.aged[b]), money(0)) }), {} as Record<AgingBucket, Decimal>);
  const grandTotal = rows.reduce((s, r) => s.plus(r.aged.total), money(0));

  return (
    <>
      <PageHeader title={t("arr.title")} description={t("arr.subtitle")} />
      <FilterBar action="/arrears">
        <Select label={t("common.building")} name="propertyId" defaultValue={propertyId} placeholder={t("common.all")} options={properties.map((p) => ({ value: p.id, label: p.name }))} wrapperClassName="w-full sm:w-56" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("arr.empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("common.tenant")}</Th>
              {AGING_BUCKETS.map((b) => <Th key={b} className="text-right">{t(`arr.bucket.${b}`)}</Th>)}
              <Th className="text-right">{t("arr.total")}</Th>
              <Th>{t("arr.lastPayment")}</Th>
              <Th>{t("arr.latestNote")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => {
              const last = lastPayments.find((p) => p.tenantId === r.tenantId)?._max.paymentDate;
              const note = latestNotes.find((n) => n.tenantId === r.tenantId);
              return (
                <tr key={r.tenantId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td>
                    <Link href={`/arrears/${r.tenantId}`} className="font-medium text-[var(--brand)] hover:underline">{r.name}</Link>
                    <div className="text-xs text-slate-500">{r.reference}</div>
                  </Td>
                  {AGING_BUCKETS.map((b) => (
                    <Td key={b} className={`text-right tabular-nums ${b === "d90_plus" && r.aged[b].gt(0) ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>
                      {r.aged[b].gt(0) ? formatMoney(r.aged[b], fmt) : "—"}
                    </Td>
                  ))}
                  <Td className="text-right font-semibold tabular-nums">{formatMoney(r.aged.total, fmt)}</Td>
                  <Td className="whitespace-nowrap">{last ? formatDay(last, df) : "—"}</Td>
                  <Td className="max-w-xs">
                    {note ? (
                      <>
                        <div className="text-xs font-medium">{t(`arr.kind.${note.kind}`)} · {formatDay(note.createdAt, df)}</div>
                        {note.kind === "PROMISE_TO_PAY" && note.promisedAmount && (
                          <div className="text-xs">{t("arr.promise", { amount: formatMoney(note.promisedAmount, fmt), date: formatDay(note.promisedDate, df) })}</div>
                        )}
                        {note.kind === "ESCALATION" && note.escalation && <div className="text-xs">{note.escalation}</div>}
                        <div className="truncate text-xs text-slate-500">{note.note}</div>
                      </>
                    ) : "—"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold dark:bg-slate-800">
              <Td>{t("arr.orgTotal")} · {t("arr.tenants", { n: rows.length })}</Td>
              {AGING_BUCKETS.map((b) => <Td key={b} className="text-right tabular-nums">{formatMoney(totals[b], fmt)}</Td>)}
              <Td className="text-right tabular-nums">{formatMoney(grandTotal, fmt)}</Td>
              <Td /><Td />
            </tr>
          </tfoot>
        </Table>
      )}
    </>
  );
}
