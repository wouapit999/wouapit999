import { db } from "@/lib/db";
import { byPropertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Field, Input, PageHeader, inputClass } from "@/components/ui";
import { LocationPicker } from "@/components/ops/location-picker";
import { locationOptions } from "@/services/maintenance";
import { collectParcelAction, logParcelAction } from "./actions";
import { parcelMessages } from "./messages";

export const metadata = { title: "Parcels" };

export default async function ParcelsPage() {
  const ctx = await requireContext("concierge.parcels.manage");
  const { t } = await getT(parcelMessages);
  const include = { property: { select: { name: true } }, unit: { select: { number: true, block: true } } } as const;
  const [settings, waiting, collected, locations] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.parcel.findMany({ where: { ...byPropertyWhere(ctx), collectedAt: null }, orderBy: { receivedAt: "asc" }, take: 200, include }),
    db.parcel.findMany({ where: { ...byPropertyWhere(ctx), collectedAt: { not: null } }, orderBy: { collectedAt: "desc" }, take: 30, include }),
    locationOptions(ctx),
  ]);
  const prefs = { timezone: settings?.timezone ?? "Africa/Douala", dateFormat: settings?.dateFormat };
  const place = (p: (typeof waiting)[number]) => `${p.property.name}${p.unit ? ` · ${p.unit.block ? `${p.unit.block} · ` : ""}${p.unit.number}` : ""}`;

  return (
    <>
      <PageHeader title={t("par.title")} description={t("par.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`${t("par.waiting")} (${waiting.length})`}>
          {waiting.length === 0 ? (
            <p className="text-sm text-slate-500">{t("par.none")}</p>
          ) : (
            <ul className="space-y-3">
              {waiting.map((p) => (
                <li key={p.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                  <p className="font-medium">{p.recipientName} <Badge tone="amber">{t("par.waiting")}</Badge></p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">{place(p)}</p>
                  <p className="text-xs text-slate-500">
                    {[p.carrier, p.trackingNumber, p.description].filter(Boolean).join(" · ")}
                    {" · "}
                    {t("par.received")}: {formatDateTime(p.receivedAt, prefs)}
                  </p>
                  <ActionForm action={collectParcelAction} className="mt-2 flex flex-wrap items-end gap-2 space-y-0">
                    <input type="hidden" name="id" value={p.id} />
                    <Field label={t("par.collectedBy")} name={`cb_${p.id}`} required className="grow">
                      <input id={`cb_${p.id}`} name="collectedBy" required minLength={2} maxLength={120} defaultValue={p.recipientName} className={inputClass} />
                    </Field>
                    <SubmitButton variant="secondary">{t("par.markCollected")}</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("par.log")}>
          <ActionForm action={logParcelAction} resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-2">
              <LocationPicker buildings={locations.buildings} units={locations.units} labels={{ building: t("common.building"), unit: t("common.unit"), none: t("common.none"), choose: t("par.choose") }} />
              <Input label={t("par.recipient")} name="recipientName" required minLength={2} maxLength={120} />
              <Input label={t("par.carrier")} name="carrier" maxLength={80} />
              <Input label={t("par.tracking")} name="trackingNumber" maxLength={80} />
              <Input label={t("par.description")} name="description" maxLength={300} />
            </div>
            <SubmitButton className="w-full sm:w-auto">{t("par.logSubmit")}</SubmitButton>
          </ActionForm>
        </Card>
        <Card title={t("par.collected")} className="lg:col-span-2">
          {collected.length === 0 ? (
            <p className="text-sm text-slate-500">{t("par.none")}</p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {collected.map((p) => (
                <li key={p.id} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
                  <p className="font-medium">{p.recipientName} <Badge tone="green">{t("par.collectedAt")}</Badge></p>
                  <p className="text-xs text-slate-500">{place(p)} · {t("par.collectedAt")}: {formatDateTime(p.collectedAt, prefs)} · {p.collectedBy}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
