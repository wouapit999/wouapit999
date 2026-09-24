import Link from "next/link";
import type { Prisma, UnitStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, propertyWhere, requireContext, unitWhere } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/format";
import { Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { leaseMessages } from "../leases/messages";
import { UNIT_STATUSES, UNIT_TYPES, unitMessages } from "./messages";

export const metadata = { title: "Units" };
const PAGE_SIZE = 25;

export default async function UnitsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("unit.view");
  const { t, locale } = await getT(unitMessages, leaseMessages);
  const sp = await searchParams;
  const q = str(sp.q).trim().slice(0, 100);
  const propertyId = str(sp.propertyId);
  const status = str(sp.status);
  const type = str(sp.type);
  const page = parsePage(sp.page);
  const showTenant = can(ctx, "tenant.view");

  const statusFilter: Prisma.UnitWhereInput =
    status === "ARCHIVED"
      ? { archived: true }
      : (UNIT_STATUSES as readonly string[]).includes(status)
        ? { archived: false, status: status as UnitStatus }
        : { archived: false };

  const search: Prisma.UnitWhereInput[] = [
    { number: { contains: q, mode: "insensitive" } },
    { block: { contains: q, mode: "insensitive" } },
    { property: { name: { contains: q, mode: "insensitive" } } },
  ];
  if (showTenant) search.push({ leases: { some: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, tenant: { legalName: { contains: q, mode: "insensitive" } } } } });
  // Extra filters go in AND so the building-scope constraint from unitWhere is never overwritten.
  const filters: Prisma.UnitWhereInput[] = [statusFilter];
  if (propertyId) filters.push({ propertyId });
  if ((UNIT_TYPES as readonly string[]).includes(type)) filters.push({ type });
  if (q) filters.push({ OR: search });
  const where: Prisma.UnitWhereInput = { ...unitWhere(ctx), AND: filters };

  const [total, rows, properties, settings] = await Promise.all([
    db.unit.count({ where }),
    db.unit.findMany({
      where,
      orderBy: [{ property: { name: "asc" } }, { block: "asc" }, { floor: "asc" }, { number: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        property: { select: { id: true, name: true } },
        leases: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, take: 1, include: { tenant: { select: { id: true, legalName: true } } } },
      },
    }),
    db.property.findMany({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getOrgSettings(ctx.organizationId),
  ]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };

  return (
    <>
      <PageHeader
        title={t("unit.title")}
        description={t("unit.subtitle")}
        actions={can(ctx, "unit.manage") && <LinkButton href="/units/new">{t("unit.new")}</LinkButton>}
      />
      <FilterBar action="/units">
        <Input label={t("common.search")} name="q" defaultValue={q} wrapperClassName="w-full sm:w-56" />
        <Select label={t("unit.building")} name="propertyId" defaultValue={propertyId} placeholder={t("common.all")} options={properties.map((p) => ({ value: p.id, label: p.name }))} wrapperClassName="w-full sm:w-48" />
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={[...UNIT_STATUSES, "ARCHIVED"].map((v) => ({ value: v, label: t(`unit.status.${v}`) }))} wrapperClassName="w-full sm:w-44" />
        <Select label={t("unit.type")} name="type" defaultValue={type} placeholder={t("common.all")} options={UNIT_TYPES.map((v) => ({ value: v, label: t(`unit.type.${v}`) }))} wrapperClassName="w-full sm:w-40" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("unit.empty")} description={t("unit.emptyHint")} action={can(ctx, "unit.manage") && <LinkButton href="/units/new">{t("unit.new")}</LinkButton>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("common.unit")}</Th>
              <Th>{t("unit.building")}</Th>
              <Th>{t("unit.type")}</Th>
              <Th>{t("unit.rent")}</Th>
              {showTenant && <Th>{t("unit.currentTenant")}</Th>}
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((u) => (
              <Tr key={u.id}>
                <Td>
                  <Link className="font-medium text-[var(--brand)] hover:underline" href={`/units/${u.id}`}>
                    {u.block ? `${u.block} · ` : ""}{u.number}
                  </Link>
                  <div className="text-xs text-slate-500">{t("unit.floor")} {u.floor}</div>
                </Td>
                <Td><Link className="hover:underline" href={`/properties/${u.property.id}`}>{u.property.name}</Link></Td>
                <Td>{t(`unit.type.${u.type}`)} · {t("unit.beds", { n: u.bedrooms })}</Td>
                <Td className="whitespace-nowrap">{formatMoney(u.defaultRent, fmt)}</Td>
                {showTenant && (
                  <Td>{u.leases[0] ? <Link className="hover:underline" href={`/tenants/${u.leases[0].tenant.id}`}>{u.leases[0].tenant.legalName}</Link> : "—"}</Td>
                )}
                <Td>
                  {u.archived ? <Badge status="ARCHIVED">{t("unit.status.ARCHIVED")}</Badge> : <Badge status={u.status}>{t(`unit.status.${u.status}`)}</Badge>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/units" params={{ q, propertyId, status, type }} />
    </>
  );
}
