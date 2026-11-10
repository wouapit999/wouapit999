import type { Metadata } from 'next';
import Link from 'next/link';

import { ActionButton } from '@/components/admin/action-button';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { listNotifications } from '@/server/notifications';
import { STAFF_ROLES } from '@/server/rbac';

import { markAllNotificationsReadAction, markNotificationReadAction } from './actions';

export const metadata: Metadata = { title: 'Notifications' };

/** Maps links emitted by the services onto the back-office routes. */
function resolveHref(href: string | null): string | null {
  if (!href?.startsWith('/admin')) return null;
  return href
    .replace(/^\/admin\/aml\/cases\//, '/admin/compliance/cases/')
    .replace(/^\/admin\/aml(\/|$)/, '/admin/compliance$1');
}

/** The signed-in staff member's own in-app notifications. */
export default async function NotificationsPage() {
  const { ctx } = await getPageContext(...STAFF_ROLES);
  const notifications = await listNotifications(ctx, { limit: 100 });
  const unread = notifications.filter((notification) => notification.readAt === null).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Work routed to your role: KYC cases to review, held transfers, partner applications."
        actions={
          unread > 0 ? (
            <ActionButton action={markAllNotificationsReadAction} showSuccess>
              Mark all as read
            </ActionButton>
          ) : undefined
        }
      />
      <Card>
        {notifications.length === 0 ? (
          <EmptyState
            title="No notification"
            description="You will be told here when something needs your attention."
          />
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((notification) => {
              const href = resolveHref(notification.href);
              const isUnread = notification.readAt === null;
              return (
                <li
                  key={notification.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 sm:px-6"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                      {isUnread ? <Badge tone="gold">New</Badge> : null}
                      {href ? (
                        <Link href={href} className="underline-offset-2 hover:underline">
                          {notification.title}
                        </Link>
                      ) : (
                        notification.title
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-fg-muted">{notification.body}</p>
                    <p
                      className="mt-1 text-xs text-fg-subtle"
                      title={formatDateTime(notification.createdAt)}
                    >
                      {formatRelative(notification.createdAt)}
                    </p>
                  </div>
                  {isUnread ? (
                    <ActionButton
                      action={markNotificationReadAction}
                      fields={{ id: notification.id }}
                      variant="ghost"
                    >
                      Mark as read<span className="sr-only">: {notification.title}</span>
                    </ActionButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
