import Link from "next/link";
import type { PaymentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, paymentWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay, formatMoney } from "@/lib/format";
import { Alert, Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, cn, parsePage, str } from "@/components/ui";
import { PAYMENT_METHODS, parseDay } from "@/services/finance-extra";
import { financeMessages } from "../invoices/messages";
import { paymentMessages } from "./messages";

export const metadata = { title: "Payments" };
const PAGE_SIZE = 25;
const STATUSES: PaymentStatus[] = ["PENDING", "CONFIRMED", "REJECTED", "REVERSED"];

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("payment.view");
  const { t, locale } = await getT(financeMessages, paymentMessages);
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const status = str(sp.status);
  const method = str(sp.method);
  const fromS = str(sp.from);
  const toS = str(sp.to);
  const page = parsePage(sp.page);

  const filters: Prisma.PaymentWhereInput[] = [paymentWhere(ctx)];
  if (STATUSES.includes(status as PaymentStatus)) filters.push({ status: status as PaymentStatus });
  if ((PAYMENT_METHODS as readonly string[]).includes(method)) filters.push({ method });
  const from = parseDay(fromS);
  const to = parseDay(toS);
  if (from) filters.push({ paymentDate: { gte: from } });
  if (to) filters.push({ paymentDate: { lte: to } });
  if (q) {
    filters.push({
      OR: [
        { reference: { contains: q, mode: "insensitive" } },
        { externalRef: { contains: q, mode: "insensitive" } },
        { tenant: { legalName: { contains: q, mode: "insensitive" } } },
        { tenant: { reference: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const where: Prisma.PaymentWhereInput = { AND: filters };

  const [settings, total, rows, pendingCount] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.payment.count({ where }),
    db.payment.findMany({
      where,
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { tenant: { select: { legalName: true, reference: true } }, receipt: { select: { id: true, number: true } } },
    }),
    db.payment.count({ where: { AND: [paymentWhere(ctx), { status: "PENDING" }] } }),
  ]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat };

  return (
    <>
      <PageHeader
        title={t("pay.title")}
        description={t("pay.subtitle")}
        actions={can(ctx, "payment.record") && <LinkButton href="/payments/new">{t("pay.new")}</LinkButton>}
      />
      {pendingCount > 0 && status !== "PENDING" && (
        <div className="mb-4">
          <Alert tone="warn">
            <Link href="/payments?status=PENDING" className="font-medium underline">{t("pay.pendingCount", { n: pendingCount })}</Link>
          </Alert>
        </div>
      )}
      <FilterBar action="/payments">
        <Input label={t("common.search")} name="q" defaultValue={q} placeholder={t("pay.search")} wrapperClassName="w-full sm:w-56" />
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={STATUSES.map((s) => ({ value: s, label: t(`fin.payStatus.${s}`) }))} wrapperClassName="w-full sm:w-40" />
        <Select label={t("fin.method")} name="method" defaultValue={method} placeholder={t("common.all")} options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`fin.method.${m}`) }))} wrapperClassName="w-full sm:w-44" />
        <Input label={t("fin.from")} name="from" type="date" defaultValue={fromS} wrapperClassName="w-full sm:w-40" />
        <Input label={t("fin.to")} name="to" type="date" defaultValue={toS} wrapperClassName="w-full sm:w-40" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("pay.empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("fin.reference")}</Th>
              <Th>{t("pay.date")}</Th>
              <Th>{t("common.tenant")}</Th>
              <Th>{t("fin.method")}</Th>
              <Th className="text-right">{t("common.amount")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("fin.receipt")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((p) => (
              <tr key={p.id} className={cn("hover:bg-slate-50 dark:hover:bg-slate-800/50", p.status === "PENDING" && "bg-amber-50 dark:bg-amber-950/30")}>
                <Td>
                  <Link href={`/payments/${p.id}`} className="font-mono text-xs font-medium text-[var(--brand)] hover:underline">{p.reference}</Link>
                  {p.externalRef && <div className="text-xs text-slate-500">{p.externalRef}</div>}
                </Td>
                <Td className="whitespace-nowrap">{formatDay(p.paymentDate, df)}</Td>
                <Td>
                  <div className="font-medium">{p.tenant.legalName}</div>
                  <div className="text-xs text-slate-500">{p.tenant.reference}</div>
                </Td>
                <Td>{t(`fin.method.${p.method}`)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(p.amount, { locale, currency: p.currency || fmt.currency })}</Td>
                <Td><Badge status={p.status}>{t(`fin.payStatus.${p.status}`)}</Badge></Td>
                <Td>
                  {p.receipt ? (
                    can(ctx, "receipt.view") ? <Link href={`/receipts/${p.receipt.id}`} className="font-mono text-xs hover:underline">{p.receipt.number}</Link> : <span className="font-mono text-xs">{p.receipt.number}</span>
                  ) : "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/payments" params={{ q, status, method, from: fromS, to: toS }} />
    </>
  );
}
