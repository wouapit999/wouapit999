import Link from "next/link";
import { db } from "@/lib/db";
import { formatDay, formatMoney } from "@/lib/format";
import { money, sum } from "@/lib/money";
import { invoiceBalance, tenantCredit } from "@/services/billing";
import { Badge, Card, EmptyState, PageHeader, Pagination, Stat, Table, Td, Th, Tr, parsePage } from "@/components/ui";
import { OccupantNotice, portalPage } from "../kit";

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;
const OPEN = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] as const;

export default async function PortalBillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, tenantId, t, fmt, df, occupant } = await portalPage();
  if (occupant) return <OccupantNotice t={t} title={t("nav.portal.billing")} />;
  const org = ctx.organizationId;
  const page = parsePage((await searchParams).page);
  const base = { organizationId: org, tenantId, status: { not: "DRAFT" as const } };

  const [open, total, rows, agg, credit] = await Promise.all([
    db.invoice.findMany({ where: { organizationId: org, tenantId, status: { in: [...OPEN] } }, orderBy: { dueDate: "asc" } }),
    db.invoice.count({ where: base }),
    db.invoice.findMany({ where: base, orderBy: [{ issueDate: "desc" }, { number: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.invoice.aggregate({ where: { organizationId: org, tenantId, status: { notIn: ["DRAFT", "VOID"] } }, _sum: { total: true, amountPaid: true, amountCredited: true } }),
    tenantCredit(tenantId),
  ]);
  const outstanding = sum(open.map(invoiceBalance));
  const overdue = sum(open.filter((i) => i.status === "OVERDUE").map(invoiceBalance));

  return (
    <>
      <PageHeader title={t("nav.portal.billing")} description={t("portal.bill.subtitle")} />
      <section aria-label={t("portal.bill.statement")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("portal.bill.outstanding")} value={formatMoney(outstanding, fmt)} tone={overdue.gt(0) ? "bad" : outstanding.gt(0) ? "warn" : "good"} />
        <Stat label={t("portal.bill.overdue")} value={formatMoney(overdue, fmt)} tone={overdue.gt(0) ? "bad" : "default"} />
        <Stat label={t("portal.bill.totalBilled")} value={formatMoney(money(agg._sum.total), fmt)} />
        <Stat label={t("portal.bill.totalPaid")} value={formatMoney(money(agg._sum.amountPaid), fmt)} hint={credit.gt(0) ? t("portal.home.credit", { amount: formatMoney(credit, fmt) }) : undefined} />
      </section>

      <Card className="mt-6" title={t("portal.bill.open")}>
        {open.length === 0 ? (
          <EmptyState title={t("portal.bill.nothingOpen")} />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {open.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <Link href={`/portal/billing/${i.id}`} className="font-mono text-sm font-medium text-[var(--brand)] hover:underline">{i.number}</Link>
                  <div className="text-xs text-slate-500">{t("portal.bill.due")} {formatDay(i.dueDate, df)}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{formatMoney(invoiceBalance(i), { ...fmt, currency: i.currency })}</div>
                  <Badge status={i.status}>{t(`portal.inv.${i.status}`)}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <h2 className="mb-2 mt-6 text-sm font-semibold">{t("portal.bill.all")}</h2>
      {rows.length === 0 ? (
        <EmptyState title={t("portal.bill.none")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("portal.bill.number")}</Th>
              <Th>{t("portal.bill.issued")}</Th>
              <Th>{t("portal.bill.due")}</Th>
              <Th className="text-right">{t("common.total")}</Th>
              <Th className="text-right">{t("portal.bill.balance")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((i) => (
              <Tr key={i.id}>
                <Td><Link href={`/portal/billing/${i.id}`} className="font-mono text-[var(--brand)] hover:underline">{i.number}</Link></Td>
                <Td>{formatDay(i.issueDate, df)}</Td>
                <Td>{formatDay(i.dueDate, df)}</Td>
                <Td className="text-right">{formatMoney(i.total, { ...fmt, currency: i.currency })}</Td>
                <Td className="text-right">{i.status === "VOID" ? "—" : formatMoney(invoiceBalance(i), { ...fmt, currency: i.currency })}</Td>
                <Td><Badge status={i.status}>{t(`portal.inv.${i.status}`)}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/portal/billing" />
    </>
  );
}
