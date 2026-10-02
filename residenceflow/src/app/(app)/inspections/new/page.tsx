import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { leaseWhere, requireContext, unitWhere } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Input, PageHeader, Select, str } from "@/components/ui";
import { createInspectionAction } from "../actions";
import { INSPECTION_TYPES } from "../checklist";
import { inspectionMessages } from "../messages";

export const metadata = { title: "Schedule inspection" };

export default async function NewInspectionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("inspection.manage");
  const { t } = await getT(inspectionMessages);
  const sp = await searchParams;
  const [units, leases, settings] = await Promise.all([
    db.unit.findMany({
      where: { ...unitWhere(ctx), archived: false },
      orderBy: [{ property: { name: "asc" } }, { block: "asc" }, { number: "asc" }],
      select: { id: true, number: true, block: true, property: { select: { name: true } } },
    }),
    db.lease.findMany({
      where: { ...leaseWhere(ctx), status: { in: ["PENDING_APPROVAL", "ACTIVE", "NOTICE_GIVEN", "EXPIRED", "TERMINATED"] } },
      orderBy: { startDate: "desc" },
      take: 300,
      select: { id: true, reference: true, unitId: true, status: true, unit: { select: { number: true, property: { select: { name: true } } } }, tenant: { select: { legalName: true } } },
    }),
    getOrgSettings(ctx.organizationId),
  ]);
  const presetLease = leases.find((l) => l.id === str(sp.leaseId));
  const presetUnit = presetLease?.unitId ?? (units.some((u) => u.id === str(sp.unitId)) ? str(sp.unitId) : "");
  const presetType = (INSPECTION_TYPES as readonly string[]).includes(str(sp.type)) ? str(sp.type) : "MOVE_IN";
  const tz = settings?.timezone ?? "Africa/Douala";
  const defaultWhen = formatInTimeZone(new Date(Date.now() + 86400_000), tz, "yyyy-MM-dd'T'10:00");

  return (
    <>
      <PageHeader title={t("insp.new")} breadcrumbs={[{ label: t("insp.title"), href: "/inspections" }, { label: t("insp.new") }]} />
      <Card>
        <ActionForm action={createInspectionAction}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t("common.unit")}
              name="unitId"
              required
              defaultValue={presetUnit}
              placeholder={t("insp.choose")}
              options={units.map((u) => ({ value: u.id, label: `${u.property.name} · ${u.block ? `${u.block} · ` : ""}${u.number}` }))}
            />
            <Select
              label={t("insp.lease")}
              name="leaseId"
              defaultValue={presetLease?.id ?? ""}
              placeholder={t("common.none")}
              options={leases.map((l) => ({ value: l.id, label: `${l.reference} · ${l.unit.property.name} ${l.unit.number} · ${l.tenant.legalName} (${l.status})` }))}
            />
            <Select label={t("insp.type")} name="type" required defaultValue={presetType} options={INSPECTION_TYPES.map((v) => ({ value: v, label: t(`insp.type.${v}`) }))} />
            <Input label={t("insp.scheduledFor")} name="scheduledFor" type="datetime-local" required defaultValue={defaultWhen} />
            <Input label={t("insp.inspector")} name="inspectorName" defaultValue={ctx.user.name} maxLength={120} />
          </div>
          <SubmitButton>{t("common.create")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
