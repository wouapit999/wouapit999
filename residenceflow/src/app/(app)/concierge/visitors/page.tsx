import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Badge, Card, FilterBar, Input, PageHeader, Select, str } from "@/components/ui";
import { LocationPicker } from "@/components/ops/location-picker";
import { locationOptions } from "@/services/maintenance";
import { VISITOR_KINDS, residentDirectory, visitorWhere } from "@/services/concierge";
import { arrivedAction, checkInAction, checkOutAction, preauthorizeAction } from "./actions";
import { visitorMessages } from "./messages";

export const metadata = { title: "Visitors" };

type VisitorRow = Awaited<ReturnType<typeof loadRows>>[number];
function loadRows(where: Parameters<typeof db.visitorLog.findMany>[0]) {
  return db.visitorLog.findMany({
    ...where,
    include: { property: { select: { name: true } }, unit: { select: { number: true, block: true } }, hostTenant: { select: { legalName: true, preferredName: true } } },
  });
}

export default async function VisitorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("concierge.visitors.manage");
  const { t } = await getT(visitorMessages);
  const sp = await searchParams;
  const settings = await getOrgSettings(ctx.organizationId);
  const tz = settings?.timezone ?? "Africa/Douala";
  const prefs = { timezone: tz, dateFormat: settings?.dateFormat };
  const startOfToday = fromZonedTime(`${formatInTimeZone(new Date(), tz, "yyyy-MM-dd")}T00:00:00`, tz);
  const scope = await visitorWhere(ctx);
  const showDirectory = can(ctx, "concierge.directory.view");
  const q = str(sp.q).trim().slice(0, 80);
  const dirProperty = str(sp.propertyId);

  const [onSite, expected, recent, locations, directory] = await Promise.all([
    loadRows({ where: { ...scope, checkInAt: { not: null }, checkOutAt: null }, orderBy: { checkInAt: "desc" }, take: 100 }),
    loadRows({ where: { ...scope, preauthorized: true, checkInAt: null, expectedAt: { gte: startOfToday } }, orderBy: { expectedAt: "asc" }, take: 50 }),
    loadRows({ where: { ...scope, checkOutAt: { not: null } }, orderBy: { checkOutAt: "desc" }, take: 30 }),
    locationOptions(ctx, { withTenants: true }),
    showDirectory ? residentDirectory(ctx, { q, propertyId: dirProperty || undefined }) : [],
  ]);

  const labels = { building: t("common.building"), unit: t("common.unit"), tenant: t("vis.host"), none: t("common.none"), choose: t("vis.choose") };
  const kindOptions = VISITOR_KINDS.map((k) => ({ value: k, label: t(`vis.kind.${k}`) }));
  const where = (v: VisitorRow) =>
    `${v.property.name}${v.unit ? ` · ${v.unit.block ? `${v.unit.block} · ` : ""}${v.unit.number}` : ""}${v.hostTenant ? ` · ${v.hostTenant.preferredName || v.hostTenant.legalName}` : ""}`;
  const VisitorCard = ({ v, children }: { v: VisitorRow; children?: React.ReactNode }) => (
    <li className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
      <div className="min-w-0">
        <p className="font-medium">
          {v.visitorName} <Badge tone={v.kind === "CONTRACTOR" ? "violet" : v.kind === "DELIVERY" ? "blue" : "slate"}>{t(`vis.kind.${v.kind}`)}</Badge>{" "}
          {v.preauthorized && <Badge tone="green">{t("vis.preauth")}</Badge>}
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400">{where(v)}</p>
        <p className="text-xs text-slate-500">
          {v.visitorPhone && <>{v.visitorPhone} · </>}
          {v.purpose && <>{v.purpose} · </>}
          {v.expectedAt && !v.checkInAt && <>{t("vis.expectedAt")}: {formatDateTime(v.expectedAt, prefs)}</>}
          {v.checkInAt && <>{t("vis.in")}: {formatDateTime(v.checkInAt, prefs)}</>}
          {v.checkOutAt && <> · {t("vis.out")}: {formatDateTime(v.checkOutAt, prefs)}</>}
        </p>
      </div>
      {children}
    </li>
  );

  return (
    <>
      <PageHeader title={t("vis.title")} description={t("vis.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`${t("vis.onSite")} (${onSite.length})`}>
          {onSite.length === 0 ? (
            <p className="text-sm text-slate-500">{t("vis.none")}</p>
          ) : (
            <ul className="space-y-2">
              {onSite.map((v) => (
                <VisitorCard key={v.id} v={v}>
                  <InlineAction action={checkOutAction} label={t("vis.checkOut")} hidden={{ id: v.id }} />
                </VisitorCard>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`${t("vis.expected")} (${expected.length})`}>
          {expected.length === 0 ? (
            <p className="text-sm text-slate-500">{t("vis.none")}</p>
          ) : (
            <ul className="space-y-2">
              {expected.map((v) => (
                <VisitorCard key={v.id} v={v}>
                  <InlineAction action={arrivedAction} label={t("vis.arrived")} variant="primary" hidden={{ id: v.id }} />
                </VisitorCard>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("vis.checkIn")}>
          <ActionForm action={checkInAction} resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-2">
              <LocationPicker buildings={locations.buildings} units={locations.units} withTenant tenantName="hostTenantId" labels={labels} />
              <Input label={t("vis.visitorName")} name="visitorName" required minLength={2} maxLength={120} autoComplete="off" />
              <Input label={t("vis.visitorPhone")} name="visitorPhone" type="tel" maxLength={40} autoComplete="off" />
              <Select label={t("vis.kind")} name="kind" options={kindOptions} />
              <Input label={t("vis.purpose")} name="purpose" maxLength={300} />
            </div>
            <SubmitButton className="w-full sm:w-auto">{t("vis.checkInSubmit")}</SubmitButton>
          </ActionForm>
        </Card>
        <Card title={t("vis.preauthorize")}>
          <ActionForm action={preauthorizeAction} resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-2">
              <LocationPicker buildings={locations.buildings} units={locations.units} withTenant tenantName="hostTenantId" idPrefix="pa_" labels={labels} />
              <Input label={t("vis.visitorName")} name="visitorName" required minLength={2} maxLength={120} autoComplete="off" />
              <Input label={t("vis.visitorPhone")} name="visitorPhone" type="tel" maxLength={40} autoComplete="off" />
              <Select label={t("vis.kind")} name="kind" options={kindOptions} />
              <Input label={t("vis.expectedAt")} name="expectedAt" type="datetime-local" required />
              <Input label={t("vis.purpose")} name="purpose" maxLength={300} />
            </div>
            <SubmitButton variant="secondary" className="w-full sm:w-auto">{t("vis.preauthorizeSubmit")}</SubmitButton>
          </ActionForm>
        </Card>
        <Card title={t("vis.recent")} className="lg:col-span-2">
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">{t("vis.none")}</p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {recent.map((v) => (
                <VisitorCard key={v.id} v={v} />
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">{t("vis.retention", { days: settings?.visitorRetentionDays ?? 180 })}</p>
        </Card>
        {showDirectory && (
          <Card title={t("vis.directory")} className="lg:col-span-2">
            <p className="mb-3 text-xs text-slate-500">{t("vis.directoryHint")}</p>
            <FilterBar action="/concierge/visitors">
              <Input label={t("vis.searchResident")} name="q" defaultValue={q} wrapperClassName="w-56" />
              {locations.buildings.length > 1 && (
                <Select label={t("common.building")} name="propertyId" defaultValue={dirProperty} placeholder={t("common.all")} options={locations.buildings.map((b) => ({ value: b.id, label: b.name }))} wrapperClassName="w-48" />
              )}
            </FilterBar>
            {directory.length === 0 ? (
              <p className="text-sm text-slate-500">{t("common.empty")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {directory.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{r.name}</span>
                      <span className="block text-xs text-slate-500">{r.building} · {r.unit}</span>
                    </span>
                    {r.phone ? <a className="text-[var(--brand)] hover:underline" href={`tel:${r.phone.replace(/\s+/g, "")}`}>{r.phone}</a> : <span className="text-slate-400">—</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
