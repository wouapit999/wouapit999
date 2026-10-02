import { db } from "@/lib/db";
import { requireContext, unitWhere } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { Alert, Card, LinkButton, PageHeader, Select, buttonClass, str } from "@/components/ui";
import { unitMessages } from "../../units/messages";
import { LeaseForm } from "../lease-form";
import { createLeaseAction } from "../actions";
import { leasableTenants, unitLabel } from "../data";
import { leaseMessages } from "../messages";

export const metadata = { title: "New lease" };

export default async function NewLeasePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("lease.create");
  const { t } = await getT(leaseMessages, unitMessages);
  const sp = await searchParams;
  const unitId = str(sp.unitId);
  const tenantId = str(sp.tenantId);

  const unit = unitId
    ? await db.unit.findFirst({ where: { ...unitWhere(ctx), id: unitId, archived: false }, include: { property: { select: { name: true } } } })
    : null;

  const header = <PageHeader title={t("lease.new")} breadcrumbs={[{ label: t("lease.title"), href: "/leases" }, { label: t("lease.new") }]} />;

  if (!unit) {
    const units = await db.unit.findMany({
      where: { ...unitWhere(ctx), archived: false },
      orderBy: [{ property: { name: "asc" } }, { block: "asc" }, { number: "asc" }],
      take: 1000,
      include: { property: { select: { name: true } } },
    });
    return (
      <>
        {header}
        <Card title={t("lease.chooseUnit")}>
          {units.length === 0 ? (
            <Alert tone="warn">{t("lease.err.unitNotFound")}</Alert>
          ) : (
            <form method="get" action="/leases/new" className="space-y-4">
              {tenantId && <input type="hidden" name="tenantId" value={tenantId} />}
              <Select
                label={t("lease.unit")}
                name="unitId"
                required
                placeholder="—"
                hint={t("lease.chooseUnitHint")}
                options={units.map((u) => ({ value: u.id, label: `${unitLabel(u)} — ${t(`unit.status.${u.status}`)}` }))}
              />
              <button type="submit" className={buttonClass("primary")}>{t("lease.continue")}</button>
            </form>
          )}
        </Card>
      </>
    );
  }

  const [tenants, settings] = await Promise.all([leasableTenants(ctx), getOrgSettings(ctx.organizationId)]);
  return (
    <>
      {header}
      {tenants.length === 0 ? (
        <Alert tone="warn">
          {t("lease.noTenants")} <LinkButton variant="secondary" className="ml-2" href="/tenants/new">{t("lease.newTenant")}</LinkButton>
        </Alert>
      ) : (
        <Card
          actions={<LinkButton variant="ghost" href={`/leases/new${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`}>{t("lease.changeUnit")}</LinkButton>}
          title={unitLabel(unit)}
        >
          <LeaseForm
            action={createLeaseAction}
            unit={{ id: unit.id, label: unitLabel(unit) }}
            tenants={tenants}
            defaults={{
              tenantId: tenants.some((x) => x.id === tenantId) ? tenantId : undefined,
              rentAmount: unit.defaultRent.toString(),
              serviceCharge: unit.defaultServiceCharge.toString(),
              depositAmount: unit.defaultDeposit.toString(),
              frequency: unit.billingFrequency,
              graceDays: settings?.defaultGraceDays ?? 5,
              lateFeeType: settings?.lateFeeType ?? "NONE",
              lateFeeValue: settings?.lateFeeValue.toString() ?? "0",
            }}
            t={t}
          />
        </Card>
      )}
    </>
  );
}
