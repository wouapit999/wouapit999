import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { Alert, Card, PageHeader, str } from "@/components/ui";
import { WO_CATEGORIES, WO_PRIORITIES, locationOptions } from "@/services/maintenance";
import { createRequestAction } from "../actions";
import { maintenanceMessages } from "../messages";
import { RequestForm } from "./request-form";

export const metadata = { title: "New maintenance request" };

export default async function NewMaintenancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("maintenance.create");
  const { t } = await getT(maintenanceMessages);
  const sp = await searchParams;
  const [{ buildings, units }, settings] = await Promise.all([locationOptions(ctx), getOrgSettings(ctx.organizationId)]);
  const defaultPropertyId = buildings.some((b) => b.id === str(sp.propertyId)) ? str(sp.propertyId) : undefined;
  const defaultUnitId = units.some((u) => u.id === str(sp.unitId)) ? str(sp.unitId) : undefined;

  const m = {
    building: t("common.building"),
    unit: t("common.unit"),
    commonArea: t("wo.commonArea"),
    choose: t("wo.chooseBuilding"),
    category: t("wo.category"),
    priority: t("wo.priority"),
    safety: t("wo.safety"),
    safetyHint: t("wo.safetyHint"),
    title: t("wo.requestTitle"),
    description: t("wo.description"),
    location: t("wo.location"),
    locationHint: t("wo.locationHint"),
    access: t("wo.access"),
    accessHint: t("wo.accessHint"),
    availableTimes: t("wo.availableTimes"),
    photo: t("wo.photo"),
    photoHint: t("wo.photoHint"),
    onBehalf: t("wo.onBehalf"),
    emergencyTitle: t("wo.emergencyTitle"),
    notEmergency: t("wo.notEmergency"),
    submit: t("common.create"),
  };

  return (
    <>
      <PageHeader title={t("wo.new")} breadcrumbs={[{ label: t("wo.title"), href: "/maintenance" }, { label: t("wo.new") }]} />
      <div className="mb-4">
        <Alert tone="info">{t("wo.notEmergency")}</Alert>
      </div>
      <Card>
        <RequestForm
          action={createRequestAction}
          buildings={buildings}
          units={units}
          categories={WO_CATEGORIES.map((v) => ({ value: v, label: t(`wo.category.${v}`) }))}
          priorities={WO_PRIORITIES.map((v) => ({ value: v, label: t(`wo.priority.${v}`) }))}
          emergencyInstructions={settings?.emergencyInstructions ?? ""}
          m={m}
          defaultPropertyId={defaultPropertyId}
          defaultUnitId={defaultUnitId}
        />
      </Card>
    </>
  );
}
