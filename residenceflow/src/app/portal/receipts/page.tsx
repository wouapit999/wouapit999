import Link from "next/link";
import { db } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Badge, EmptyState, PageHeader, Pagination, Table, Td, Th, Tr, parsePage } from "@/components/ui";
import { OccupantNotice, portalPage } from "../kit";

export const metadata = { title: "Receipts" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

export default async function PortalReceiptsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, tenantId, t, fmt, df, occupant } = await portalPage();
  if (occupant) return <OccupantNotice t={t} title={t("nav.portal.receipts")} />;
  const page = parsePage((await searchParams).page);
  const where = { organizationId: ctx.organizationId, payment: { tenantId } };
  const [total, rows] = await Promise.all([
    db.receipt.count({ where }),
    db.receipt.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { payment: { select: { amount: true, currency: true, method: true, status: true } } },
    }),
  ]);
  return (
    <>
      <PageHeader title={t("nav.portal.receipts")} description={t("portal.rcpt.subtitle")} />
      {rows.length === 0 ? (
        <EmptyState title={t("portal.rcpt.none")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("portal.rcpt.number")}</Th>
              <Th>{t("common.date")}</Th>
              <Th>{t("portal.pay.method")}</Th>
              <Th className="text-right">{t("common.amount")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td><Link className="font-mono text-[var(--brand)] hover:underline" href={`/portal/receipts/${r.id}`}>{r.number}</Link></Td>
                <Td>{formatDateTime(r.issuedAt, df)}</Td>
                <Td>{t(`portal.method.${r.payment.method}`)}</Td>
                <Td className="text-right">{formatMoney(r.payment.amount, { ...fmt, currency: r.payment.currency })}</Td>
                <Td><Badge status={r.payment.status === "REVERSED" ? "REVERSED" : "CONFIRMED"}>{t(r.payment.status === "REVERSED" ? "portal.payStatus.REVERSED" : "portal.rcpt.valid")}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/portal/receipts" />
    </>
  );
}
