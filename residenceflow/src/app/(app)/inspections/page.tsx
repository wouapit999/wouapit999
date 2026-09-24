import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { Badge, EmptyState, FilterBar, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { INSPECTION_TYPES } from "./checklist";
import { inspectionMessages } from "./messages";
import { inspectionScope } from "./scope";

export const metadata = { title: "Inspections" };
const PAGE_SIZE = 25;

export default async function InspectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("inspection.view");
  const { t } = await getT(inspectionMessages);
  const sp = await searchParams;
  const type = (INSPECTION_TYPES as readonly string[]).includes(str(sp.type)) ? str(sp.type) : "";
  const status = ["SCHEDULED", "COMPLETED", "CANCELLED"].includes(str(sp.status)) ? str(sp.status) : "";
  const propertyId = str(sp.propertyId);
  const page = parsePage(sp.page);
  const where: Prisma.InspectionWhereInput = {
    AND: [inspectionScope(ctx), type ? { type } : {}, status ? { status } : {}, propertyId ? { unit: { propertyId } } : {}],
  };
  const [total, rows, buildings, settings] = await Promise.all([
    db.inspection.count({ where }),
    db.inspection.findMany({
      where,
      orderBy: [{ status: "desc" }, { scheduledFor: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { unit: { select: { number: true, block: true, property: { select: { name: true } } } }, lease: { select: { reference: true, tenant: { select: { legalName: true } } } } },
    }),
    db.property.findMany({ where: propertyWhere(ctx), orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getOrgSettings(ctx.organizationId),
  ]);
  const prefs = { timezone: settings?.timezone ?? "Africa/Douala", dateFormat: settings?.dateFormat };

  return (
    <>
      <PageHeader title={t("insp.title")} description={t("insp.subtitle")} actions={can(ctx, "inspection.manage") && <LinkButton href="/inspections/new">{t("insp.new")}</LinkButton>} />
      <FilterBar action="/inspections">
        <Select label={t("insp.type")} name="type" defaultValue={type} placeholder={t("common.all")} options={INSPECTION_TYPES.map((v) => ({ value: v, label: t(`insp.type.${v}`) }))} wrapperClassName="w-40" />
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={["SCHEDULED", "COMPLETED", "CANCELLED"].map((v) => ({ value: v, label: t(`insp.status.${v}`) }))} wrapperClassName="w-40" />
        {buildings.length > 1 && <Select label={t("common.building")} name="propertyId" defaultValue={propertyId} placeholder={t("common.all")} options={buildings.map((b) => ({ value: b.id, label: b.name }))} wrapperClassName="w-48" />}
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("insp.empty")} description={t("insp.emptyHint")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("common.unit")}</Th>
              <Th>{t("insp.type")}</Th>
              <Th>{t("insp.scheduledFor")}</Th>
              <Th>{t("common.tenant")}</Th>
              <Th>{t("insp.inspector")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((i) => (
              <Tr key={i.id}>
                <Td>
                  <Link className="font-medium text-[var(--brand)] hover:underline" href={`/inspections/${i.id}`}>
                    {i.unit.property.name} · {i.unit.block ? `${i.unit.block} · ` : ""}{i.unit.number}
                  </Link>
                </Td>
                <Td>{t(`insp.type.${i.type}`)}</Td>
                <Td className="whitespace-nowrap">{formatDateTime(i.scheduledFor, prefs)}</Td>
                <Td>{i.lease ? `${i.lease.tenant.legalName} (${i.lease.reference})` : "—"}</Td>
                <Td>{i.inspectorName}</Td>
                <Td><Badge status={i.status}>{t(`insp.status.${i.status}`)}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/inspections" params={{ type, status, propertyId }} />
    </>
  );
}
