import Link from "next/link";
import type { LeaseStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, leaseWhere, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay, formatMoney } from "@/lib/format";
import { Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { todayUtcDay } from "./fields";
import { LEASE_STATUSES, leaseMessages } from "./messages";

export const metadata = { title: "Leases" };
const PAGE_SIZE = 25;
const EXPIRY_WINDOWS = ["30", "60", "90"];

export default async function LeasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("lease.view");
  const { t, locale } = await getT(leaseMessages);
  const sp = await searchParams;
  const q = str(sp.q).trim().slice(0, 100);
  const status = str(sp.status);
  const propertyId = str(sp.propertyId);
  const expiring = EXPIRY_WINDOWS.includes(str(sp.expiring)) ? str(sp.expiring) : "";
  const page = parsePage(sp.page);
  const showTenant = can(ctx, "tenant.view");

  // Extra filters go in AND so the scope constraint from leaseWhere is never overwritten.
  const filters: Prisma.LeaseWhereInput[] = [];
  if ((LEASE_STATUSES as readonly string[]).includes(status)) filters.push({ status: status as LeaseStatus });
  else if (!expiring) filters.push({ status: { not: "ARCHIVED" } });
  if (propertyId) filters.push({ unit: { propertyId } });
  if (expiring) {
    const today = todayUtcDay();
    const until = new Date(today.getTime() + Number(expiring) * 86_400_000);
    filters.push({ status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, endDate: { gte: today, lte: until } });
  }
  if (q) {
    filters.push({
      OR: [
        { reference: { contains: q, mode: "insensitive" } },
        { unit: { number: { contains: q, mode: "insensitive" } } },
        ...(showTenant ? [{ tenant: { legalName: { contains: q, mode: "insensitive" as const } } }] : []),
      ],
    });
  }
  const where: Prisma.LeaseWhereInput = { ...leaseWhere(ctx), AND: filters };

  const [total, rows, properties, settings] = await Promise.all([
    db.lease.count({ where }),
    db.lease.findMany({
      where,
      orderBy: expiring ? { endDate: "asc" } : { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        tenant: { select: { id: true, legalName: true } },
        unit: { select: { id: true, number: true, block: true, property: { select: { name: true } } } },
      },
    }),
    db.property.findMany({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getOrgSettings(ctx.organizationId),
  ]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const dfmt = { dateFormat: settings?.dateFormat ?? "dd/MM/yyyy" };

  return (
    <>
      <PageHeader
        title={t("lease.title")}
        description={t("lease.subtitle")}
        actions={can(ctx, "lease.create") && <LinkButton href="/leases/new">{t("lease.new")}</LinkButton>}
      />
      <FilterBar action="/leases">
        <Input label={t("common.search")} name="q" defaultValue={q} wrapperClassName="w-full sm:w-56" />
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={LEASE_STATUSES.map((v) => ({ value: v, label: t(`lease.status.${v}`) }))} wrapperClassName="w-full sm:w-48" />
        <Select label={t("lease.building")} name="propertyId" defaultValue={propertyId} placeholder={t("common.all")} options={properties.map((p) => ({ value: p.id, label: p.name }))} wrapperClassName="w-full sm:w-48" />
        <Select label={t("lease.expiring")} name="expiring" defaultValue={expiring} placeholder="—" options={EXPIRY_WINDOWS.map((v) => ({ value: v, label: t(`lease.expiring.${v}`) }))} wrapperClassName="w-full sm:w-36" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("lease.empty")} description={t("lease.emptyHint")} action={can(ctx, "lease.create") && <LinkButton href="/leases/new">{t("lease.new")}</LinkButton>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("lease.reference")}</Th>
              {showTenant && <Th>{t("lease.tenant")}</Th>}
              <Th>{t("lease.unit")}</Th>
              <Th>{t("lease.dates")}</Th>
              <Th className="text-right">{t("lease.rent")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((l) => (
              <Tr key={l.id}>
                <Td>
                  <Link className="font-mono text-xs font-medium text-[var(--brand)] hover:underline" href={`/leases/${l.id}`}>{l.reference}</Link>
                  {l.version > 1 && <div className="text-xs text-slate-500">v{l.version}</div>}
                </Td>
                {showTenant && <Td><Link className="hover:underline" href={`/tenants/${l.tenant.id}`}>{l.tenant.legalName}</Link></Td>}
                <Td><Link className="hover:underline" href={`/units/${l.unit.id}`}>{l.unit.property.name} · {l.unit.block ? `${l.unit.block} · ` : ""}{l.unit.number}</Link></Td>
                <Td className="whitespace-nowrap">{formatDay(l.startDate, dfmt)} → {formatDay(l.endDate, dfmt)}</Td>
                <Td className="whitespace-nowrap text-right">
                  {formatMoney(l.rentAmount, { ...fmt, currency: l.currency || fmt.currency })}
                  <div className="text-xs text-slate-500">{t(`lease.freq.${l.frequency}`)}</div>
                </Td>
                <Td><Badge status={l.status}>{t(`lease.status.${l.status}`)}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/leases" params={{ q, status, propertyId, expiring }} />
    </>
  );
}
