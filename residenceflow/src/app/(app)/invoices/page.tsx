import Link from "next/link";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, invoiceWhere, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay, formatMoney } from "@/lib/format";
import { money } from "@/lib/money";
import { Badge, Checkbox, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, parsePage, str } from "@/components/ui";
import { invoiceBalance, todayUtc } from "@/services/billing";
import { OPEN_INVOICE_STATUSES, parseDay } from "@/services/finance-extra";
import { financeMessages, invoiceMessages } from "./messages";

export const metadata = { title: "Invoices" };
const PAGE_SIZE = 25;
const STATUSES: InvoiceStatus[] = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID", "CREDITED"];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("invoice.view");
  const { t, locale } = await getT(financeMessages, invoiceMessages);
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const status = str(sp.status);
  const propertyId = str(sp.propertyId);
  const dueFrom = str(sp.dueFrom);
  const dueTo = str(sp.dueTo);
  const overdue = str(sp.overdue) === "on" ? "on" : "";
  const page = parsePage(sp.page);
  const today = todayUtc();

  const filters: Prisma.InvoiceWhereInput[] = [invoiceWhere(ctx)];
  if (STATUSES.includes(status as InvoiceStatus)) filters.push({ status: status as InvoiceStatus });
  if (propertyId) filters.push({ lease: { unit: { propertyId } } });
  const from = parseDay(dueFrom);
  const to = parseDay(dueTo);
  if (from) filters.push({ dueDate: { gte: from } });
  if (to) filters.push({ dueDate: { lte: to } });
  if (overdue) filters.push({ OR: [{ status: "OVERDUE" }, { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: today } }] });
  if (q) {
    filters.push({
      OR: [
        { number: { contains: q, mode: "insensitive" } },
        { tenant: { legalName: { contains: q, mode: "insensitive" } } },
        { tenant: { reference: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const where: Prisma.InvoiceWhereInput = { AND: filters };

  const [settings, properties, total, rows, agg] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.property.findMany({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.invoice.count({ where }),
    db.invoice.findMany({
      where,
      orderBy: [{ dueDate: "desc" }, { number: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { tenant: { select: { id: true, legalName: true, reference: true } }, lease: { select: { unit: { select: { number: true, property: { select: { name: true } } } } } } },
    }),
    db.invoice.aggregate({
      where: { AND: [...filters, { status: { in: [...OPEN_INVOICE_STATUSES] } }] },
      _sum: { total: true, amountPaid: true, amountCredited: true },
    }),
  ]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat };
  const outstanding = money(agg._sum.total).minus(money(agg._sum.amountPaid)).minus(money(agg._sum.amountCredited));

  return (
    <>
      <PageHeader
        title={t("inv.title")}
        description={t("inv.subtitle")}
        actions={can(ctx, "invoice.create") && <LinkButton href="/invoices/new">{t("inv.new")}</LinkButton>}
      />
      <FilterBar action="/invoices">
        <Input label={t("common.search")} name="q" defaultValue={q} placeholder={t("fin.tenantSearch")} wrapperClassName="w-full sm:w-56" />
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={STATUSES.map((s) => ({ value: s, label: t(`fin.invStatus.${s}`) }))} wrapperClassName="w-full sm:w-44" />
        <Select label={t("common.building")} name="propertyId" defaultValue={propertyId} placeholder={t("common.all")} options={properties.map((p) => ({ value: p.id, label: p.name }))} wrapperClassName="w-full sm:w-48" />
        <Input label={t("inv.dueFrom")} name="dueFrom" type="date" defaultValue={dueFrom} wrapperClassName="w-full sm:w-40" />
        <Input label={t("inv.dueTo")} name="dueTo" type="date" defaultValue={dueTo} wrapperClassName="w-full sm:w-40" />
        <div className="pb-2"><Checkbox label={t("inv.overdueOnly")} name="overdue" defaultChecked={!!overdue} /></div>
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("inv.empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("fin.number")}</Th>
              <Th>{t("common.tenant")}</Th>
              <Th>{t("common.unit")}</Th>
              <Th>{t("fin.issueDate")}</Th>
              <Th>{t("fin.dueDate")}</Th>
              <Th className="text-right">{t("fin.total")}</Th>
              <Th className="text-right">{t("fin.outstanding")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((inv) => {
              const open = (OPEN_INVOICE_STATUSES as readonly string[]).includes(inv.status);
              const late = open && inv.dueDate < today;
              return (
                <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td><Link href={`/invoices/${inv.id}`} className="font-mono text-xs font-medium text-[var(--brand)] hover:underline">{inv.number}</Link></Td>
                  <Td>
                    <div className="font-medium">{inv.tenant.legalName}</div>
                    <div className="text-xs text-slate-500">{inv.tenant.reference}</div>
                  </Td>
                  <Td>{inv.lease ? `${inv.lease.unit.property.name} · ${inv.lease.unit.number}` : "—"}</Td>
                  <Td>{formatDay(inv.issueDate, df)}</Td>
                  <Td className={late ? "font-medium text-red-700 dark:text-red-400" : undefined}>{formatDay(inv.dueDate, df)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(inv.total, fmt)}</Td>
                  <Td className="text-right tabular-nums">{open ? formatMoney(invoiceBalance(inv), fmt) : "—"}</Td>
                  <Td><Badge status={inv.status}>{t(`fin.invStatus.${inv.status}`)}</Badge></Td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold dark:bg-slate-800">
              <Td colSpan={6} className="text-right">{t("inv.outstandingTotal")}</Td>
              <Td className="text-right tabular-nums">{formatMoney(outstanding.isNegative() ? 0 : outstanding, fmt)}</Td>
              <Td />
            </tr>
          </tfoot>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/invoices" params={{ q, status, propertyId, dueFrom, dueTo, overdue }} />
    </>
  );
}
