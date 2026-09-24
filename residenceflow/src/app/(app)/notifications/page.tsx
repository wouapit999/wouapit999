import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { InlineAction } from "@/components/forms";
import { Checkbox, FilterBar, PageHeader, Pagination, parsePage, str } from "@/components/ui";
import { NotificationList } from "@/components/portal/notification-list";
import { markAllNotificationsReadAction } from "./actions";
import { notificationMessages } from "./i18n";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const { t } = await getT(notificationMessages);
  const settings = await getOrgSettings(ctx.organizationId);
  const df = { dateFormat: settings?.dateFormat ?? "dd/MM/yyyy", timezone: settings?.timezone ?? "Africa/Douala" };
  const sp = await searchParams;
  const unread = str(sp.unread) === "on";
  const page = parsePage(sp.page);
  const where: Prisma.NotificationWhereInput = { userId: ctx.user.id, organizationId: ctx.organizationId, ...(unread ? { readAt: null } : {}) };
  const [total, rows, unreadCount] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.notification.count({ where: { userId: ctx.user.id, organizationId: ctx.organizationId, readAt: null } }),
  ]);
  return (
    <>
      <PageHeader
        title={t("notif.title")}
        description={`${t("notif.subtitle")} (${unreadCount} ${t("notif.unread").toLowerCase()})`}
        actions={unreadCount > 0 && <InlineAction action={markAllNotificationsReadAction} label={t("notif.markAll")} />}
      />
      <FilterBar action="/notifications">
        <Checkbox label={t("notif.unreadOnly")} name="unread" defaultChecked={unread} />
      </FilterBar>
      <NotificationList rows={rows} t={t} df={df} />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/notifications" params={{ unread: unread ? "on" : undefined }} />
    </>
  );
}
