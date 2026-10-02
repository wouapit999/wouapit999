import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { money } from "@/lib/money";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, Checkbox, DescriptionList, EmptyState, PageHeader, Select, Textarea, humanize } from "@/components/ui";
import { unitMessages } from "../../units/messages";
import { unitLabel } from "../../leases/data";
import {
  approveApplicationAction,
  convertApplicationAction,
  rejectApplicationAction,
  startReviewAction,
  toggleReservationPaidAction,
  updateChecklistAction,
  updateReviewNotesAction,
  withdrawApplicationAction,
} from "../actions";
import { applicationsEnabled, availableUnits, loadScopedApplication, parseChecklist } from "../data";
import { applicationMessages } from "../messages";

export const metadata = { title: "Application" };

const OPEN = ["SUBMITTED", "UNDER_REVIEW"];
const TERMINAL = ["REJECTED", "WITHDRAWN", "CONVERTED"];

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext(["lease.view", "lease.create"]);
  const { t, locale } = await getT(applicationMessages, unitMessages);
  if (!(await applicationsEnabled(ctx.organizationId))) {
    return (
      <>
        <PageHeader title={t("app.title")} breadcrumbs={[{ label: t("app.title"), href: "/applications" }]} />
        <EmptyState title={t("app.disabled")} description={t("app.disabledHint")} />
      </>
    );
  }
  const app = await loadScopedApplication(ctx, id);
  if (!app) notFound();

  const manage = can(ctx, "lease.create");
  const decide = can(ctx, "lease.approve");
  const s = app.status;

  const [settings, events, units, tenant, lease] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.auditLog.findMany({
      where: { organizationId: ctx.organizationId, entityType: "RentalApplication", entityId: app.id },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, action: true, actorName: true, createdAt: true, metadata: true },
    }),
    manage && s === "APPROVED" ? availableUnits(ctx, app.unitId) : Promise.resolve([]),
    app.tenantId && can(ctx, "tenant.view")
      ? db.tenant.findFirst({ where: { id: app.tenantId, organizationId: ctx.organizationId }, select: { id: true, legalName: true, reference: true } })
      : Promise.resolve(null),
    app.leaseId ? db.lease.findFirst({ where: { id: app.leaseId, organizationId: ctx.organizationId }, select: { id: true, reference: true, status: true } }) : Promise.resolve(null),
  ]);
  const actorIds = [app.reviewedById, app.createdById].filter((x): x is string => !!x);
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds }, organizationId: ctx.organizationId }, select: { id: true, name: true } }) : [];
  const actorName = (uid: string | null) => (uid ? actors.find((a) => a.id === uid)?.name ?? "—" : "—");

  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const checklist = parseChecklist(app.checklist);
  const eventLabel = (action: string) => {
    const k = `app.ev.${action.replace(/^application\./, "")}`;
    const v = t(k);
    return v === k ? humanize(action.replace(/^application\./, "")) : v;
  };
  const reasonOf = (meta: unknown) => (meta && typeof meta === "object" && typeof (meta as { reason?: unknown }).reason === "string" ? (meta as { reason: string }).reason : "");

  const isOpen = OPEN.includes(s);
  const canStart = manage && s === "SUBMITTED";
  const canApprove = decide && isOpen;
  const canReject = decide && (isOpen || s === "APPROVED");
  const canWithdraw = manage && (isOpen || s === "APPROVED");
  const canToggleFee = manage && !TERMINAL.includes(s) && money(app.reservationFee).gt(0);
  const canConvert = manage && s === "APPROVED";
  const anyAction = canStart || canApprove || canReject || canWithdraw || canToggleFee || canConvert;

  return (
    <>
      <PageHeader
        title={`${t("app.title")} ${app.reference}`}
        description={app.applicantName}
        breadcrumbs={[{ label: t("app.title"), href: "/applications" }, { label: app.reference }]}
        actions={<Badge status={s}>{t(`app.status.${s}`)}</Badge>}
      />
      <div className="mb-4"><Alert tone="info">{t("app.fairness")}</Alert></div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("app.applicant")}>
            <DescriptionList
              items={[
                { label: t("app.applicantName"), value: app.applicantName },
                { label: t("app.applicantType"), value: t(`app.type.${app.applicantType}`) },
                { label: t("common.email"), value: app.applicantEmail },
                { label: t("common.phone"), value: app.applicantPhone },
                { label: t("app.employer"), value: app.employer },
                { label: t("app.monthlyIncome"), value: app.monthlyIncome ? formatMoney(app.monthlyIncome, fmt) : null },
                { label: t("app.householdSize"), value: String(app.householdSize) },
                { label: t("app.desiredUnit"), value: app.unit ? <Link className="text-[var(--brand)] hover:underline" href={`/units/${app.unit.id}`}>{unitLabel(app.unit)} ({t(`unit.status.${app.unit.status}`)})</Link> : null },
                { label: t("app.desiredMoveIn"), value: app.desiredMoveIn ? formatDay(app.desiredMoveIn, df) : null },
                { label: t("app.reservationFee"), value: money(app.reservationFee).gt(0) ? `${formatMoney(app.reservationFee, fmt)} · ${app.reservationPaid ? t("app.reservationPaid") : t("app.reservationNotPaid")}` : null },
                { label: t("app.createdBy"), value: `${formatDateTime(app.createdAt, df)} · ${actorName(app.createdById)}` },
                { label: t("app.decidedAt"), value: app.decidedAt ? `${formatDateTime(app.decidedAt, df)} · ${actorName(app.reviewedById)}` : null },
                { label: t("app.decisionReason"), value: app.decisionReason },
                { label: t("app.linkedTenant"), value: tenant ? <Link className="text-[var(--brand)] hover:underline" href={`/tenants/${tenant.id}`}>{tenant.legalName} · {tenant.reference}</Link> : null },
                { label: t("app.linkedLease"), value: lease ? <Link className="text-[var(--brand)] hover:underline" href={`/leases/${lease.id}`}>{lease.reference} ({humanize(lease.status)})</Link> : null },
              ]}
            />
            {app.notes && (
              <div className="mt-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("common.notes")}</h3>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{app.notes}</p>
              </div>
            )}
          </Card>

          <Card title={t("app.checklist")}>
            {manage && !TERMINAL.includes(s) ? (
              <ActionForm action={updateChecklistAction}>
                <input type="hidden" name="id" value={app.id} />
                <p className="text-xs text-slate-500 dark:text-slate-400">{t("app.checklistHint")}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {checklist.map((c) => (
                    <Checkbox key={c.item} name="checklist" value={c.item} defaultChecked={c.received} label={t(`app.check.${c.item}`)} />
                  ))}
                </div>
                <SubmitButton variant="secondary">{t("app.saveChecklist")}</SubmitButton>
              </ActionForm>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {checklist.map((c) => (
                  <li key={c.item} className="flex items-center justify-between py-1.5">
                    <span>{t(`app.check.${c.item}`)}</span>
                    <Badge tone={c.received ? "green" : "amber"}>{c.received ? t("app.received") : t("app.missing")}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {manage && (
            <Card title={t("app.reviewNotes")}>
              <ActionForm action={updateReviewNotesAction}>
                <input type="hidden" name="id" value={app.id} />
                <Textarea label={t("app.reviewNotes")} name="reviewNotes" defaultValue={app.reviewNotes} maxLength={8000} hint={t("app.reviewNotesHint")} />
                <SubmitButton variant="secondary">{t("app.saveReviewNotes")}</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card title={t("app.timeline")}>
            {events.length === 0 ? (
              <p className="text-sm text-slate-500">{t("app.noTimeline")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {events.map((e) => {
                  const reason = reasonOf(e.metadata);
                  return (
                    <li key={e.id} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{eventLabel(e.action)}</span>
                        <span className="text-xs text-slate-500">{formatDateTime(e.createdAt, df)}{e.actorName ? ` · ${e.actorName}` : ""}</span>
                      </div>
                      {reason && <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{reason}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {anyAction && (
            <Card title={t("app.actions")}>
              <div className="space-y-4">
                {canStart && <InlineAction action={startReviewAction} label={t("app.startReview")} variant="primary" hidden={{ id: app.id }} />}
                {canToggleFee && (
                  <InlineAction
                    action={toggleReservationPaidAction}
                    label={app.reservationPaid ? t("app.unmarkReservationPaid") : t("app.markReservationPaid")}
                    hidden={{ id: app.id, paid: app.reservationPaid ? "false" : "true" }}
                  />
                )}
                {canApprove && (
                  <ActionForm action={approveApplicationAction} confirm={t("app.approveConfirm")}>
                    <input type="hidden" name="id" value={app.id} />
                    <Textarea label={t("app.decisionNote")} name="reason" maxLength={2000} rows={2} />
                    <SubmitButton>{t("app.approve")}</SubmitButton>
                  </ActionForm>
                )}
                {canConvert && (
                  <ActionForm action={convertApplicationAction} confirm={t("app.convertConfirm")}>
                    <input type="hidden" name="id" value={app.id} />
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t("app.convertHint")}</p>
                    <Select
                      label={t("app.convertUnit")}
                      name="unitId"
                      required
                      defaultValue={app.unitId ?? ""}
                      placeholder={t("common.none")}
                      options={units.map((u) => ({ value: u.id, label: `${u.label} — ${t(`unit.status.${u.status}`)}` }))}
                    />
                    <SubmitButton>{t("app.convert")}</SubmitButton>
                  </ActionForm>
                )}
                {canReject && (
                  <ActionForm action={rejectApplicationAction}>
                    <input type="hidden" name="id" value={app.id} />
                    <Textarea label={t("app.rejectReason")} name="reason" required minLength={5} maxLength={2000} rows={2} hint={t("app.rejectReasonHint")} />
                    <SubmitButton variant="danger">{t("app.reject")}</SubmitButton>
                  </ActionForm>
                )}
                {canWithdraw && (
                  <ActionForm action={withdrawApplicationAction} confirm={t("app.withdrawConfirm")}>
                    <input type="hidden" name="id" value={app.id} />
                    <Textarea label={t("app.withdrawReason")} name="reason" maxLength={2000} rows={2} />
                    <SubmitButton variant="secondary">{t("app.withdraw")}</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
