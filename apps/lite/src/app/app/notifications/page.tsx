import type { Metadata } from 'next';
import Link from 'next/link';

import {
  ActionForm,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  FormMessage,
  LinkButton,
  PageHeader,
  SubmitButton,
} from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { countUnreadNotifications, listNotifications } from '@/server/notifications';

import { type SearchParams, readSearchParams } from '../_lib/page';
import { markAllNotificationsReadAction, markNotificationReadAction } from './actions';

export const metadata: Metadata = { title: 'Notifications' };

const LIMIT = 100;

/** Only in-app paths of the customer area are rendered as links. */
const safeHref = (href: string | null): string | null =>
  href && /^\/app(\/[A-Za-z0-9/_-]*)?$/.test(href) ? href : null;

/** In-app notifications: everything the platform told the customer, newest first. */
export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx } = await getPageContext('CUSTOMER');
  const unreadOnly = (await readSearchParams(searchParams)).filter === 'unread';
  const [notifications, unread] = await Promise.all([
    listNotifications(ctx, { unreadOnly, limit: LIMIT }),
    countUnreadNotifications(ctx),
  ]);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Updates about your transfers, verification and account security. In-app only: BI-Rem Lite does not send SMS or e-mail."
      />

      <Card>
        <CardHeader
          title={unreadOnly ? 'Unread' : 'All notifications'}
          description={unread === 0 ? 'You are all caught up.' : `${unread} unread`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <LinkButton
                href={unreadOnly ? '/app/notifications' : '/app/notifications?filter=unread'}
                variant="ghost"
                size="sm"
              >
                {unreadOnly ? 'Show all' : 'Show unread only'}
              </LinkButton>
              {unread > 0 ? (
                <ActionForm
                  action={markAllNotificationsReadAction}
                  className="flex items-center gap-2"
                >
                  <SubmitButton variant="secondary" size="sm" pendingLabel="Marking…">
                    Mark all as read
                  </SubmitButton>
                  <FormMessage showSuccess={false} />
                </ActionForm>
              ) : null}
            </div>
          }
        />
        {notifications.length === 0 ? (
          <EmptyState
            title={unreadOnly ? 'No unread notification' : 'No notification yet'}
            description={
              unreadOnly
                ? 'Everything has been read.'
                : 'You will be told here when a transfer completes, is reviewed or fails, and when your verification changes.'
            }
            action={
              unreadOnly ? (
                <LinkButton href="/app/notifications" variant="secondary">
                  Show all
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <ul aria-label="Notifications" className="divide-y divide-border">
            {notifications.map((notification) => {
              const isUnread = notification.readAt === null;
              const href = safeHref(notification.href);
              return (
                <li
                  key={notification.id}
                  className={`flex flex-wrap items-start justify-between gap-3 px-5 py-4 sm:px-6 ${isUnread ? 'bg-accent-soft/40' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                      {notification.title}
                      {isUnread ? <Badge tone="gold">New</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-sm text-fg-muted">{notification.body}</p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      <time
                        dateTime={notification.createdAt.toISOString()}
                        title={formatDateTime(notification.createdAt)}
                      >
                        {formatRelative(notification.createdAt)}
                      </time>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {href ? (
                      <Link href={href} className="text-sm font-medium text-accent hover:underline">
                        Open<span className="sr-only">: {notification.title}</span>
                      </Link>
                    ) : null}
                    {isUnread ? (
                      <ActionForm action={markNotificationReadAction}>
                        <input type="hidden" name="id" value={notification.id} />
                        <SubmitButton
                          variant="ghost"
                          size="sm"
                          pendingLabel="…"
                          aria-label={`Mark “${notification.title}” as read`}
                        >
                          Mark read
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {notifications.length === LIMIT ? (
          <p className="border-t border-border px-5 py-3 text-xs text-fg-subtle sm:px-6">
            Showing the {LIMIT} most recent notifications.
          </p>
        ) : null}
      </Card>
    </>
  );
}
