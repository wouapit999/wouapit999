import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { type NavItem, PARTNER_NAV } from '@/components/shell/nav';
import { Alert } from '@/components/ui';
import { getPageContext } from '@/server/auth/session';
import { db } from '@/server/db';
import { countUnreadNotifications } from '@/server/notifications';

export const metadata: Metadata = {
  title: { default: 'Partner portal', template: '%s · Partner portal' },
};

const STATUS_BANNERS: Readonly<
  Record<string, { tone: 'info' | 'warning' | 'danger'; title: string; body: string }>
> = {
  PENDING: {
    tone: 'info',
    title: 'Your application is under review',
    body: 'You can look around; payments, API keys and webhooks are enabled once an administrator approves it.',
  },
  SUSPENDED: {
    tone: 'warning',
    title: 'This partner account is suspended',
    body: 'Payments, API keys and webhooks are paused. Please contact BI-Rem support.',
  },
  REJECTED: {
    tone: 'danger',
    title: 'Your application was not approved',
    body: 'Please contact BI-Rem support for details.',
  },
};

/** Agents get one more section: their float and the cash-in / cash-out desk. */
const AGENT_NAV_ITEM: NavItem = { href: '/partner/float', label: 'Float & cash' };

function navFor(type: string | undefined): readonly NavItem[] {
  if (type !== 'AGENT') return PARTNER_NAV;
  const [dashboard, ...rest] = PARTNER_NAV;
  return dashboard ? [dashboard, AGENT_NAV_ITEM, ...rest] : [AGENT_NAV_ITEM, ...rest];
}

/** Partner portal chrome. Only role PARTNER gets in. */
export default async function PartnerLayout({ children }: { children: ReactNode }) {
  const { ctx, user } = await getPageContext('PARTNER');
  const [partner, unread] = await Promise.all([
    user.partnerId
      ? db.partner.findUnique({
          where: { id: user.partnerId },
          select: { status: true, type: true },
        })
      : null,
    countUnreadNotifications(ctx),
  ]);
  const banner = partner
    ? STATUS_BANNERS[partner.status]
    : {
        tone: 'danger' as const,
        title: 'No partner is linked to this login',
        body: 'Please contact BI-Rem support.',
      };
  return (
    <AppShell
      areaLabel="Partner portal"
      homeHref="/partner"
      user={user}
      nav={navFor(partner?.type)}
      badges={unread > 0 ? { '/partner': unread } : undefined}
      banner={
        banner ? (
          <Alert tone={banner.tone} title={banner.title}>
            {banner.body}
          </Alert>
        ) : undefined
      }
    >
      {children}
    </AppShell>
  );
}
