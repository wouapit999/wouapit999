'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { PAGINATION } from '@bi-rem/shared/constants';
import { formatDateTime } from '@bi-rem/shared/utils';

import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import { useI18n } from '@/i18n/provider';
import { proxyApi } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { type CustomerNotification, notificationsPageSchema } from '@/lib/notifications';
import { API } from '@/lib/routes';

export const NOTIFICATIONS_QUERY_KEY = ['notifications', 'me'] as const;

const CATEGORY_TONE = {
  SECURITY: 'danger',
  TRANSACTIONAL: 'brand',
  SYSTEM: 'neutral',
  MARKETING: 'gold',
} as const;

export function NotificationsView() {
  const { t, intlLocale } = useI18n();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: [...NOTIFICATIONS_QUERY_KEY, page],
    // Only `page`/`pageSize` (plus channel/status/unreadOnly) are accepted by the API, whose
    // validation pipe rejects unknown query parameters.
    queryFn: () =>
      proxyApi.get(API.notifications.me, {
        query: { page, pageSize: PAGINATION.defaultPageSize },
        schema: notificationsPageSchema,
      }),
    placeholderData: keepPreviousData,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => proxyApi.post(API.notifications.markRead(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });

  const unread = query.data?.data.filter((n) => n.readAt === null).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        action={
          unread > 0 ? (
            <Badge tone="brand">{t('notifications.unreadCount', { count: unread })}</Badge>
          ) : null
        }
      />

      {query.isPending ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState title={t('notifications.empty.title')} body={t('notifications.empty.body')} />
      ) : (
        <>
          <ul className="space-y-3">
            {query.data.data.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                intlLocale={intlLocale}
                onMarkRead={
                  notification.readAt === null ? () => markRead.mutate(notification.id) : undefined
                }
                marking={markRead.isPending && markRead.variables === notification.id}
              />
            ))}
          </ul>
          {markRead.isError ? <ErrorState error={markRead.error} /> : null}
          {query.data.meta.totalPages > 1 ? (
            <nav
              aria-label={t('pagination.label')}
              className="flex flex-wrap items-center justify-between gap-3 text-sm text-fg-muted"
            >
              <Button
                variant="secondary"
                size="sm"
                disabled={!query.data.meta.hasPreviousPage || query.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {t('pagination.previous')}
              </Button>
              <span aria-live="polite">
                {t('pagination.summary', {
                  page: query.data.meta.page,
                  total: query.data.meta.totalPages,
                })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={!query.data.meta.hasNextPage || query.isFetching}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('pagination.next')}
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  intlLocale,
  onMarkRead,
  marking,
}: {
  notification: CustomerNotification;
  intlLocale: string;
  onMarkRead: (() => void) | undefined;
  marking: boolean;
}) {
  const { t } = useI18n();
  const unread = notification.readAt === null;
  return (
    <li>
      <Card
        className={cn(
          'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
          unread && 'border-brand-300 dark:border-brand-700',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {notification.category ? (
              <Badge tone={CATEGORY_TONE[notification.category]}>
                {t(`notifications.category.${notification.category}`)}
              </Badge>
            ) : (
              <Badge>{t(`notifications.channel.${notification.channel}`)}</Badge>
            )}
            {unread ? <Badge tone="brand">{t('badge.unread')}</Badge> : null}
            <time dateTime={notification.createdAt} className="text-xs text-fg-subtle">
              {formatDateTime(notification.createdAt, intlLocale)}
            </time>
          </div>
          {notification.subject ? (
            <p className="mt-2 font-semibold">{notification.subject}</p>
          ) : null}
          <p className="mt-1 whitespace-pre-line text-sm text-fg-muted">{notification.body}</p>
        </div>
        {onMarkRead ? (
          <Button variant="ghost" size="sm" onClick={onMarkRead} loading={marking}>
            {t('action.markRead')}
          </Button>
        ) : null}
      </Card>
    </li>
  );
}
