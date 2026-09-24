import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { InlineAction } from "@/components/forms";
import { Checkbox, FilterBar, PageHeader, Pagination, parsePage, str } from "@/components/ui";
import { NotificationList } from "@/components/portal/notification-list";
import { markAllNotificationsReadAction } from "@/app/(app)/notifications/actions";
import { portalPage } from "../kit";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

/** Keeps portal users inside the portal: staff links (e.g. /maintenance/<id>) are not reachable for them. */
function portalLink(link: string) {
  return link.startsWith("/portal/") ? link : null;
}

export default async function PortalNotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, t, df } = await portalPage();
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
        description={t("notif.subtitle")}
        actions={unreadCount > 0 && <InlineAction action={markAllNotificationsReadAction} label={t("notif.markAll")} />}
      />
      <FilterBar action="/portal/notifications">
        <Checkbox label={t("notif.unreadOnly")} name="unread" defaultChecked={unread} />
      </FilterBar>
      <NotificationList rows={rows} t={t} df={df} rewriteLink={portalLink} />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/portal/notifications" params={{ unread: unread ? "on" : undefined }} />
    </>
  );
}
