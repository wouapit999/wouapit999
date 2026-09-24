import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, DescriptionList, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { COMPLETION_WO, RATEABLE_WO } from "@/services/portal";
import { confirmMaintenanceAction, rateMaintenanceAction, reopenMaintenanceAction } from "../../actions";
import { PORTAL_ERROR_KEYS, dictFor, portalPage } from "../../kit";

export const metadata = { title: "Maintenance request" };
export const dynamic = "force-dynamic";

export default async function PortalMaintenanceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tenantId, t, df, settings } = await portalPage();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const req = await db.maintenanceRequest.findFirst({
    where: { id, tenantId, organizationId: ctx.organizationId },
    include: {
      property: { select: { name: true } },
      unit: { select: { number: true } },
      updates: { where: { internal: false }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!req) notFound();
  const photos = await db.document.findMany({
    where: { organizationId: ctx.organizationId, workOrderId: req.id, tenantId, visibleToTenant: true, sensitive: false },
    select: { id: true, name: true, mimeType: true },
    orderBy: { createdAt: "asc" },
  });
  const dict = dictFor(t, PORTAL_ERROR_KEYS);
  const awaiting = (COMPLETION_WO as readonly string[]).includes(req.status);
  const rateable = (RATEABLE_WO as readonly string[]).includes(req.status);
  const ratingOptions = [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${"★".repeat(n)} (${n}/5)` }));

  return (
    <>
      <PageHeader
        title={req.title}
        description={`${req.number} · ${req.property.name}${req.unit ? ` · ${t("common.unit")} ${req.unit.number}` : ""}`}
        breadcrumbs={[{ label: t("nav.portal.maintenance"), href: "/portal/maintenance" }, { label: req.number }]}
      />
      <div className="mb-4 space-y-2">
        {str(sp.created) === "1" && <Alert tone="success">{t("portal.mnt.created", { number: req.number })}</Alert>}
        {(req.priority === "URGENT" || req.safetyIssue) && (
          <Alert tone="warn">
            <strong className="block">{t("portal.mnt.emergencyTitle")}</strong>
            <span className="whitespace-pre-line">{settings?.emergencyInstructions}</span>
            <span className="mt-1 block text-xs">{t("portal.mnt.notEmergency")}</span>
          </Alert>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t("portal.mnt.details")}>
            <DescriptionList
              items={[
                { label: t("common.status"), value: <Badge status={req.status}>{t(`portal.wo.${req.status}`)}</Badge> },
                { label: t("portal.mnt.urgency"), value: <Badge status={req.priority}>{t(`portal.prio.${req.priority}`)}</Badge> },
                { label: t("portal.mnt.category"), value: t(`portal.cat.${req.category}`) },
                { label: t("portal.mnt.safety"), value: req.safetyIssue ? t("portal.yes") : t("portal.no") },
                { label: t("portal.mnt.location"), value: req.location },
                { label: t("portal.mnt.access"), value: req.accessPreference },
                { label: t("portal.mnt.times"), value: req.availableTimes },
                { label: t("portal.mnt.scheduled"), value: req.scheduledAt ? formatDateTime(req.scheduledAt, df) : null },
                { label: t("portal.mnt.submitted"), value: formatDateTime(req.createdAt, df) },
                { label: t("portal.mnt.rating"), value: req.rating ? `${"★".repeat(req.rating)} (${req.rating}/5)` : null },
              ]}
            />
            <p className="mt-4 whitespace-pre-line text-sm">{req.description}</p>
            {req.completionSummary && (
              <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800">
                <div className="text-xs font-medium uppercase text-slate-500">{t("portal.mnt.completion")}</div>
                <p className="mt-1 whitespace-pre-line">{req.completionSummary}</p>
              </div>
            )}
            {photos.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2 text-sm">
                {photos.map((p) => (
                  <li key={p.id}><a className="text-[var(--brand)] hover:underline" href={`/api/documents/${p.id}?inline=1`} target="_blank" rel="noopener noreferrer">{p.name}</a></li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t("portal.mnt.timeline")}>
            <ol className="space-y-3">
              {req.updates.map((u) => (
                <li key={u.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{formatDateTime(u.createdAt, df)}</span>
                    {u.actorName && <span>· {u.actorName}</span>}
                    {u.toStatus && <Badge status={u.toStatus}>{t(`portal.wo.${u.toStatus}`)}</Badge>}
                  </div>
                  {u.note && <p className="mt-1 whitespace-pre-line text-sm">{u.note}</p>}
                </li>
              ))}
              {req.updates.length === 0 && <li className="text-sm text-slate-500">{t("common.empty")}</li>}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          {awaiting && (
            <Card title={t("portal.mnt.confirmTitle")}>
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t("portal.mnt.confirmHint")}</p>
              <ActionForm action={confirmMaintenanceAction} dict={dict}>
                <input type="hidden" name="id" value={req.id} />
                <Select label={t("portal.mnt.rating")} name="rating" placeholder={t("portal.mnt.noRating")} options={ratingOptions} />
                <Input label={t("portal.mnt.comment")} name="comment" maxLength={500} />
                <SubmitButton>{t("portal.mnt.confirm")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {rateable && (
            <Card title={t("portal.mnt.reopenTitle")}>
              <ActionForm action={reopenMaintenanceAction} dict={dict} confirm={t("portal.mnt.reopenConfirm")}>
                <input type="hidden" name="id" value={req.id} />
                <Textarea label={t("portal.mnt.reopenReason")} name="reason" required minLength={3} maxLength={1000} />
                <SubmitButton variant="secondary">{t("portal.mnt.reopen")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {rateable && !awaiting && (
            <Card title={t("portal.mnt.rateTitle")}>
              <ActionForm action={rateMaintenanceAction} dict={dict}>
                <input type="hidden" name="id" value={req.id} />
                <Select label={t("portal.mnt.rating")} name="rating" required defaultValue={req.rating ? String(req.rating) : "5"} options={ratingOptions} />
                <Input label={t("portal.mnt.comment")} name="comment" maxLength={500} />
                <SubmitButton variant="secondary">{t("portal.mnt.rate")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function str(v: string | string[] | undefined) {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
