import Link from "next/link";
import { db } from "@/lib/db";
import { formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { invoiceBalance, tenantBalance } from "@/services/billing";
import { OPEN_WO, currentLease, tenantAnnouncementWhere, tenantPropertyIds } from "@/services/portal";
import { Alert, Badge, Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { portalPage } from "../kit";

export const metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function PortalHomePage() {
  const { ctx, tenantId, t, fmt, df, occupant } = await portalPage();
  const org = ctx.organizationId;

  const [tenant, lease, propertyIds, openRequests, notifications, unreadMessages] = await Promise.all([
    db.tenant.findFirst({ where: { id: tenantId, organizationId: org }, select: { legalName: true, preferredName: true } }),
    currentLease(org, tenantId),
    tenantPropertyIds(org, tenantId),
    db.maintenanceRequest.findMany({
      where: { organizationId: org, tenantId, status: { in: [...OPEN_WO, "COMPLETED", "TENANT_CONFIRMATION"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, number: true, title: true, status: true, createdAt: true },
    }),
    db.notification.findMany({
      where: { organizationId: org, userId: ctx.user.id, readAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.message.count({ where: { organizationId: org, tenantId, fromTenant: false, readAt: null } }),
  ]);
  const announcements = await db.announcement.findMany({
    where: tenantAnnouncementWhere(org, propertyIds),
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take: 5,
    include: { property: { select: { name: true } } },
  });

  const balance = occupant ? null : await tenantBalance(tenantId);
  const nextDue = balance
    ? [...balance.invoices].filter((i) => i.organizationId === org).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0]
    : undefined;
  const awaitingConfirmation = openRequests.filter((r) => r.status === "COMPLETED" || r.status === "TENANT_CONFIRMATION");
  const name = tenant?.preferredName || tenant?.legalName || ctx.user.name;

  return (
    <>
      <PageHeader
        title={t("portal.home.hello", { name })}
        description={lease ? `${lease.unit.property.name} · ${t("common.unit")} ${lease.unit.number}` : t("portal.home.noLease")}
      />
      {awaitingConfirmation.length > 0 && (
        <div className="mb-4">
          <Alert tone="info">
            {t("portal.home.awaitingConfirm", { n: awaitingConfirmation.length })}{" "}
            <Link className="font-medium underline" href={`/portal/maintenance/${awaitingConfirmation[0].id}`}>{t("common.view")}</Link>
          </Alert>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {balance && (
          <Stat
            label={t("portal.home.balance")}
            value={formatMoney(balance.net.isNegative() ? 0 : balance.net, fmt)}
            tone={balance.invoices.some((i) => i.status === "OVERDUE") ? "bad" : balance.net.gt(0) ? "warn" : "good"}
            hint={balance.credit.gt(0) ? t("portal.home.credit", { amount: formatMoney(balance.credit, fmt) }) : undefined}
            href="/portal/billing"
          />
        )}
        {balance && (
          <Stat
            label={t("portal.home.nextDue")}
            value={nextDue ? formatMoney(invoiceBalance(nextDue), fmt) : "—"}
            hint={nextDue ? `${nextDue.number} · ${t("portal.bill.due")} ${formatDay(nextDue.dueDate, df)}` : t("portal.home.nothingDue")}
            tone={nextDue?.status === "OVERDUE" ? "bad" : "default"}
            href={nextDue ? `/portal/billing/${nextDue.id}` : "/portal/billing"}
          />
        )}
        <Stat label={t("portal.home.openRequests")} value={openRequests.length} href="/portal/maintenance" />
        <Stat label={t("portal.home.unreadMessages")} value={unreadMessages} tone={unreadMessages > 0 ? "warn" : "default"} href="/portal/messages" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <LinkButton href="/portal/maintenance/new">{t("portal.mnt.new")}</LinkButton>
        {!occupant && <LinkButton variant="secondary" href="/portal/payments#submit">{t("portal.pay.submitProof")}</LinkButton>}
        <LinkButton variant="secondary" href="/portal/messages">{t("portal.msg.contact")}</LinkButton>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title={t("portal.home.announcements")}>
          {announcements.length === 0 ? (
            <p className="text-sm text-slate-500">{t("portal.home.noAnnouncements")}</p>
          ) : (
            <ul className="space-y-4">
              {announcements.map((a) => (
                <li key={a.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-slate-900 dark:text-white">{a.title}</h3>
                    {a.pinned && <Badge tone="violet">{t("portal.home.pinned")}</Badge>}
                  </div>
                  <p className="text-xs text-slate-500">{formatDateTime(a.publishedAt, df)} · {a.property?.name ?? t("portal.home.allBuildings")}</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{a.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card title={t("common.notifications")} actions={<Link className="text-sm text-[var(--brand)] hover:underline" href="/portal/notifications">{t("portal.home.seeAll")}</Link>}>
            {notifications.length === 0 ? (
              <p className="text-sm text-slate-500">{t("notif.none")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {notifications.map((n) => (
                  <li key={n.id} className="py-2">
                    <div className="text-sm font-medium">{n.link?.startsWith("/portal/") ? <Link className="hover:underline" href={n.link}>{n.title}</Link> : n.title}</div>
                    <div className="text-xs text-slate-500">{n.body} · {formatDateTime(n.createdAt, df)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t("portal.home.myRequests")} actions={<Link className="text-sm text-[var(--brand)] hover:underline" href="/portal/maintenance">{t("portal.home.seeAll")}</Link>}>
            {openRequests.length === 0 ? (
              <EmptyState title={t("portal.mnt.noneOpen")} />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {openRequests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/portal/maintenance/${r.id}`} className="min-w-0 text-sm hover:underline">
                      <span className="font-mono text-xs text-slate-500">{r.number}</span> <span className="font-medium">{r.title}</span>
                    </Link>
                    <Badge status={r.status}>{t(`portal.wo.${r.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
