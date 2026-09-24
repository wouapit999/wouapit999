import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, maintenanceWhere, requireContext, unitWhere } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDate, formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Badge, Card, DescriptionList, EmptyState, LinkButton, PageHeader, Select, Table, Td, Textarea, Th, Tr } from "@/components/ui";
import { leaseMessages } from "../../leases/messages";
import { archiveUnitAction, changeUnitStatusAction } from "../actions";
import { MANUAL_UNIT_STATUSES, formDict, unitMessages } from "../messages";

export const metadata = { title: "Unit" };

export default async function UnitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("unit.view");
  const { t, locale } = await getT(unitMessages, leaseMessages);
  const unit = await db.unit.findFirst({
    where: { ...unitWhere(ctx), id },
    include: {
      property: { select: { id: true, name: true } },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!unit) notFound();

  const showLeases = can(ctx, "lease.view");
  const showTenant = can(ctx, "tenant.view");
  const showMaintenance = can(ctx, "maintenance.view");
  const showInspections = can(ctx, "inspection.view");
  const manage = can(ctx, "unit.manage");

  const [leases, maintenance, inspections, settings] = await Promise.all([
    showLeases
      ? db.lease.findMany({
          where: { unitId: unit.id, organizationId: ctx.organizationId },
          orderBy: { startDate: "desc" },
          include: { tenant: { select: { id: true, legalName: true } } },
        })
      : Promise.resolve([]),
    showMaintenance
      ? db.maintenanceRequest.findMany({ where: { ...maintenanceWhere(ctx), unitId: unit.id }, orderBy: { createdAt: "desc" }, take: 20 })
      : Promise.resolve([]),
    showInspections
      ? db.inspection.findMany({ where: { organizationId: ctx.organizationId, unitId: unit.id }, orderBy: { scheduledFor: "desc" }, take: 20 })
      : Promise.resolve([]),
    getOrgSettings(ctx.organizationId),
  ]);
  const actorIds = [...new Set(unit.statusHistory.map((h) => h.actorId).filter((x): x is string => !!x))];
  const actors = actorIds.length
    ? await db.user.findMany({ where: { id: { in: actorIds }, organizationId: ctx.organizationId }, select: { id: true, name: true } })
    : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name]));

  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const dfmt = { timezone: settings?.timezone ?? "Africa/Douala", dateFormat: settings?.dateFormat ?? "dd/MM/yyyy" };
  const label = `${unit.block ? `${unit.block} · ` : ""}${unit.number}`;
  const current = leases.find((l) => l.status === "ACTIVE" || l.status === "NOTICE_GIVEN");
  const canNewLease = !unit.archived && can(ctx, "lease.create");

  return (
    <>
      <PageHeader
        title={`${unit.property.name} · ${label}`}
        description={`${t(`unit.type.${unit.type}`)} · ${t("unit.beds", { n: unit.bedrooms })}`}
        breadcrumbs={[{ label: t("unit.title"), href: "/units" }, { label: unit.property.name, href: `/properties/${unit.property.id}` }, { label }]}
        actions={
          <>
            {canNewLease && <LinkButton href={`/leases/new?unitId=${unit.id}`}>{t("unit.newLease")}</LinkButton>}
            {manage && !unit.archived && <LinkButton variant="secondary" href={`/units/${unit.id}/edit`}>{t("common.edit")}</LinkButton>}
            {manage && !unit.archived && (
              <InlineAction action={archiveUnitAction} label={t("unit.archive")} variant="danger" confirm={t("unit.archiveConfirm")} hidden={{ id: unit.id }} />
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("unit.details")}>
            <DescriptionList
              items={[
                { label: t("common.status"), value: unit.archived ? <Badge status="ARCHIVED">{t("unit.archived")}</Badge> : <Badge status={unit.status}>{t(`unit.status.${unit.status}`)}</Badge> },
                { label: t("unit.building"), value: <Link className="hover:underline" href={`/properties/${unit.property.id}`}>{unit.property.name}</Link> },
                { label: t("unit.block"), value: unit.block },
                { label: t("unit.floor"), value: String(unit.floor) },
                { label: t("unit.bedrooms"), value: String(unit.bedrooms) },
                { label: t("unit.bathrooms"), value: String(unit.bathrooms) },
                { label: t("unit.area"), value: unit.area?.toString() },
                { label: t("unit.furnishing"), value: t(`unit.furnishing.${unit.furnishing}`) },
                { label: t("unit.rent"), value: formatMoney(unit.defaultRent, fmt) },
                { label: t("unit.deposit"), value: formatMoney(unit.defaultDeposit, fmt) },
                { label: t("unit.serviceCharge"), value: formatMoney(unit.defaultServiceCharge, fmt) },
                { label: t("unit.frequency"), value: t(`lease.freq.${unit.billingFrequency}`) },
                { label: t("unit.meterIds"), value: unit.meterIds },
              ]}
            />
            {unit.notes && <p className="mt-4 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">{unit.notes}</p>}
          </Card>

          {showLeases && (
            <Card title={t("unit.leases")}>
              {leases.length === 0 ? (
                <EmptyState title={t("common.empty")} action={canNewLease && <LinkButton href={`/leases/new?unitId=${unit.id}`}>{t("unit.newLease")}</LinkButton>} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("unit.reference")}</Th>
                      {showTenant && <Th>{t("common.tenant")}</Th>}
                      <Th>{t("unit.period")}</Th>
                      <Th>{t("lease.rent")}</Th>
                      <Th>{t("common.status")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {leases.map((l) => (
                      <Tr key={l.id}>
                        <Td>
                          <Link className="font-mono text-xs text-[var(--brand)] hover:underline" href={`/leases/${l.id}`}>{l.reference}</Link>
                          {current?.id === l.id && <div className="text-xs text-slate-500">{t("unit.currentLease")}</div>}
                        </Td>
                        {showTenant && <Td><Link className="hover:underline" href={`/tenants/${l.tenant.id}`}>{l.tenant.legalName}</Link></Td>}
                        <Td className="whitespace-nowrap">{formatDay(l.startDate, dfmt)} → {formatDay(l.endDate, dfmt)}</Td>
                        <Td className="whitespace-nowrap">{formatMoney(l.rentAmount, fmt)}</Td>
                        <Td><Badge status={l.status}>{t(`lease.status.${l.status}`)}</Badge></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}

          {showMaintenance && (
            <Card title={t("unit.maintenance")}>
              {maintenance.length === 0 ? (
                <p className="text-sm text-slate-500">{t("common.none")}</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("unit.reference")}</Th>
                      <Th>{t("unit.title.col")}</Th>
                      <Th>{t("unit.priority")}</Th>
                      <Th>{t("common.status")}</Th>
                      <Th>{t("unit.when")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {maintenance.map((m) => (
                      <Tr key={m.id}>
                        <Td><Link className="font-mono text-xs text-[var(--brand)] hover:underline" href={`/maintenance/${m.id}`}>{m.number}</Link></Td>
                        <Td>{m.title}</Td>
                        <Td><Badge status={m.priority} /></Td>
                        <Td><Badge status={m.status} /></Td>
                        <Td className="whitespace-nowrap">{formatDate(m.createdAt, dfmt)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}

          {showInspections && (
            <Card title={t("unit.inspections")}>
              {inspections.length === 0 ? (
                <p className="text-sm text-slate-500">{t("common.none")}</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("unit.inspection.type")}</Th>
                      <Th>{t("unit.inspection.scheduled")}</Th>
                      <Th>{t("common.status")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {inspections.map((i) => (
                      <Tr key={i.id}>
                        <Td><Link className="text-[var(--brand)] hover:underline" href={`/inspections/${i.id}`}>{i.type}</Link></Td>
                        <Td className="whitespace-nowrap">{formatDateTime(i.scheduledFor, dfmt)}</Td>
                        <Td><Badge status={i.status} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {manage && !unit.archived && (
            <Card title={t("unit.changeStatus")}>
              <ActionForm action={changeUnitStatusAction} resetOnSuccess dict={formDict(t)}>
                <input type="hidden" name="id" value={unit.id} />
                <Select
                  label={t("unit.newStatus")}
                  name="status"
                  required
                  options={MANUAL_UNIT_STATUSES.filter((s) => s !== unit.status).map((v) => ({ value: v, label: t(`unit.status.${v}`) }))}
                />
                <Textarea label={t("unit.statusReason")} name="reason" required minLength={3} maxLength={500} />
                <SubmitButton>{t("unit.changeStatus")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card title={t("unit.statusHistory")}>
            {unit.statusHistory.length === 0 ? (
              <p className="text-sm text-slate-500">{t("common.none")}</p>
            ) : (
              <ol className="space-y-3">
                {unit.statusHistory.map((h) => (
                  <li key={h.id} className="border-l-2 border-slate-200 pl-3 text-sm dark:border-slate-700">
                    <div className="flex flex-wrap items-center gap-1">
                      {h.from && <Badge status={h.from}>{t(`unit.status.${h.from}`)}</Badge>}
                      {h.from && <span aria-hidden>→</span>}
                      <Badge status={h.to}>{t(`unit.status.${h.to}`)}</Badge>
                    </div>
                    {h.reason && <p className="mt-1 text-slate-700 dark:text-slate-300">{h.reason}</p>}
                    <p className="text-xs text-slate-500">
                      {formatDateTime(h.createdAt, dfmt)}
                      {h.actorId && actorName.get(h.actorId) ? ` · ${actorName.get(h.actorId)}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
