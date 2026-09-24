import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { paymentWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Badge, EmptyState, FilterBar, Input, PageHeader, Pagination, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { financeMessages } from "../invoices/messages";
import { receiptMessages } from "./messages";

export const metadata = { title: "Receipts" };
const PAGE_SIZE = 25;

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("receipt.view");
  const { t, locale } = await getT(financeMessages, receiptMessages);
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const page = parsePage(sp.page);

  const filters: Prisma.ReceiptWhereInput[] = [{ organizationId: ctx.organizationId, payment: paymentWhere(ctx) }];
  if (q) {
    filters.push({
      OR: [
        { number: { contains: q, mode: "insensitive" } },
        { payment: { reference: { contains: q, mode: "insensitive" } } },
        { payment: { tenant: { legalName: { contains: q, mode: "insensitive" } } } },
        { payment: { tenant: { reference: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  const where: Prisma.ReceiptWhereInput = { AND: filters };
  const [settings, total, rows] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.receipt.count({ where }),
    db.receipt.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, number: true, issuedAt: true,
        payment: { select: { reference: true, amount: true, currency: true, status: true, method: true, tenant: { select: { legalName: true, reference: true } } } },
      },
    }),
  ]);
  const df = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };

  return (
    <>
      <PageHeader title={t("rct.title")} description={t("rct.subtitle")} />
      <FilterBar action="/receipts">
        <Input label={t("common.search")} name="q" defaultValue={q} placeholder={t("rct.search")} wrapperClassName="w-full sm:w-64" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("rct.empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("fin.number")}</Th>
              <Th>{t("rct.issuedAt")}</Th>
              <Th>{t("common.tenant")}</Th>
              <Th>{t("fin.payment")}</Th>
              <Th className="text-right">{t("common.amount")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td><Link href={`/receipts/${r.id}`} className="font-mono text-xs font-medium text-[var(--brand)] hover:underline">{r.number}</Link></Td>
                <Td className="whitespace-nowrap">{formatDateTime(r.issuedAt, df)}</Td>
                <Td>
                  <div className="font-medium">{r.payment.tenant.legalName}</div>
                  <div className="text-xs text-slate-500">{r.payment.tenant.reference}</div>
                </Td>
                <Td><span className="font-mono text-xs">{r.payment.reference}</span> · {t(`fin.method.${r.payment.method}`)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(r.payment.amount, { locale, currency: r.payment.currency })}</Td>
                <Td>
                  {r.payment.status === "REVERSED" ? <Badge tone="red">{t("rct.reversed")}</Badge> : <Badge tone="green">{t("rct.valid")}</Badge>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/receipts" params={{ q }} />
    </>
  );
}
