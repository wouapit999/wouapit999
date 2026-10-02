import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { byPropertyWhere, can, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay, formatMoney } from "@/lib/format";
import { Badge, EmptyState, FilterBar, LinkButton, PageHeader, Pagination, Select, Stat, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { PO_STATUSES } from "./constants";
import { purchaseOrderMessages } from "./messages";

export const metadata = { title: "Purchase orders" };
const PAGE_SIZE = 25;

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("expense.view");
  const { t, locale } = await getT(purchaseOrderMessages);
  const sp = await searchParams;
  const status = (PO_STATUSES as readonly string[]).includes(str(sp.status)) ? str(sp.status) : "";
  const propertyId = str(sp.propertyId);
  const page = parsePage(sp.page);
  const base: Prisma.PurchaseOrderWhereInput = { AND: [byPropertyWhere(ctx), propertyId ? { propertyId: propertyId === "none" ? null : propertyId } : {}] };
  const where: Prisma.PurchaseOrderWhereInput = status ? { AND: [base, { status }] } : base;

  const [total, rows, byStatus, buildings, settings] = await Promise.all([
    db.purchaseOrder.count({ where }),
    db.purchaseOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { vendor: { select: { id: true, name: true } }, _count: { select: { expenses: true } } } }),
    db.purchaseOrder.groupBy({ by: ["status"], where: base, _sum: { amount: true } }),
    db.property.findMany({ where: propertyWhere(ctx), orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getOrgSettings(ctx.organizationId),
  ]);
  const propertyIds = [...new Set(rows.map((r) => r.propertyId).filter((x): x is string => !!x))];
  const requesterIds = [...new Set(rows.map((r) => r.requestedById).filter((x): x is string => !!x))];
  const [properties, users] = await Promise.all([
    propertyIds.length ? db.property.findMany({ where: { organizationId: ctx.organizationId, id: { in: propertyIds } }, select: { id: true, name: true } }) : [],
    requesterIds.length ? db.user.findMany({ where: { organizationId: ctx.organizationId, id: { in: requesterIds } }, select: { id: true, name: true } }) : [],
  ]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const prefs = { dateFormat: settings?.dateFormat };
  const sumFor = (...s: string[]) => byStatus.filter((b) => s.includes(b.status)).reduce((a, b) => a + Number(b._sum.amount ?? 0), 0);
  const canApprove = can(ctx, "expense.approve");

  return (
    <>
      <PageHeader title={t("po.title")} description={t("po.subtitle")} actions={can(ctx, "expense.create") && <LinkButton href="/purchase-orders/new">{t("po.new")}</LinkButton>} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t("po.totalOpen")} value={formatMoney(sumFor("REQUESTED"), fmt)} tone="warn" />
        <Stat label={t("po.totalApproved")} value={formatMoney(sumFor("APPROVED", "ORDERED"), fmt)} />
        <Stat label={t("po.totalReceived")} value={formatMoney(sumFor("RECEIVED"), fmt)} tone="good" />
      </div>
      <FilterBar action="/purchase-orders">
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={PO_STATUSES.map((v) => ({ value: v, label: t(`po.status.${v}`) }))} wrapperClassName="w-44" />
        <Select
          label={t("common.building")}
          name="propertyId"
          defaultValue={propertyId}
          placeholder={t("common.all")}
          options={[...buildings.map((b) => ({ value: b.id, label: b.name })), ...(ctx.propertyIds === "ALL" ? [{ value: "none", label: t("po.orgWide") }] : [])]}
          wrapperClassName="w-48"
        />
      </FilterBar>
      {canApprove && <p className="mb-3 text-xs text-slate-500">{t("po.approvalHint", { amount: formatMoney(settings?.expenseApprovalThreshold ?? 0, fmt) })}</p>}
      {rows.length === 0 ? (
        <EmptyState title={t("po.empty")} description={t("po.emptyHint")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("po.number")}</Th>
              <Th>{t("po.description")}</Th>
              <Th>{t("common.building")}</Th>
              <Th>{t("po.vendor")}</Th>
              <Th className="text-right">{t("common.amount")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("po.createdAt")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((po) => (
              <Tr key={po.id}>
                <Td className="whitespace-nowrap">
                  <Link className="font-medium text-[var(--brand)] hover:underline" href={`/purchase-orders/${po.id}`}>{po.number}</Link>
                </Td>
                <Td>
                  <span className="font-medium">{po.description}</span>
                  <div className="text-xs text-slate-500">
                    {t("po.requestedBy")}: {users.find((u) => u.id === po.requestedById)?.name ?? "—"}
                    {po._count.expenses > 0 && ` · ${t("po.expenses")}: ${po._count.expenses}`}
                  </div>
                </Td>
                <Td>{po.propertyId ? properties.find((p) => p.id === po.propertyId)?.name ?? "—" : t("po.orgWide")}</Td>
                <Td>{po.vendor ? <Link className="hover:underline" href={`/vendors/${po.vendor.id}`}>{po.vendor.name}</Link> : "—"}</Td>
                <Td className="text-right whitespace-nowrap">{formatMoney(po.amount, fmt)}</Td>
                <Td><Badge status={po.status === "REQUESTED" ? "PENDING_APPROVAL" : po.status === "ORDERED" ? "IN_PROGRESS" : po.status === "RECEIVED" ? "COMPLETED" : po.status}>{t(`po.status.${po.status}`)}</Badge></Td>
                <Td className="whitespace-nowrap">{formatDay(po.createdAt, prefs)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/purchase-orders" params={{ status, propertyId }} />
    </>
  );
}
