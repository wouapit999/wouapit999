import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { byPropertyWhere, can, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay, formatMoney } from "@/lib/format";
import { InlineAction } from "@/components/forms";
import { Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Stat, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { approveExpenseAction, markExpensePaidAction, rejectExpenseAction } from "./actions";
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES, expenseDocPrefix } from "./constants";
import { expenseMessages } from "./messages";

export const metadata = { title: "Expenses" };
const PAGE_SIZE = 25;
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("expense.view");
  const { t, locale } = await getT(expenseMessages);
  const sp = await searchParams;
  const status = (EXPENSE_STATUSES as readonly string[]).includes(str(sp.status)) ? str(sp.status) : "";
  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(str(sp.category)) ? str(sp.category) : "";
  const propertyId = str(sp.propertyId);
  const from = isDay(str(sp.from)) ? str(sp.from) : "";
  const to = isDay(str(sp.to)) ? str(sp.to) : "";
  const page = parsePage(sp.page);

  const base: Prisma.ExpenseWhereInput = {
    AND: [
      byPropertyWhere(ctx),
      category ? { category } : {},
      propertyId ? { propertyId: propertyId === "none" ? null : propertyId } : {},
      from || to ? { expenseDate: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}) } } : {},
    ],
  };
  const where: Prisma.ExpenseWhereInput = status ? { AND: [base, { status }] } : base;

  const [total, rows, byStatus, buildings, settings] = await Promise.all([
    db.expense.count({ where }),
    db.expense.findMany({
      where,
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { property: { select: { name: true } }, unit: { select: { number: true } }, vendor: { select: { id: true, name: true } }, workOrder: { select: { id: true, number: true } } },
    }),
    db.expense.groupBy({ by: ["status"], where: base, _sum: { amount: true } }),
    db.property.findMany({ where: propertyWhere(ctx), orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getOrgSettings(ctx.organizationId),
  ]);
  const ids = rows.map((r) => r.id);
  const [creators, docs] = await Promise.all([
    db.user.findMany({ where: { organizationId: ctx.organizationId, id: { in: rows.map((r) => r.createdById).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    ids.length
      ? db.document.findMany({ where: { organizationId: ctx.organizationId, category: "OTHER", OR: ids.map((id) => ({ name: { startsWith: expenseDocPrefix(id) } })) }, select: { id: true, name: true } })
      : [],
  ]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const prefs = { dateFormat: settings?.dateFormat };
  const sumFor = (s: string) => byStatus.find((b) => b.status === s)?._sum.amount ?? 0;
  const canApprove = can(ctx, "expense.approve");
  const threshold = settings?.expenseApprovalThreshold ?? 0;
  const totalAll = byStatus.filter((b) => b.status !== "REJECTED").reduce((a, b) => a + Number(b._sum.amount ?? 0), 0);

  return (
    <>
      <PageHeader title={t("exp.title")} description={t("exp.subtitle")} actions={can(ctx, "expense.create") && <LinkButton href="/expenses/new">{t("exp.new")}</LinkButton>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("exp.totalFiltered")} value={formatMoney(totalAll, fmt)} />
        <Stat label={t("exp.totalPending")} value={formatMoney(sumFor("PENDING_APPROVAL"), fmt)} tone="warn" />
        <Stat label={t("exp.totalApproved")} value={formatMoney(sumFor("APPROVED"), fmt)} />
        <Stat label={t("exp.totalPaid")} value={formatMoney(sumFor("PAID"), fmt)} tone="good" />
      </div>
      <FilterBar action="/expenses">
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={EXPENSE_STATUSES.map((v) => ({ value: v, label: t(`exp.status.${v}`) }))} wrapperClassName="w-44" />
        <Select label={t("exp.category")} name="category" defaultValue={category} placeholder={t("common.all")} options={EXPENSE_CATEGORIES.map((v) => ({ value: v, label: t(`exp.cat.${v}`) }))} wrapperClassName="w-48" />
        <Select
          label={t("common.building")}
          name="propertyId"
          defaultValue={propertyId}
          placeholder={t("common.all")}
          options={[...buildings.map((b) => ({ value: b.id, label: b.name })), ...(ctx.propertyIds === "ALL" ? [{ value: "none", label: t("exp.orgWide") }] : [])]}
          wrapperClassName="w-48"
        />
        <Input label={t("exp.from")} name="from" type="date" defaultValue={from} wrapperClassName="w-40" />
        <Input label={t("exp.to")} name="to" type="date" defaultValue={to} wrapperClassName="w-40" />
      </FilterBar>
      {canApprove && <p className="mb-3 text-xs text-slate-500">{t("exp.approvalHint", { amount: formatMoney(threshold, fmt) })}</p>}
      {rows.length === 0 ? (
        <EmptyState title={t("exp.empty")} description={t("exp.emptyHint")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("common.date")}</Th>
              <Th>{t("exp.description")}</Th>
              <Th>{t("common.building")}</Th>
              <Th>{t("exp.vendor")}</Th>
              <Th className="text-right">{t("common.amount")}</Th>
              <Th>{t("common.status")}</Th>
              {canApprove && <Th>{t("common.actions")}</Th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((e) => {
              const attachments = docs.filter((d) => d.name.startsWith(expenseDocPrefix(e.id)));
              return (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap">{formatDay(e.expenseDate, prefs)}</Td>
                  <Td>
                    <span className="font-medium">{e.description}</span>
                    <div className="text-xs text-slate-500">
                      {t(`exp.cat.${e.category}`)}
                      {e.billReference && ` · ${e.billReference}`}
                      {e.workOrder && (
                        <>
                          {" · "}
                          <Link className="text-[var(--brand)] hover:underline" href={`/maintenance/${e.workOrder.id}`}>{e.workOrder.number}</Link>
                        </>
                      )}
                      {" · "}
                      {t("exp.createdBy")}: {creators.find((c) => c.id === e.createdById)?.name ?? "—"}
                    </div>
                    {attachments.map((a) => (
                      <a key={a.id} className="block text-xs text-[var(--brand)] hover:underline" href={`/api/documents/${a.id}`}>📎 {a.name.slice(expenseDocPrefix(e.id).length)}</a>
                    ))}
                  </Td>
                  <Td>{e.property?.name ?? t("exp.orgWide")}{e.unit ? ` · ${e.unit.number}` : ""}</Td>
                  <Td>{e.vendor ? <Link className="hover:underline" href={`/vendors/${e.vendor.id}`}>{e.vendor.name}</Link> : "—"}</Td>
                  <Td className="text-right whitespace-nowrap">{formatMoney(e.amount, fmt)}</Td>
                  <Td><Badge status={e.status}>{t(`exp.status.${e.status}`)}</Badge></Td>
                  {canApprove && (
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {e.status === "PENDING_APPROVAL" && (
                          <>
                            <InlineAction action={approveExpenseAction} label={t("exp.approve")} variant="primary" hidden={{ id: e.id }} />
                            <InlineAction action={rejectExpenseAction} label={t("exp.reject")} variant="danger" confirm={t("exp.rejectConfirm")} hidden={{ id: e.id }} />
                          </>
                        )}
                        {e.status === "APPROVED" && <InlineAction action={markExpensePaidAction} label={t("exp.markPaid")} confirm={t("exp.paidConfirm")} hidden={{ id: e.id }} />}
                      </div>
                    </Td>
                  )}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/expenses" params={{ status, category, propertyId, from, to }} />
    </>
  );
}
