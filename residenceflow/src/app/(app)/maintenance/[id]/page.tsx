import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { byPropertyWhere, can, maintenanceWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { WORK_ORDER_FLOW } from "@/domain/work-order";
import { assignableUsers, isVendorUser } from "@/services/maintenance";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Badge, Card, Checkbox, DescriptionList, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { addEvidenceAction, addNoteAction, approveEstimateAction, assignAction, changeStatusAction, logWorkAction, setEstimateAction } from "../actions";
import { maintenanceMessages } from "../messages";

export const metadata = { title: "Work order" };

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("maintenance.view");
  const { t, locale } = await getT(maintenanceMessages);
  const wo = await db.maintenanceRequest.findFirst({
    where: { ...maintenanceWhere(ctx), id },
    include: {
      property: { select: { id: true, name: true } },
      unit: { select: { id: true, number: true, block: true, floor: true } },
      tenant: { select: { id: true, legalName: true, preferredName: true, phone: true } },
      assignedTo: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true, phone: true } },
      updates: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!wo) notFound();

  const settings = await getOrgSettings(ctx.organizationId);
  const tz = settings?.timezone ?? "Africa/Douala";
  const prefs = { timezone: tz, dateFormat: settings?.dateFormat };
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const vendorUser = isVendorUser(ctx);
  const canUpdate = can(ctx, "maintenance.update");
  const canAssign = can(ctx, "maintenance.assign");
  const canClose = can(ctx, "maintenance.close");
  // Costs are financial data: only people doing or managing the work, or finance, see them.
  const showCosts = canUpdate || can(ctx, "expense.view");
  const showExpenses = can(ctx, "expense.view");
  const isClosed = ["CLOSED", "CANCELLED"].includes(wo.status);

  const [reporter, documents, expenses, users, vendors] = await Promise.all([
    wo.reporterId ? db.user.findFirst({ where: { id: wo.reporterId, organizationId: ctx.organizationId }, select: { name: true } }) : null,
    db.document.findMany({
      where: { organizationId: ctx.organizationId, workOrderId: wo.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true, visibleToTenant: true, mimeType: true },
    }),
    showExpenses
      ? db.expense.findMany({
          where: { ...byPropertyWhere(ctx), workOrderId: wo.id },
          orderBy: { expenseDate: "desc" },
          select: { id: true, description: true, amount: true, status: true, expenseDate: true, category: true },
        })
      : [],
    canAssign ? assignableUsers(ctx) : [],
    canAssign ? db.vendor.findMany({ where: { organizationId: ctx.organizationId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, category: true } }) : [],
  ]);

  const timeline = wo.updates.filter((u) => !(u.internal && vendorUser));
  const transitions = (WORK_ORDER_FLOW[wo.status] ?? []).filter((s) => s !== "ASSIGNED" && (s !== "CLOSED" || canClose) && (s !== "CANCELLED" || canAssign));
  const localInput = (d: Date | null) => (d ? formatInTimeZone(d, tz, "yyyy-MM-dd'T'HH:mm") : "");
  const unitLabel = wo.unit ? `${wo.unit.block ? `${wo.unit.block} · ` : ""}${wo.unit.number}` : t("wo.commonArea");
  const dict = { "wo.saved": t("wo.saved") };

  return (
    <>
      <PageHeader
        title={wo.title}
        description={`${wo.number} · ${wo.property.name} · ${unitLabel}`}
        breadcrumbs={[{ label: t("wo.title"), href: "/maintenance" }, { label: wo.number }]}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge status={wo.status}>{t(`wo.status.${wo.status}`)}</Badge>
        <Badge status={wo.priority}>{t("wo.priority")}: {t(`wo.priority.${wo.priority}`)}</Badge>
        {wo.safetyIssue && <Badge tone="red">⚠ {t("wo.safety")}</Badge>}
        {wo.estimateAmount && showCosts && <Badge tone={wo.estimateApproved ? "green" : "amber"}>{t("wo.estimate")}: {wo.estimateApproved ? t("wo.estimateApproved") : t("wo.estimatePending")}</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("wo.details")}>
            <DescriptionList
              items={[
                { label: t("common.building"), value: wo.property.name },
                { label: t("common.unit"), value: unitLabel },
                { label: t("wo.category"), value: t(`wo.category.${wo.category}`) },
                { label: t("wo.location"), value: wo.location },
                { label: t("wo.created"), value: formatDateTime(wo.createdAt, prefs) },
                { label: t("wo.reporter"), value: reporter?.name },
                { label: t("wo.assignedTo"), value: wo.assignedTo?.name ?? t("wo.unassigned") },
                { label: t("wo.vendor"), value: wo.vendor ? `${wo.vendor.name}${wo.vendor.phone ? ` · ${wo.vendor.phone}` : ""}` : null },
                { label: t("wo.scheduledAt"), value: wo.scheduledAt ? formatDateTime(wo.scheduledAt, prefs) : null },
                { label: t("wo.availableTimes"), value: wo.availableTimes },
                ...(wo.rating ? [{ label: t("wo.rating"), value: `${"★".repeat(wo.rating)}${"☆".repeat(5 - wo.rating)} (${wo.rating}/5)` }] : []),
              ]}
            />
            <p className="mt-4 whitespace-pre-line text-sm text-slate-700 dark:text-slate-200">{wo.description}</p>
            {wo.completionSummary && (
              <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950 dark:text-green-100">
                <p className="font-medium">{t("wo.completionSummary")}</p>
                <p className="whitespace-pre-line">{wo.completionSummary}</p>
              </div>
            )}
          </Card>

          {canUpdate && (
            <Card title={t("wo.changeStatus")}>
              {transitions.length === 0 ? (
                <p className="text-sm text-slate-500">{t("wo.noTransitions")}</p>
              ) : (
                <ActionForm action={changeStatusAction} dict={dict} resetOnSuccess>
                  <input type="hidden" name="id" value={wo.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select label={t("wo.newStatus")} name="to" required options={transitions.map((s) => ({ value: s, label: t(`wo.status.${s}`) }))} />
                    <Input label={t("wo.scheduledAt")} name="scheduledAt" type="datetime-local" defaultValue={localInput(wo.scheduledAt)} />
                  </div>
                  <Textarea label={t("wo.completionSummary")} name="completionSummary" hint={t("wo.completionHint")} defaultValue={wo.completionSummary} maxLength={4000} />
                  <Textarea label={t("wo.note")} name="note" maxLength={2000} />
                  <Checkbox label={t("wo.internalNote")} name="internal" />
                  <SubmitButton className="w-full sm:w-auto">{t("wo.changeStatus")}</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}

          <Card title={t("wo.timeline")}>
            {canUpdate && (
              <ActionForm action={addNoteAction} dict={dict} resetOnSuccess className="mb-4">
                <input type="hidden" name="id" value={wo.id} />
                <Textarea label={t("wo.note")} name="note" required maxLength={2000} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Checkbox label={t("wo.internalNote")} name="internal" defaultChecked={!vendorUser} />
                  <SubmitButton variant="secondary">{t("wo.addNote")}</SubmitButton>
                </div>
              </ActionForm>
            )}
            <ol className="space-y-3 border-l-2 border-slate-200 pl-4 dark:border-slate-700">
              {timeline.map((u) => (
                <li key={u.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{formatDateTime(u.createdAt, prefs)}</span>
                    <span>· {u.actorName ?? "—"}</span>
                    {u.internal && <Badge tone="violet">{t("wo.internal")}</Badge>}
                  </div>
                  {u.toStatus && (
                    <p className="mt-0.5">
                      {u.fromStatus && <><Badge status={u.fromStatus}>{t(`wo.status.${u.fromStatus}`)}</Badge> → </>}
                      <Badge status={u.toStatus}>{t(`wo.status.${u.toStatus}`)}</Badge>
                    </p>
                  )}
                  {u.note && <p className="mt-0.5 whitespace-pre-line text-slate-800 dark:text-slate-200">{u.note}</p>}
                </li>
              ))}
            </ol>
          </Card>

          <Card title={t("wo.evidence")}>
            {documents.length === 0 ? (
              <p className="text-sm text-slate-500">{t("wo.noEvidence")}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {documents.map((d) => (
                  <li key={d.id} className="rounded-md border border-slate-200 p-2 text-xs dark:border-slate-700">
                    <a href={`/api/documents/${d.id}?inline=1`} target="_blank" rel="noopener noreferrer" className="block">
                      {d.mimeType.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/documents/${d.id}?inline=1`} alt={d.name} className="mb-1 h-28 w-full rounded object-cover" loading="lazy" />
                      ) : null}
                      <span className="break-all text-[var(--brand)] hover:underline">{d.name}</span>
                    </a>
                    <div className="mt-1 text-slate-500">
                      {formatDateTime(d.createdAt, prefs)}
                      {!vendorUser && d.visibleToTenant && <> · {t("wo.visibleToTenant")}</>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {canUpdate && (
              <ActionForm action={addEvidenceAction} dict={dict} resetOnSuccess className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                <input type="hidden" name="id" value={wo.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select label={t("wo.phase")} name="phase" options={["BEFORE", "AFTER", "OTHER"].map((v) => ({ value: v, label: t(`wo.phase.${v}`) }))} />
                  <Field label={t("wo.photo")} name="file" hint={t("wo.photoHint")} required>
                    <input id="file" name="file" type="file" required accept="image/png,image/jpeg,image/webp,application/pdf" capture="environment" className="block w-full text-sm" />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Checkbox label={t("wo.visibleToTenant")} name="visibleToTenant" defaultChecked />
                  <SubmitButton variant="secondary">{t("wo.upload")}</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {wo.tenant && (
            <Card title={t("wo.contact")}>
              <DescriptionList
                items={[
                  {
                    label: t("wo.resident"),
                    value: can(ctx, "tenant.view") && !vendorUser && ctx.scope !== "OWN" ? (
                      <Link className="text-[var(--brand)] hover:underline" href={`/tenants/${wo.tenant.id}`}>{wo.tenant.preferredName || wo.tenant.legalName}</Link>
                    ) : (
                      wo.tenant.preferredName || wo.tenant.legalName
                    ),
                  },
                  { label: t("common.phone"), value: wo.tenant.phone ? <a className="text-[var(--brand)] hover:underline" href={`tel:${wo.tenant.phone.replace(/\s+/g, "")}`}>{wo.tenant.phone}</a> : null },
                  { label: t("common.unit"), value: unitLabel },
                  { label: t("wo.access"), value: wo.accessPreference },
                ]}
              />
            </Card>
          )}
          {!wo.tenant && wo.accessPreference && (
            <Card title={t("wo.access")}>
              <p className="text-sm">{wo.accessPreference}</p>
            </Card>
          )}

          {canAssign && !isClosed && (
            <Card title={t("wo.assign")}>
              <ActionForm action={assignAction} dict={dict}>
                <input type="hidden" name="id" value={wo.id} />
                <Select label={t("wo.technician")} name="assigneeId" defaultValue={wo.assignedToId ?? ""} placeholder={t("common.none")} options={users.map((u) => ({ value: u.id, label: u.name }))} />
                <Select label={t("wo.vendor")} name="vendorId" defaultValue={wo.vendorId ?? ""} placeholder={t("common.none")} options={vendors.map((v) => ({ value: v.id, label: `${v.name} (${v.category})` }))} />
                <Input label={t("wo.scheduledAt")} name="scheduledAt" type="datetime-local" defaultValue={localInput(wo.scheduledAt)} />
                <Input label={t("wo.note")} name="note" maxLength={1000} />
                <SubmitButton className="w-full">{t("wo.assignSubmit")}</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {showCosts && (
            <Card title={t("wo.workLog")}>
              <DescriptionList
                items={[
                  { label: t("wo.totalLabor"), value: t("wo.minutes", { n: wo.laborMinutes }) },
                  { label: t("wo.totalCost"), value: formatMoney(wo.costAmount, fmt) },
                ]}
              />
              {canUpdate && !isClosed && (
                <ActionForm action={logWorkAction} dict={dict} resetOnSuccess className="mt-4">
                  <input type="hidden" name="id" value={wo.id} />
                  <div className="grid grid-cols-2 gap-3">
                    <Input label={t("wo.laborMinutes")} name="minutes" type="number" min={0} step={1} inputMode="numeric" />
                    <Input label={t("wo.cost")} name="cost" type="number" min={0} step="0.01" inputMode="decimal" />
                  </div>
                  <Input label={t("wo.note")} name="note" maxLength={1000} />
                  <SubmitButton variant="secondary" className="w-full">{t("wo.logWork")}</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}

          {showCosts && (
            <Card title={t("wo.estimate")}>
              {wo.estimateAmount ? (
                <p className="text-sm">
                  {formatMoney(wo.estimateAmount, fmt)}{" "}
                  <Badge tone={wo.estimateApproved ? "green" : "amber"}>{wo.estimateApproved ? t("wo.estimateApproved") : t("wo.estimatePending")}</Badge>
                </p>
              ) : (
                <p className="text-sm text-slate-500">—</p>
              )}
              {canAssign && wo.estimateAmount && !wo.estimateApproved && (
                <div className="mt-3 space-y-1">
                  <InlineAction action={approveEstimateAction} label={t("wo.approveEstimate")} variant="primary" confirm={t("wo.approveConfirm")} hidden={{ id: wo.id }} />
                  <p className="text-xs text-slate-500">{t("wo.thresholdHint", { amount: formatMoney(settings?.expenseApprovalThreshold ?? 0, fmt) })}</p>
                </div>
              )}
              {canUpdate && !isClosed && (
                <ActionForm action={setEstimateAction} dict={dict} resetOnSuccess className="mt-4">
                  <input type="hidden" name="id" value={wo.id} />
                  <Input label={t("wo.estimateAmount")} name="amount" type="number" min={0} step="0.01" inputMode="decimal" required />
                  <Input label={t("wo.note")} name="note" maxLength={1000} />
                  <SubmitButton variant="secondary" className="w-full">{t("wo.estimateSubmit")}</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}

          {showExpenses && (
            <Card
              title={t("wo.expenses")}
              actions={can(ctx, "expense.create") && <LinkButton variant="secondary" href={`/expenses/new?workOrderId=${wo.id}`}>{t("wo.addExpense")}</LinkButton>}
            >
              {expenses.length === 0 ? (
                <p className="text-sm text-slate-500">{t("wo.noExpenses")}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {expenses.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {e.description}
                        <span className="block text-xs text-slate-500">{formatDay(e.expenseDate, prefs)}</span>
                      </span>
                      <span className="text-right">
                        {formatMoney(e.amount, fmt)} <Badge status={e.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
