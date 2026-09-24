import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Card, Checkbox, EmptyState, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { MAINTENANCE_CATEGORIES, MAINTENANCE_PRIORITIES, currentLease } from "@/services/portal";
import { createPortalMaintenanceAction } from "../../actions";
import { PORTAL_ERROR_KEYS, dictFor, portalPage } from "../../kit";

// Stored as plain English so staff screens can show it as-is.
const ACCESS_OPTIONS = {
  CALL_FIRST: "Call me before coming",
  ENTER_IF_ABSENT: "May enter if I am absent",
  PRESENT_ONLY: "Only when I am present",
};

export const metadata = { title: "New maintenance request" };
export const dynamic = "force-dynamic";

export default async function PortalNewMaintenancePage() {
  const { ctx, tenantId, t, settings } = await portalPage();
  const lease = await currentLease(ctx.organizationId, tenantId);
  const header = (
    <PageHeader
      title={t("portal.mnt.new")}
      breadcrumbs={[{ label: t("nav.portal.maintenance"), href: "/portal/maintenance" }, { label: t("portal.mnt.new") }]}
    />
  );
  if (!lease) {
    return (
      <>
        {header}
        <EmptyState title={t("portal.err.noLease")} description={t("portal.mnt.noLeaseHint")} />
      </>
    );
  }
  return (
    <>
      {header}
      <div className="mb-4 space-y-2">
        <Alert tone="warn">
          <strong className="block">{t("portal.mnt.emergencyTitle")}</strong>
          <span className="whitespace-pre-line">{settings?.emergencyInstructions}</span>
        </Alert>
        <p className="text-xs text-slate-500">{t("portal.mnt.notEmergency")}</p>
      </div>
      <Card>
        <ActionForm action={createPortalMaintenanceAction} dict={dictFor(t, PORTAL_ERROR_KEYS)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">{lease.unit.property.name} · {t("common.unit")} {lease.unit.number}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label={t("portal.mnt.category")} name="category" required placeholder="" options={MAINTENANCE_CATEGORIES.map((c) => ({ value: c, label: t(`portal.cat.${c}`) }))} />
            <Select label={t("portal.mnt.urgency")} name="priority" defaultValue="NORMAL" options={MAINTENANCE_PRIORITIES.map((p) => ({ value: p, label: t(`portal.prio.${p}`) }))} hint={t("portal.mnt.urgencyHint")} />
          </div>
          <Input label={t("portal.mnt.title")} name="title" required minLength={3} maxLength={150} />
          <Textarea label={t("portal.mnt.description")} name="description" required minLength={5} maxLength={4000} rows={4} />
          <Input label={t("portal.mnt.location")} name="location" maxLength={200} hint={t("portal.mnt.locationHint")} />
          <Checkbox label={t("portal.mnt.safetyLabel")} name="safetyIssue" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t("portal.mnt.access")}
              name="accessPreference"
              defaultValue={ACCESS_OPTIONS.CALL_FIRST}
              options={Object.entries(ACCESS_OPTIONS).map(([k, v]) => ({ value: v, label: t(`portal.access.${k}`) }))}
            />
            <Input label={t("portal.mnt.times")} name="availableTimes" maxLength={300} hint={t("portal.mnt.timesHint")} />
          </div>
          <Input label={t("portal.mnt.photo")} name="photo" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hint={t("portal.mnt.photoHint")} />
          <SubmitButton>{t("portal.mnt.submit")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
