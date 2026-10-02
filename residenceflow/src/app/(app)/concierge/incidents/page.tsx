import { db } from "@/lib/db";
import { byPropertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, FilterBar, Input, PageHeader, Select, Textarea, str } from "@/components/ui";
import { locationOptions } from "@/services/maintenance";
import { INCIDENT_KINDS, SEVERITIES } from "@/services/concierge";
import { createIncidentAction, resolveIncidentAction } from "./actions";
import { incidentMessages } from "./messages";

export const metadata = { title: "Incidents" };

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("concierge.incidents.manage");
  const { t } = await getT(incidentMessages);
  const sp = await searchParams;
  const kind = (INCIDENT_KINDS as readonly string[]).includes(str(sp.kind)) ? str(sp.kind) : "";
  const base = { ...byPropertyWhere(ctx), ...(kind ? { kind } : {}) };
  const include = { property: { select: { name: true } } } as const;
  const [settings, open, resolved, { buildings }] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.incident.findMany({ where: { ...base, status: "OPEN" }, orderBy: { occurredAt: "desc" }, take: 100, include }),
    db.incident.findMany({ where: { ...base, status: "RESOLVED" }, orderBy: { occurredAt: "desc" }, take: 30, include }),
    locationOptions(ctx),
  ]);
  const reporters = await db.user.findMany({
    where: { organizationId: ctx.organizationId, id: { in: [...open, ...resolved].map((i) => i.reportedById).filter((x): x is string => !!x) } },
    select: { id: true, name: true },
  });
  const prefs = { timezone: settings?.timezone ?? "Africa/Douala", dateFormat: settings?.dateFormat };
  const sevRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  open.sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9) || b.occurredAt.getTime() - a.occurredAt.getTime());

  const Item = ({ i, children }: { i: (typeof open)[number]; children?: React.ReactNode }) => (
    <li className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={i.kind === "LOST_FOUND" ? "blue" : "slate"}>{t(`inc.kind.${i.kind}`)}</Badge>
        <Badge status={i.severity}>{t("inc.severity")}: {t(`inc.sev.${i.severity}`)}</Badge>
        <Badge status={i.status}>{t(`inc.status.${i.status}`)}</Badge>
      </div>
      <p className="mt-1 font-medium">{i.title}</p>
      <p className="text-xs text-slate-500">
        {i.property.name} · {formatDateTime(i.occurredAt, prefs)} · {t("inc.reportedBy")}: {reporters.find((r) => r.id === i.reportedById)?.name ?? "—"}
      </p>
      <p className="mt-1 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{i.description}</p>
      {children}
    </li>
  );

  return (
    <>
      <PageHeader title={t("inc.title")} description={t("inc.subtitle")} />
      <FilterBar action="/concierge/incidents">
        <Select label={t("inc.kind")} name="kind" defaultValue={kind} placeholder={t("common.all")} options={INCIDENT_KINDS.map((k) => ({ value: k, label: t(`inc.kind.${k}`) }))} wrapperClassName="w-48" />
      </FilterBar>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`${t("inc.open")} (${open.length})`}>
          {open.length === 0 ? (
            <p className="text-sm text-slate-500">{t("inc.none")}</p>
          ) : (
            <ul className="space-y-3">
              {open.map((i) => (
                <Item key={i.id} i={i}>
                  <ActionForm action={resolveIncidentAction} className="mt-2 space-y-2">
                    <input type="hidden" name="id" value={i.id} />
                    <label className="sr-only" htmlFor={`note_${i.id}`}>{t("inc.resolutionNote")}</label>
                    <input id={`note_${i.id}`} name="note" maxLength={1000} placeholder={t("inc.resolutionNote")} className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
                    <SubmitButton variant="secondary">{t("inc.resolve")}</SubmitButton>
                  </ActionForm>
                </Item>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("inc.new")}>
          <div className="mb-3"><Alert tone="warn">{t("inc.emergency")}</Alert></div>
          <ActionForm action={createIncidentAction} resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label={t("common.building")} name="propertyId" required defaultValue={buildings.length === 1 ? buildings[0].id : ""} placeholder={t("inc.choose")} options={buildings.map((b) => ({ value: b.id, label: b.name }))} />
              <Select label={t("inc.kind")} name="kind" options={INCIDENT_KINDS.map((k) => ({ value: k, label: t(`inc.kind.${k}`) }))} />
              <Select label={t("inc.severity")} name="severity" options={SEVERITIES.map((s) => ({ value: s, label: t(`inc.sev.${s}`) }))} />
              <Input label={t("inc.occurredAt")} name="occurredAt" type="datetime-local" />
            </div>
            <Input label={t("inc.titleField")} name="title" required minLength={3} maxLength={150} />
            <Textarea label={t("inc.description")} name="description" required minLength={3} maxLength={4000} />
            <SubmitButton className="w-full sm:w-auto">{t("inc.new")}</SubmitButton>
          </ActionForm>
        </Card>
        <Card title={t("inc.resolved")} className="lg:col-span-2">
          {resolved.length === 0 ? (
            <p className="text-sm text-slate-500">{t("inc.none")}</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {resolved.map((i) => (
                <Item key={i.id} i={i} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
