import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { byPropertyWhere, can, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay } from "@/lib/format";
import { money } from "@/lib/money";
import { Badge, EmptyState, FilterBar, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { UTILITY_TYPES } from "@/domain/utilities";
import { utilitiesEnabled } from "./flag";
import { utilityMessages } from "./messages";

export const metadata = { title: "Utilities" };
const PAGE_SIZE = 25;

export default async function UtilitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("unit.view");
  const { t } = await getT(utilityMessages);
  if (!(await utilitiesEnabled(ctx.organizationId))) {
    return (
      <>
        <PageHeader title={t("util.title")} />
        <EmptyState title={t("util.disabled")} description={t("util.disabledHint")} />
      </>
    );
  }
  const sp = await searchParams;
  const propertyId = str(sp.propertyId);
  const utility = (UTILITY_TYPES as readonly string[]).includes(str(sp.utility)) ? str(sp.utility) : "";
  const page = parsePage(sp.page);
  const where: Prisma.MeterWhereInput = { ...byPropertyWhere(ctx), ...(propertyId ? { propertyId } : {}), ...(utility ? { utility } : {}) };

  const [total, meters, buildings, settings] = await Promise.all([
    db.meter.count({ where }),
    db.meter.findMany({
      where,
      orderBy: [{ property: { name: "asc" } }, { serial: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        property: { select: { name: true } },
        unit: { select: { number: true, block: true } },
        readings: { orderBy: [{ readingDate: "desc" }, { createdAt: "desc" }], take: 1, select: { readingDate: true, value: true } },
      },
    }),
    db.property.findMany({ where: propertyWhere(ctx), orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getOrgSettings(ctx.organizationId),
  ]);
  const prefs = { dateFormat: settings?.dateFormat };
  const canManage = can(ctx, "unit.manage");

  return (
    <>
      <PageHeader
        title={t("util.title")}
        description={t("util.subtitle")}
        actions={
          canManage && (
            <>
              <LinkButton variant="secondary" href="/utilities/import">{t("util.import")}</LinkButton>
              <LinkButton href="/utilities/new">{t("util.newMeter")}</LinkButton>
            </>
          )
        }
      />
      <FilterBar action="/utilities">
        <Select label={t("common.building")} name="propertyId" defaultValue={propertyId} placeholder={t("common.all")} options={buildings.map((b) => ({ value: b.id, label: b.name }))} wrapperClassName="w-48" />
        <Select label={t("util.utility")} name="utility" defaultValue={utility} placeholder={t("common.all")} options={UTILITY_TYPES.map((v) => ({ value: v, label: t(`util.type.${v}`) }))} wrapperClassName="w-44" />
      </FilterBar>
      {meters.length === 0 ? (
        <EmptyState title={t("util.empty")} description={t("util.emptyHint")} action={canManage && <LinkButton href="/utilities/new">{t("util.newMeter")}</LinkButton>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("util.serial")}</Th>
              <Th>{t("util.utility")}</Th>
              <Th>{t("common.building")}</Th>
              <Th>{t("common.unit")}</Th>
              <Th className="text-right">{t("util.tariff")}</Th>
              <Th>{t("util.lastReading")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {meters.map((m) => {
              const last = m.readings[0];
              return (
                <Tr key={m.id}>
                  <Td>
                    <Link className="font-medium text-[var(--brand)] hover:underline" href={`/utilities/${m.id}`}>{m.serial}</Link>
                  </Td>
                  <Td><Badge tone="blue">{t(`util.type.${m.utility}`)}</Badge></Td>
                  <Td>{m.property.name}</Td>
                  <Td>{m.unit ? `${m.unit.block ? `${m.unit.block} · ` : ""}${m.unit.number}` : <span className="text-slate-500">{t("util.shared")}</span>}</Td>
                  <Td className="text-right whitespace-nowrap">{money(m.tariff).toFixed(4)}</Td>
                  <Td className="whitespace-nowrap">{last ? `${money(last.value).toFixed(3)} · ${formatDay(last.readingDate, prefs)}` : "—"}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/utilities" params={{ propertyId, utility }} />
    </>
  );
}
