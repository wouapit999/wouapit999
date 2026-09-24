import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { propertyMessages } from "./messages";
import { PROPERTY_TYPES } from "./property-form";

export const metadata = { title: "Buildings" };
const PAGE_SIZE = 20;

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("building.view");
  const { t } = await getT(propertyMessages);
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const status = str(sp.status);
  const type = str(sp.type);
  const page = parsePage(sp.page);

  const where: Prisma.PropertyWhereInput = {
    ...propertyWhere(ctx),
    ...(status ? { status: status as never } : { status: { not: "ARCHIVED" } }),
    ...(type ? { type } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.property.count({ where }),
    db.property.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { units: { where: { archived: false }, select: { status: true } }, owner: { select: { name: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title={t("prop.title")}
        description={t("prop.subtitle")}
        actions={can(ctx, "building.create") && <LinkButton href="/properties/new">{t("prop.new")}</LinkButton>}
      />
      <FilterBar action="/properties">
        <Input label={t("common.search")} name="q" defaultValue={q} wrapperClassName="w-56" />
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={["ACTIVE", "INACTIVE", "RENOVATION", "ARCHIVED"].map((v) => ({ value: v, label: t(`prop.status.${v}`) }))} wrapperClassName="w-44" />
        <Select label={t("prop.type")} name="type" defaultValue={type} placeholder={t("common.all")} options={PROPERTY_TYPES.map((v) => ({ value: v, label: t(`prop.type.${v}`) }))} wrapperClassName="w-48" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("prop.empty")} description={t("prop.emptyHint")} action={can(ctx, "building.create") && <LinkButton href="/properties/new">{t("prop.new")}</LinkButton>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("prop.reference")}</Th>
              <Th>{t("common.name")}</Th>
              <Th>{t("prop.type")}</Th>
              <Th>{t("prop.city")}</Th>
              <Th>{t("prop.units")}</Th>
              <Th>{t("prop.occupancy")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((p) => {
              const occupied = p.units.filter((u) => ["OCCUPIED", "NOTICE_GIVEN"].includes(u.status)).length;
              const rate = p.units.length ? Math.round((occupied / p.units.length) * 100) : 0;
              return (
                <Tr key={p.id}>
                  <Td className="font-mono text-xs">{p.reference}</Td>
                  <Td><Link href={`/properties/${p.id}`} className="font-medium text-[var(--brand)] hover:underline">{p.name}</Link></Td>
                  <Td>{t(`prop.type.${p.type}`)}</Td>
                  <Td>{p.city}</Td>
                  <Td>{p.units.length}</Td>
                  <Td>{occupied}/{p.units.length} ({rate}%)</Td>
                  <Td><Badge status={p.status}>{t(`prop.status.${p.status}`)}</Badge></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/properties" params={{ q, status, type }} />
    </>
  );
}
