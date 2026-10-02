import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { leaseWhere, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/format";
import { Badge, EmptyState, FilterBar, Input, PageHeader, Pagination, Select, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { depositTotals } from "@/services/deposits";
import { financeMessages } from "../invoices/messages";
import { depositMessages } from "./messages";

export const metadata = { title: "Security deposits" };
const PAGE_SIZE = 25;
const STATUSES = ["PENDING", "HELD", "PARTIALLY_REFUNDED", "REFUNDED", "FORFEITED"];

export default async function DepositsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("deposit.view");
  const { t, locale } = await getT(financeMessages, depositMessages);
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const status = str(sp.status);
  const propertyId = str(sp.propertyId);
  const page = parsePage(sp.page);

  const leaseFilters: Prisma.LeaseWhereInput[] = [leaseWhere(ctx)];
  if (propertyId) leaseFilters.push({ unit: { propertyId } });
  if (q) {
    leaseFilters.push({
      OR: [
        { reference: { contains: q, mode: "insensitive" } },
        { tenant: { legalName: { contains: q, mode: "insensitive" } } },
        { tenant: { reference: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const where: Prisma.SecurityDepositWhereInput = {
    organizationId: ctx.organizationId,
    lease: { AND: leaseFilters },
    ...(STATUSES.includes(status) ? { status } : {}),
  };
  const [settings, properties, total, rows] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.property.findMany({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.securityDeposit.count({ where }),
    db.securityDeposit.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        transactions: { select: { type: true, amount: true, status: true } },
        lease: { select: { reference: true, status: true, currency: true, tenant: { select: { legalName: true, reference: true } }, unit: { select: { number: true, property: { select: { name: true } } } } } },
      },
    }),
  ]);
  const currency = settings?.currency ?? "XAF";

  return (
    <>
      <PageHeader title={t("dep.title")} description={t("dep.subtitle")} />
      <FilterBar action="/deposits">
        <Input label={t("common.search")} name="q" defaultValue={q} placeholder={t("dep.search")} wrapperClassName="w-full sm:w-56" />
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={STATUSES.map((s) => ({ value: s, label: t(`dep.status.${s}`) }))} wrapperClassName="w-full sm:w-48" />
        <Select label={t("common.building")} name="propertyId" defaultValue={propertyId} placeholder={t("common.all")} options={properties.map((p) => ({ value: p.id, label: p.name }))} wrapperClassName="w-full sm:w-48" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("dep.empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("common.tenant")}</Th>
              <Th>{t("fin.lease")}</Th>
              <Th className="text-right">{t("dep.required")}</Th>
              <Th className="text-right">{t("dep.received")}</Th>
              <Th className="text-right">{t("dep.deducted")}</Th>
              <Th className="text-right">{t("dep.refunded")}</Th>
              <Th className="text-right">{t("dep.held")}</Th>
              <Th>{t("dep.heldIn")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((d) => {
              const tot = depositTotals(d.transactions);
              const fmt = { locale, currency: d.lease.currency || currency };
              const pending = d.transactions.some((x) => x.status === "PENDING_APPROVAL");
              return (
                <Tr key={d.id}>
                  <Td>
                    <Link href={`/deposits/${d.id}`} className="font-medium text-[var(--brand)] hover:underline">{d.lease.tenant.legalName}</Link>
                    <div className="text-xs text-slate-500">{d.lease.tenant.reference}</div>
                  </Td>
                  <Td>
                    <div className="font-mono text-xs">{d.lease.reference}</div>
                    <div className="text-xs text-slate-500">{d.lease.unit.property.name} · {d.lease.unit.number}</div>
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(d.required, fmt)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(tot.received, fmt)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(tot.deducted, fmt)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(tot.refunded, fmt)}</Td>
                  <Td className="text-right font-semibold tabular-nums">{formatMoney(tot.held, fmt)}</Td>
                  <Td className="text-xs">{d.heldIn || "—"}</Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <Badge status={d.status}>{t(`dep.status.${d.status}`)}</Badge>
                      {pending && <Badge tone="amber">{t("dep.txStatus.PENDING_APPROVAL")}</Badge>}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/deposits" params={{ q, status, propertyId }} />
    </>
  );
}
