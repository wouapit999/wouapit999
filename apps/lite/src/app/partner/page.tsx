import type { Metadata } from 'next';
import Link from 'next/link';

import { PartnerActionButton } from '@/components/partner/action-button';
import { CopyButton } from '@/components/partner/copy-button';
import { TransactionsTable } from '@/components/partner/transactions-table';
import {
  Badge,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  DescriptionList,
  EmptyState,
  LinkButton,
  Money,
  PageHeader,
  Stat,
  StatGrid,
  StatusBadge,
} from '@/components/ui';
import { formatBps, formatRelative } from '@/lib/format';
import { listNotifications } from '@/server/notifications';
import { getPartnerDashboard } from '@/server/partners';
import { listMyTransfers } from '@/server/transfers';

import { PARTNER_TYPE_LABELS, getPartnerPage } from './_lib/partner';
import { markNotificationsReadAction } from './actions';

export const metadata: Metadata = { title: 'Dashboard' };

const HOW_TO_GET_PAID = {
  MERCHANT:
    'Customers pay you from the BI-Rem app by entering your payment code. The money lands in your wallet immediately.',
  AGENT:
    'Customers cash out by sending to your agent code; you credit their wallet from your float when they hand you cash.',
  PARTNER:
    'Disburse from your wallet through the API. Customers can also pay your code from the BI-Rem app.',
} as const;

/** Partner dashboard: balance, 30-day volume, commission, recent activity and integration health. */
export default async function PartnerDashboardPage() {
  const { ctx, partner } = await getPartnerPage();
  const [dashboard, recent, notifications] = await Promise.all([
    getPartnerDashboard(ctx),
    listMyTransfers(ctx, { pageSize: 8 }),
    listNotifications(ctx, { limit: 5 }),
  ]);
  const home = partner.currency;
  const pick = <T extends { currency: string }>(rows: readonly T[]): T | undefined =>
    rows.find((row) => row.currency === home);
  const wallet = pick(dashboard.wallets);
  const received = pick(dashboard.last30Days.received);
  const sent = pick(dashboard.last30Days.sent);
  const commission = pick(dashboard.commissions);
  const otherWallets = dashboard.wallets.filter((row) => row.currency !== home);
  const otherCommissions = dashboard.commissions.filter((row) => row.currency !== home);
  const failedDeliveries = dashboard.webhookDeliveries.FAILED ?? 0;
  const unread = notifications.filter((notification) => !notification.readAt).length;

  return (
    <>
      <PageHeader
        title={partner.name}
        description={`${PARTNER_TYPE_LABELS[partner.type]} · ${partner.countryCode} · ${home}`}
        actions={
          <>
            <StatusBadge status={partner.status} />
            {partner.type === 'AGENT' ? (
              <LinkButton href="/partner/float" size="sm">
                Cash-in / cash-out
              </LinkButton>
            ) : null}
          </>
        }
      />

      <StatGrid>
        <Stat
          label={partner.type === 'AGENT' ? 'Float balance' : 'Settlement balance'}
          value={wallet ? <Money amount={wallet.balance} currency={home} /> : '—'}
          hint={
            wallet
              ? otherWallets.length > 0
                ? otherWallets.map((row) => `${row.currency} wallet`).join(', ') + ' also held'
                : 'Available in your wallet now'
              : 'Created when the account is approved'
          }
        />
        <Stat
          label="Received · 30 days"
          value={<Money amount={received?.amount ?? 0n} currency={home} />}
          hint={`${received?.count ?? 0} completed payment${received?.count === 1 ? '' : 's'}`}
        />
        <Stat
          label="Sent · 30 days"
          value={<Money amount={sent?.amount ?? 0n} currency={home} />}
          hint={`${sent?.count ?? 0} completed transfer${sent?.count === 1 ? '' : 's'}`}
        />
        <Stat
          label="Commission accrued"
          value={<Money amount={commission?.accrued ?? 0n} currency={home} />}
          hint={
            <>
              {formatBps(partner.commissionBps)} per transaction ·{' '}
              <Money amount={commission?.settled ?? 0n} currency={home} /> already paid
            </>
          }
          tone={commission && commission.accrued > 0n ? 'success' : 'default'}
        />
      </StatGrid>

      {otherCommissions.length > 0 ? (
        <p className="mt-2 text-xs text-fg-muted">
          Commission in other currencies:{' '}
          {otherCommissions.map((row, index) => (
            <span key={row.currency}>
              {index > 0 ? ', ' : ''}
              <Money amount={row.accrued} currency={row.currency} /> accrued
            </span>
          ))}
          .
        </p>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Recent transactions"
            description="Payments received and transfers sent"
            action={
              <LinkButton href="/partner/transactions" variant="secondary" size="sm">
                View all
              </LinkButton>
            }
          />
          {recent.items.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              description="Payments to your code and transfers sent through the API will appear here."
            />
          ) : (
            <TransactionsTable items={recent.items} caption="Recent transactions" compact />
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Your payment code" />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <code
                  data-testid="partner-code"
                  className="rounded-lg bg-accent-soft px-3 py-2 font-mono text-lg font-semibold tracking-wider text-accent"
                >
                  {partner.code}
                </code>
                <CopyButton value={partner.code} label="Copy code" />
              </div>
              <p className="text-sm text-fg-muted">{HOW_TO_GET_PAID[partner.type]}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Integration" description="API and webhooks" />
            <CardBody>
              <DescriptionList
                items={[
                  {
                    label: 'Active API keys',
                    value: (
                      <Link
                        href="/partner/api-keys"
                        className="font-medium text-accent hover:underline"
                      >
                        {dashboard.activeApiKeys}
                      </Link>
                    ),
                  },
                  {
                    label: 'Webhook endpoints',
                    value: (
                      <Link
                        href="/partner/webhooks"
                        className="font-medium text-accent hover:underline"
                      >
                        {dashboard.activeWebhookEndpoints} active
                      </Link>
                    ),
                  },
                  {
                    label: 'Deliveries · 30 days',
                    value: (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="success">
                          {dashboard.webhookDeliveries.DELIVERED ?? 0} delivered
                        </Badge>
                        <Badge tone={failedDeliveries > 0 ? 'danger' : 'neutral'}>
                          {failedDeliveries} failed
                        </Badge>
                      </span>
                    ),
                  },
                ]}
              />
            </CardBody>
            <CardFooter>
              <Link href="/partner/docs" className="font-medium text-accent hover:underline">
                Read the API reference →
              </Link>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader
              title="Notifications"
              action={
                unread > 0 ? (
                  <PartnerActionButton
                    action={markNotificationsReadAction}
                    fields={{}}
                    variant="ghost"
                  >
                    Mark all read
                  </PartnerActionButton>
                ) : undefined
              }
            />
            {notifications.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">Nothing new.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {notifications.map((notification) => (
                  <li key={notification.id} className="px-5 py-3 sm:px-6">
                    <p className="flex items-start justify-between gap-2 text-sm font-medium text-fg">
                      <span>{notification.title}</span>
                      {notification.readAt ? null : <Badge tone="gold">New</Badge>}
                    </p>
                    <p className="mt-0.5 text-sm text-fg-muted">{notification.body}</p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      {formatRelative(notification.createdAt)}
                    </p>
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
