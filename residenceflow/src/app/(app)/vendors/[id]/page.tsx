import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { byPropertyWhere, can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { sum } from "@/lib/money";
import { InlineAction } from "@/components/forms";
import { Badge, Card, DescriptionList, EmptyState, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { maintenanceMessages } from "../../maintenance/messages";
import { deactivateVendorAction, reactivateVendorAction } from "../actions";
import { vendorMessages } from "../messages";
import { vendorCategoryLabel } from "../vendor-form";

export const metadata = { title: "Vendor" };

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("vendor.view");
  const { t, locale } = await getT(vendorMessages, maintenanceMessages);
  const vendor = await db.vendor.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!vendor) notFound();
  const showWork = can(ctx, "maintenance.view");
  const showExpenses = can(ctx, "expense.view");
  const [settings, workOrders, expenses, users] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    showWork
      ? db.maintenanceRequest.findMany({
          where: { ...byPropertyWhere(ctx), vendorId: id },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { property: { select: { name: true } }, unit: { select: { number: true } } },
        })
      : [],
    showExpenses ? db.expense.findMany({ where: { ...byPropertyWhere(ctx), vendorId: id }, orderBy: { expenseDate: "desc" }, take: 50 }) : [],
    can(ctx, "users.view") ? db.user.findMany({ where: { vendorId: id, organizationId: ctx.organizationId }, select: { id: true, name: true, email: true, status: true } }) : [],
  ]);
  const prefs = { timezone: settings?.timezone ?? "Africa/Douala", dateFormat: settings?.dateFormat };
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const manage = can(ctx, "vendor.manage");

  return (
    <>
      <PageHeader
        title={vendor.name}
        description={vendorCategoryLabel(t, vendor.category)}
        breadcrumbs={[{ label: t("ven.title"), href: "/vendors" }, { label: vendor.name }]}
        actions={
          manage && (
            <>
              <LinkButton variant="secondary" href={`/vendors/${id}/edit`}>{t("common.edit")}</LinkButton>
              {vendor.status === "ACTIVE" ? (
                <InlineAction action={deactivateVendorAction} label={t("ven.deactivate")} variant="danger" confirm={t("ven.deactivateConfirm")} hidden={{ id }} />
              ) : (
                <InlineAction action={reactivateVendorAction} label={t("ven.reactivate")} hidden={{ id }} />
              )}
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {showWork && (
            <Card title={t("ven.workOrders")}>
              {workOrders.length === 0 ? (
                <EmptyState title={t("common.empty")} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("wo.number")}</Th>
                      <Th>{t("wo.requestTitle")}</Th>
                      <Th>{t("common.building")}</Th>
                      <Th>{t("common.date")}</Th>
                      <Th>{t("common.status")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {workOrders.map((w) => (
                      <Tr key={w.id}>
                        <Td className="font-mono text-xs"><Link className="text-[var(--brand)] hover:underline" href={`/maintenance/${w.id}`}>{w.number}</Link></Td>
                        <Td>{w.title}</Td>
                        <Td>{w.property.name}{w.unit ? ` · ${w.unit.number}` : ""}</Td>
                        <Td>{formatDateTime(w.createdAt, prefs)}</Td>
                        <Td><Badge status={w.status}>{t(`wo.status.${w.status}`)}</Badge></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
          {showExpenses && (
            <Card title={t("ven.expenses")} actions={<span className="text-sm font-medium">{t("common.total")}: {formatMoney(sum(expenses.filter((e) => e.status !== "REJECTED").map((e) => e.amount)), fmt)}</span>}>
              {expenses.length === 0 ? (
                <EmptyState title={t("common.empty")} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("common.date")}</Th>
                      <Th>{t("wo.description")}</Th>
                      <Th>{t("common.amount")}</Th>
                      <Th>{t("common.status")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {expenses.map((e) => (
                      <Tr key={e.id}>
                        <Td>{formatDay(e.expenseDate, prefs)}</Td>
                        <Td>{e.description}</Td>
                        <Td>{formatMoney(e.amount, fmt)}</Td>
                        <Td><Badge status={e.status} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title={t("wo.details")}>
            <DescriptionList
              items={[
                { label: t("common.status"), value: <Badge status={vendor.status}>{t(`ven.status.${vendor.status}`)}</Badge> },
                { label: t("ven.contactName"), value: vendor.contactName },
                { label: t("common.phone"), value: vendor.phone ? <a className="text-[var(--brand)] hover:underline" href={`tel:${vendor.phone.replace(/\s+/g, "")}`}>{vendor.phone}</a> : null },
                { label: t("common.email"), value: vendor.email },
                { label: t("ven.taxId"), value: vendor.taxId },
              ]}
            />
            {vendor.notes && <p className="mt-4 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">{vendor.notes}</p>}
          </Card>
          {users.length > 0 && (
            <Card title={t("ven.users")}>
              <ul className="space-y-1 text-sm">
                {users.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2">
                    <span>{u.name} <span className="block text-xs text-slate-500">{u.email}</span></span>
                    <Badge status={u.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
