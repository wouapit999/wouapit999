import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Badge, Card, DescriptionList, LinkButton, PageHeader, Select, Stat, Table, Td, Textarea, Th, Tr } from "@/components/ui";
import { planProgress } from "@/domain/payment-plan";
import { closePlanAction, refreshPlanAction } from "../actions";
import { loadScopedPlan } from "../data";
import { CLOSE_STATUSES, paymentPlanMessages } from "../messages";

export const metadata = { title: "Payment plan" };

export default async function PaymentPlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("arrears.view");
  const { t, locale } = await getT(paymentPlanMessages);
  const plan = await loadScopedPlan(ctx, id);
  if (!plan) notFound();
  const [settings, creator] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    plan.createdById ? db.user.findFirst({ where: { id: plan.createdById, organizationId: ctx.organizationId }, select: { name: true } }) : Promise.resolve(null),
  ]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const manage = can(ctx, "arrears.manage");
  const prog = planProgress(plan.installments);
  const next = plan.status === "ACTIVE" ? plan.installments.find((i) => i.status !== "PAID") : undefined;
  const overdue = plan.installments.filter((i) => i.status === "OVERDUE").length;

  return (
    <>
      <PageHeader
        title={`${t("pp.plan")} · ${plan.tenant.legalName}`}
        description={[plan.tenant.reference, plan.tenant.phone, plan.tenant.email].filter(Boolean).join(" · ")}
        breadcrumbs={[{ label: t("pp.title"), href: "/payment-plans" }, { label: plan.tenant.legalName }]}
        actions={
          <>
            <Badge status={plan.status}>{t(`pp.status.${plan.status}`)}</Badge>
            <LinkButton variant="secondary" href={`/arrears/${plan.tenant.id}`}>{t("pp.outstanding")}</LinkButton>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("pp.totalAmount")} value={formatMoney(plan.totalAmount, fmt)} />
        <Stat label={t("pp.paid")} value={formatMoney(prog.paid, fmt)} tone={prog.complete ? "good" : "default"} />
        <Stat label={t("pp.remaining")} value={formatMoney(prog.remaining, fmt)} tone={prog.remaining.gt(0) ? (overdue > 0 ? "bad" : "warn") : "good"} />
        <Stat label={t("pp.nextDue")} value={next ? formatDay(next.dueDate, df) : "—"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("pp.progress")}>
            <div className="h-3 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuenow={prog.percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-[var(--brand)]" style={{ width: `${prog.percent}%` }} />
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {prog.percent}% · {plan.installments.filter((i) => i.status === "PAID").length}/{plan.installments.length} {t("pp.installments").toLowerCase()}
            </p>
          </Card>
          <Card title={t("pp.installments")}>
            <Table>
              <thead>
                <tr>
                  <Th>{t("pp.sequence")}</Th>
                  <Th>{t("pp.dueDate")}</Th>
                  <Th className="text-right">{t("pp.amount")}</Th>
                  <Th className="text-right">{t("pp.paid")}</Th>
                  <Th>{t("common.status")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {plan.installments.map((i) => (
                  <Tr key={i.id}>
                    <Td className="tabular-nums">{i.sequence}</Td>
                    <Td className="whitespace-nowrap">{formatDay(i.dueDate, df)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(i.amount, fmt)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(i.paidAmount, fmt)}</Td>
                    <Td><Badge status={i.status}>{t(`pp.inst.${i.status}`)}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title={t("pp.plan")}>
            <DescriptionList
              items={[
                { label: t("pp.tenant"), value: <Link className="text-[var(--brand)] hover:underline" href={`/arrears/${plan.tenant.id}`}>{plan.tenant.legalName}</Link> },
                { label: t("common.status"), value: <Badge status={plan.status}>{t(`pp.status.${plan.status}`)}</Badge> },
                { label: t("pp.created"), value: formatDateTime(plan.createdAt, df) },
                { label: t("pp.createdBy"), value: creator?.name },
              ]}
            />
            {plan.notes && <p className="mt-4 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{plan.notes}</p>}
          </Card>
          {manage && plan.status === "ACTIVE" && (
            <Card title={t("common.actions")}>
              <div className="space-y-4">
                <div>
                  <InlineAction action={refreshPlanAction} label={t("pp.refresh")} variant="primary" hidden={{ id: plan.id }} />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("pp.refreshHint")}</p>
                </div>
                <ActionForm action={closePlanAction} dict={{ "Please correct the highlighted fields.": t("pp.fixFields") }}>
                  <input type="hidden" name="id" value={plan.id} />
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t("pp.closeHint")}</p>
                  <Select label={t("pp.closeStatus")} name="status" defaultValue="DEFAULTED" options={CLOSE_STATUSES.map((s) => ({ value: s, label: t(`pp.status.${s}`) }))} />
                  <Textarea label={t("pp.closeReason")} name="reason" required minLength={5} maxLength={2000} rows={2} />
                  <SubmitButton variant="danger">{t("pp.close")}</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
