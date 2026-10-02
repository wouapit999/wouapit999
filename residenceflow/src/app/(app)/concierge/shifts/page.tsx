import { db } from "@/lib/db";
import { byPropertyWhere, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Badge, Card, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { endShiftAction, issueKeyAction, returnKeyAction, startShiftAction } from "./actions";
import { shiftMessages } from "./messages";

export const metadata = { title: "Shifts & keys" };

export default async function ShiftsPage() {
  const ctx = await requireContext("concierge.shifts.manage");
  const { t } = await getT(shiftMessages);
  const include = { property: { select: { name: true } } } as const;
  const [settings, buildings, current, recent, keysOut, keysBack] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.property.findMany({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.shiftLog.findFirst({ where: { ...byPropertyWhere(ctx), userId: ctx.user.id, shiftEnd: null }, include }),
    db.shiftLog.findMany({ where: byPropertyWhere(ctx), orderBy: { shiftStart: "desc" }, take: 20, include }),
    db.keyRecord.findMany({ where: { ...byPropertyWhere(ctx), returnedAt: null }, orderBy: { issuedAt: "desc" }, take: 200, include }),
    db.keyRecord.findMany({ where: { ...byPropertyWhere(ctx), returnedAt: { not: null } }, orderBy: { returnedAt: "desc" }, take: 20, include }),
  ]);
  const prefs = { timezone: settings?.timezone ?? "Africa/Douala", dateFormat: settings?.dateFormat };
  const buildingOptions = buildings.map((b) => ({ value: b.id, label: b.name }));
  const defaultBuilding = buildings.length === 1 ? buildings[0].id : "";

  return (
    <>
      <PageHeader title={t("sh.title")} description={t("sh.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("sh.current")}>
          {current ? (
            <>
              <p className="text-sm">
                <Badge tone="green">{t("sh.inProgress")}</Badge> {current.property.name} · {t("sh.started")}: {formatDateTime(current.shiftStart, prefs)}
              </p>
              {current.notes && <p className="mt-2 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">{current.notes}</p>}
              <ActionForm action={endShiftAction} className="mt-4">
                <input type="hidden" name="id" value={current.id} />
                <Textarea label={t("sh.handoverNotes")} name="notes" maxLength={4000} rows={4} />
                <Input label={t("sh.handoverTo")} name="handoverTo" maxLength={120} />
                <SubmitButton variant="danger" className="w-full sm:w-auto">{t("sh.end")}</SubmitButton>
              </ActionForm>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-500">{t("sh.none")}</p>
              <ActionForm action={startShiftAction}>
                <Select label={t("common.building")} name="propertyId" required defaultValue={defaultBuilding} placeholder={t("sh.choose")} options={buildingOptions} />
                <Textarea label={t("sh.notes")} name="notes" maxLength={2000} />
                <SubmitButton className="w-full sm:w-auto">{t("sh.start")}</SubmitButton>
              </ActionForm>
            </>
          )}
        </Card>

        <Card title={t("sh.recent")}>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">{t("sh.nothing")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recent.map((s) => (
                <li key={s.id} className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                  <p className="font-medium">
                    {s.userName} · {s.property.name} {!s.shiftEnd && <Badge tone="green">{t("sh.inProgress")}</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t("sh.started")}: {formatDateTime(s.shiftStart, prefs)}
                    {s.shiftEnd && <> · {t("sh.ended")}: {formatDateTime(s.shiftEnd, prefs)}</>}
                    {s.handoverTo && <> · {t("sh.handoverTo")}: {s.handoverTo}</>}
                  </p>
                  {s.notes && <p className="mt-1 whitespace-pre-line text-xs text-slate-700 dark:text-slate-300">{s.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`${t("sh.keys")} — ${t("sh.out")} (${keysOut.length})`}>
          {keysOut.length === 0 ? (
            <p className="text-sm text-slate-500">{t("sh.nothing")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {keysOut.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-700">
                  <span>
                    <span className="font-medium">{k.label}</span> <Badge tone="amber">{t("sh.issued")}</Badge>
                    <span className="block text-xs text-slate-500">
                      {k.holderName} · {k.property.name} · {formatDateTime(k.issuedAt, prefs)}
                      {k.notes && ` · ${k.notes}`}
                    </span>
                  </span>
                  <InlineAction action={returnKeyAction} label={t("sh.return")} hidden={{ id: k.id }} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("sh.issue")}>
          <ActionForm action={issueKeyAction} resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label={t("common.building")} name="propertyId" id="key_propertyId" required defaultValue={defaultBuilding} placeholder={t("sh.choose")} options={buildingOptions} />
              <Input label={t("sh.label")} name="label" required maxLength={120} hint={t("sh.labelHint")} />
              <Input label={t("sh.holder")} name="holderName" required minLength={2} maxLength={120} />
              <Input label={t("sh.notes")} name="notes" id="key_notes" maxLength={500} />
            </div>
            <SubmitButton className="w-full sm:w-auto">{t("sh.issueSubmit")}</SubmitButton>
          </ActionForm>
          {keysBack.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-semibold">{t("sh.returned")}</h3>
              <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                {keysBack.map((k) => (
                  <li key={k.id}>
                    {k.label} · {k.holderName} · {t("sh.returned")}: {formatDateTime(k.returnedAt, prefs)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
