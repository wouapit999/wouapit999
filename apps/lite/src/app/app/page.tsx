import type { Metadata } from 'next';
import Link from 'next/link';

import { LimitsSummary } from '@/components/customer/limits-card';
import { TransferList } from '@/components/customer/transfer-list';
import {
  Alert,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  LinkButton,
  Money,
  PageHeader,
  StatusBadge,
} from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { getLimitOverview } from '@/server/kyc';
import { listNotifications } from '@/server/notifications';
import { listMyTransfers } from '@/server/transfers';
import { listMyWallets } from '@/server/wallets';

import { KYC_TIER_SHORT, labelFor } from './_lib/labels';

export const metadata: Metadata = { title: 'Home' };

const QUICK_ACTIONS = [
  { href: '/app/send', label: 'Send money', hint: 'Domestic or international', icon: '↗' },
  { href: '/app/wallets/topup', label: 'Top up', hint: 'Cash in from mobile money', icon: '+' },
  { href: '/app/beneficiaries', label: 'Beneficiaries', hint: 'People you pay often', icon: '☺' },
  { href: '/app/transfers', label: 'History', hint: 'Track and get receipts', icon: '≡' },
] as const;

/** Customer dashboard: wallets, verification status and limits, recent activity. */
export default async function CustomerHomePage() {
  const { ctx, user } = await getPageContext('CUSTOMER');
  const [wallets, limits, recent, unread] = await Promise.all([
    listMyWallets(ctx),
    getLimitOverview(ctx),
    listMyTransfers(ctx, { pageSize: 5 }),
    listNotifications(ctx, { unreadOnly: true, limit: 4 }),
  ]);
  const firstName = user.fullName.split(' ')[0] ?? user.fullName;
  const canUpgrade = user.kycTier !== 'TIER_2' && user.kycStatus !== 'PENDING';

  return (
    <>
      <PageHeader
        title={`Hello, ${firstName}`}
        description="Your wallets, limits and latest activity at a glance."
        actions={<LinkButton href="/app/send">Send money</LinkButton>}
      />

      {user.kycStatus === 'REJECTED' ? (
        <Alert tone="warning" title="Your identity could not be verified" className="mb-4">
          You can send your documents again at any time.{' '}
          <Link href="/app/kyc" className="font-medium underline">
            Go to verification
          </Link>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="space-y-4 lg:col-span-2 lg:space-y-6">
          <Card>
            <CardHeader
              title="Wallets"
              description="Balances come straight from the ledger."
              action={
                <LinkButton href="/app/wallets" variant="secondary" size="sm">
                  Manage
                </LinkButton>
              }
            />
            <CardBody>
              {wallets.length === 0 ? (
                <EmptyState
                  title="No wallet yet"
                  description="A wallet is created when you register with a supported country."
                  action={
                    <LinkButton href="/app/profile" variant="secondary">
                      Check your profile
                    </LinkButton>
                  }
                />
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {wallets.map((wallet) => (
                    <li key={wallet.id}>
                      <Link
                        href={`/app/wallets/${wallet.id}`}
                        className="block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                            {wallet.currency} wallet
                          </span>
                          {wallet.status === 'ACTIVE' ? null : (
                            <StatusBadge status={wallet.status} />
                          )}
                        </span>
                        <span className="mt-1 block text-2xl font-semibold">
                          <Money amount={wallet.balance} currency={wallet.currency} />
                        </span>
                        <span className="mt-1 block text-xs text-fg-muted">View statement →</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <nav aria-label="Quick actions">
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {QUICK_ACTIONS.map((action) => (
                <li key={action.href}>
                  <Link
                    href={action.href}
                    className="flex h-full flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface-raised p-4 shadow-[var(--shadow-card)] transition-colors hover:border-accent"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-lg font-semibold text-accent"
                    >
                      {action.icon}
                    </span>
                    <span className="mt-1 text-sm font-semibold text-fg">{action.label}</span>
                    <span className="text-xs text-fg-muted">{action.hint}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <Card>
            <CardHeader
              title="Recent transfers"
              action={
                recent.total > 0 ? (
                  <LinkButton href="/app/transfers" variant="ghost" size="sm">
                    View all
                  </LinkButton>
                ) : null
              }
            />
            {recent.items.length === 0 ? (
              <EmptyState
                title="No transfers yet"
                description="Top up your wallet, then send money to a BI-Rem account, a merchant, an agent or a mobile-money number."
                action={<LinkButton href="/app/send">Send your first transfer</LinkButton>}
              />
            ) : (
              <TransferList items={recent.items} label="Recent transfers" />
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:space-y-6">
          <Card>
            <CardHeader
              title="Verification"
              action={
                <StatusBadge
                  status={user.kycStatus}
                  label={
                    user.kycStatus === 'NONE'
                      ? 'Not verified'
                      : user.kycStatus === 'PENDING'
                        ? 'In review'
                        : undefined
                  }
                />
              }
            />
            <CardBody>
              <p className="mb-3 text-sm">
                <span className="font-semibold">{labelFor(KYC_TIER_SHORT, user.kycTier)}</span>
                <span className="text-fg-muted"> — your current verification level</span>
              </p>
              <LimitsSummary
                tier={limits.tier}
                international={limits.limits.international}
                currency={limits.currency}
                local={limits.local}
              />
            </CardBody>
            <CardFooter>
              <Link href="/app/kyc" className="font-medium text-accent hover:underline">
                {canUpgrade ? 'Raise your limits →' : 'Verification details →'}
              </Link>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader
              title="Notifications"
              action={
                <LinkButton href="/app/notifications" variant="ghost" size="sm">
                  View all
                </LinkButton>
              }
            />
            {unread.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">You are all caught up.</p>
              </CardBody>
            ) : (
              <ul aria-label="Unread notifications" className="divide-y divide-border">
                {unread.map((notification) => (
                  <li key={notification.id} className="px-5 py-3 sm:px-6">
                    <p className="text-sm font-medium text-fg">{notification.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-fg-muted">{notification.body}</p>
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
