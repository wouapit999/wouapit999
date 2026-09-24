import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { byPropertyWhere, can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { money, sum } from "@/lib/money";
import { InlineAction } from "@/components/forms";
import { Badge, Card, DescriptionList, LinkButton, PageHeader, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { approvePurchaseOrderAction, cancelPurchaseOrderAction, orderPurchaseOrderAction, receivePurchaseOrderAction, rejectPurchaseOrderAction } from "../actions";
import { PO_EXPENSABLE_STATUSES, PO_TRANSITIONS, type PoStatus } from "../constants";
import { purchaseOrderMessages } from "../messages";
import { expenseMessages } from "../../expenses/messages";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("expense.view");
  const { t, locale } = await getT(purchaseOrderMessages, expenseMessages);
  const po = await db.purchaseOrder.findFirst({
    where: { ...byPropertyWhere(ctx), id },
    include: { vendor: { select: { id: true, name: true } }, expenses: { orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }], select: { id: true, description: true, amount: true, expenseDate: true, status: true, category: true } } },
  });
  if (!po) notFound();
  const settings = await getOrgSettings(ctx.organizationId);
  const userIds = [po.requestedById, po.approvedById].filter((x): x is string => !!x);
  const [users, property] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { organizationId: ctx.organizationId, id: { in: userIds } }, select: { id: true, name: true } }) : [],
    po.propertyId ? db.property.findFirst({ where: { organizationId: ctx.organizationId, id: po.propertyId }, select: { id: true, name: true } }) : null,
  ]);
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const prefs = { dateFormat: settings?.dateFormat };
  const dt = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const status = po.status as PoStatus;
  const next = PO_TRANSITIONS[status] ?? [];
  const canApprove = can(ctx, "expense.approve");
  const expensed = sum(po.expenses.filter((e) => e.status !== "REJECTED").map((e) => e.amount));
  const remaining = money(po.amount).minus(expensed);
  const badgeStatus = status === "REQUESTED" ? "PENDING_APPROVAL" : status === "ORDERED" ? "IN_PROGRESS" : status === "RECEIVED" ? "COMPLETED" : status;

  return (
    <>
      <PageHeader
        title={`${po.number}`}
        description={po.description}
        breadcrumbs={[{ label: t("po.title"), href: "/purchase-orders" }, { label: po.number }]}
        actions={
          <>
            <Badge status={badgeStatus}>{t(`po.status.${po.status}`)}</Badge>
            {can(ctx, "expense.create") && PO_EXPENSABLE_STATUSES.includes(status) && <LinkButton href={`/expenses/new?purchaseOrderId=${po.id}`}>{t("po.createExpense")}</LinkButton>}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t("common.amount")} value={formatMoney(po.amount, fmt)} />
        <Stat label={t("po.expensed")} value={formatMoney(expensed, fmt)} />
        <Stat label={t("po.remaining")} value={formatMoney(remaining, fmt)} tone={remaining.isNegative() ? "bad" : "default"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t("po.title")}>
            <DescriptionList
              items={[
                { label: t("po.number"), value: po.number },
                { label: t("common.building"), value: property ? <Link className="hover:underline" href={`/properties/${property.id}`}>{property.name}</Link> : t("po.orgWide") },
                { label: t("po.vendor"), value: po.vendor ? <Link className="hover:underline" href={`/vendors/${po.vendor.id}`}>{po.vendor.name}</Link> : "—" },
                { label: t("common.amount"), value: formatMoney(po.amount, fmt) },
                { label: t("po.requestedBy"), value: nameOf(po.requestedById) },
                { label: t("po.approvedBy"), value: nameOf(po.approvedById) },
                { label: t("po.createdAt"), value: formatDateTime(po.createdAt, dt) },
                { label: t("po.justification"), value: po.justification ? <span className="whitespace-pre-wrap">{po.justification}</span> : "—" },
              ]}
            />
          </Card>
          <Card title={t("po.expenses")}>
            {po.expenses.length === 0 ? (
              <p className="text-sm text-slate-500">{t("po.noExpenses")}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("common.date")}</Th>
                    <Th>{t("po.description")}</Th>
                    <Th className="text-right">{t("common.amount")}</Th>
                    <Th>{t("common.status")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {po.expenses.map((e) => (
                    <Tr key={e.id}>
                      <Td className="whitespace-nowrap">{formatDay(e.expenseDate, prefs)}</Td>
                      <Td>
                        <Link className="font-medium text-[var(--brand)] hover:underline" href={`/expenses/${e.id}`}>{e.description}</Link>
                        <div className="text-xs text-slate-500">{t(`exp.cat.${e.category}`)}</div>
                      </Td>
                      <Td className="text-right whitespace-nowrap">{formatMoney(e.amount, fmt)}</Td>
                      <Td><Badge status={e.status}>{t(`exp.status.${e.status}`)}</Badge></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          {canApprove && next.length > 0 && (
            <Card title={t("common.actions")}>
              {status === "REQUESTED" && <p className="mb-3 text-xs text-slate-500">{t("po.approvalHint", { amount: formatMoney(settings?.expenseApprovalThreshold ?? 0, fmt) })}</p>}
              <div className="flex flex-wrap gap-2">
                {next.includes("APPROVED") && <InlineAction action={approvePurchaseOrderAction} label={t("po.approve")} variant="primary" hidden={{ id: po.id }} />}
                {next.includes("REJECTED") && <InlineAction action={rejectPurchaseOrderAction} label={t("po.reject")} variant="danger" confirm={t("po.rejectConfirm")} hidden={{ id: po.id }} />}
                {next.includes("ORDERED") && <InlineAction action={orderPurchaseOrderAction} label={t("po.order")} variant="primary" hidden={{ id: po.id }} />}
                {next.includes("RECEIVED") && <InlineAction action={receivePurchaseOrderAction} label={t("po.receive")} variant="primary" confirm={t("po.receiveConfirm")} hidden={{ id: po.id }} />}
                {next.includes("CANCELLED") && <InlineAction action={cancelPurchaseOrderAction} label={t("po.cancel")} variant="danger" confirm={t("po.cancelConfirm")} hidden={{ id: po.id }} />}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
