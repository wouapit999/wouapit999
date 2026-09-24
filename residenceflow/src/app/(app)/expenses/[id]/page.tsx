import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { byPropertyWhere, can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Badge, Card, DescriptionList, Field, PageHeader } from "@/components/ui";
import { addExpenseAttachmentAction, approveExpenseAction, markExpensePaidAction, rejectExpenseAction } from "../actions";
import { docBelongsTo, expenseDocLabel, expenseDocsWhere } from "../constants";
import { expenseMessages } from "../messages";

export const metadata = { title: "Expense" };

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("expense.view");
  const { t, locale } = await getT(expenseMessages);
  const e = await db.expense.findFirst({
    where: { ...byPropertyWhere(ctx), id },
    include: {
      property: { select: { id: true, name: true } },
      unit: { select: { id: true, number: true } },
      vendor: { select: { id: true, name: true } },
      workOrder: { select: { id: true, number: true, title: true } },
      purchaseOrder: { select: { id: true, number: true, description: true, status: true } },
    },
  });
  if (!e) notFound();
  const settings = await getOrgSettings(ctx.organizationId);
  const userIds = [e.createdById, e.approvedById].filter((x): x is string => !!x);
  const [users, docs] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { organizationId: ctx.organizationId, id: { in: userIds } }, select: { id: true, name: true } }) : [],
    db.document.findMany({ where: expenseDocsWhere(ctx.organizationId, [e.id]), orderBy: { createdAt: "asc" }, select: { id: true, name: true, expenseId: true, size: true, createdAt: true } }),
  ]);
  const attachments = docs.filter((d) => docBelongsTo(e.id, d));
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const fmt = { locale, currency: e.currency || settings?.currency || "XAF" };
  const prefs = { dateFormat: settings?.dateFormat };
  const dt = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const canApprove = can(ctx, "expense.approve");
  const canCreate = can(ctx, "expense.create");

  return (
    <>
      <PageHeader
        title={e.description}
        description={`${t(`exp.cat.${e.category}`)} · ${formatMoney(e.amount, fmt)}`}
        breadcrumbs={[{ label: t("exp.title"), href: "/expenses" }, { label: t("exp.detail") }]}
        actions={<Badge status={e.status}>{t(`exp.status.${e.status}`)}</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t("exp.detail")}>
            <DescriptionList
              items={[
                { label: t("common.amount"), value: formatMoney(e.amount, fmt) },
                { label: t("exp.date"), value: formatDay(e.expenseDate, prefs) },
                { label: t("exp.category"), value: t(`exp.cat.${e.category}`) },
                { label: t("common.status"), value: <Badge status={e.status}>{t(`exp.status.${e.status}`)}</Badge> },
                { label: t("common.building"), value: e.property ? <Link className="hover:underline" href={`/properties/${e.property.id}`}>{e.property.name}</Link> : t("exp.orgWide") },
                { label: t("common.unit"), value: e.unit ? <Link className="hover:underline" href={`/units/${e.unit.id}`}>{e.unit.number}</Link> : "—" },
                { label: t("exp.vendor"), value: e.vendor ? <Link className="hover:underline" href={`/vendors/${e.vendor.id}`}>{e.vendor.name}</Link> : "—" },
                { label: t("exp.workOrder"), value: e.workOrder ? <Link className="hover:underline" href={`/maintenance/${e.workOrder.id}`}>{e.workOrder.number} — {e.workOrder.title}</Link> : "—" },
                { label: t("exp.purchaseOrder"), value: e.purchaseOrder ? <Link className="hover:underline" href={`/purchase-orders/${e.purchaseOrder.id}`}>{e.purchaseOrder.number} — {e.purchaseOrder.description}</Link> : "—" },
                { label: t("exp.billReference"), value: e.billReference || "—" },
                { label: t("exp.recurrence"), value: t(`exp.rec.${e.recurrence}`) },
                { label: t("exp.nextOccurrence"), value: e.nextOccurrence ? formatDay(e.nextOccurrence, prefs) : "—" },
                { label: t("exp.createdBy"), value: nameOf(e.createdById) },
                { label: t("exp.approvedBy"), value: nameOf(e.approvedById) },
                { label: t("exp.recordedOn"), value: formatDateTime(e.createdAt, dt) },
                { label: t("exp.currency"), value: e.currency },
              ]}
            />
          </Card>
          <Card title={t("exp.attachments")}>
            {attachments.length === 0 ? (
              <p className="text-sm text-slate-500">{t("exp.noAttachments")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {attachments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <a className="text-[var(--brand)] hover:underline" href={`/api/documents/${a.id}`}>📎 {expenseDocLabel(e.id, a.name)}</a>
                    <span className="text-xs text-slate-500">{Math.max(1, Math.round(a.size / 1024))} KB · {formatDay(a.createdAt, prefs)}</span>
                  </li>
                ))}
              </ul>
            )}
            {canCreate && (
              <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                <ActionForm action={addExpenseAttachmentAction} resetOnSuccess>
                  <input type="hidden" name="id" value={e.id} />
                  <Field label={t("exp.addAttachment")} name="attachment" hint={t("exp.attachmentHint")}>
                    <input id="attachment" name="attachment" type="file" required accept="application/pdf,image/png,image/jpeg,image/webp" className="block w-full text-sm" />
                  </Field>
                  <SubmitButton variant="secondary">{t("exp.addAttachment")}</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          {canApprove && (e.status === "PENDING_APPROVAL" || e.status === "APPROVED") && (
            <Card title={t("common.actions")}>
              {e.status === "PENDING_APPROVAL" && <p className="mb-3 text-xs text-slate-500">{t("exp.approvalHint", { amount: formatMoney(settings?.expenseApprovalThreshold ?? 0, fmt) })}</p>}
              <div className="flex flex-wrap gap-2">
                {e.status === "PENDING_APPROVAL" && (
                  <>
                    <InlineAction action={approveExpenseAction} label={t("exp.approve")} variant="primary" hidden={{ id: e.id }} />
                    <InlineAction action={rejectExpenseAction} label={t("exp.reject")} variant="danger" confirm={t("exp.rejectConfirm")} hidden={{ id: e.id }} />
                  </>
                )}
                {e.status === "APPROVED" && <InlineAction action={markExpensePaidAction} label={t("exp.markPaid")} confirm={t("exp.paidConfirm")} hidden={{ id: e.id }} />}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
