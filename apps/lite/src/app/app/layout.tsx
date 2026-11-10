import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { CUSTOMER_NAV } from '@/components/shell/nav';
import { getPageContext } from '@/server/auth/session';
import { countUnreadNotifications } from '@/server/notifications';

/** Customer area chrome. Only role CUSTOMER gets in (others are sent to their own area). */
export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const { ctx, user } = await getPageContext('CUSTOMER');
  const unread = await countUnreadNotifications(ctx);
  return (
    <AppShell
      areaLabel="Customer"
      homeHref="/app"
      user={user}
      nav={CUSTOMER_NAV}
      badges={{ '/app/notifications': unread }}
    >
      {children}
    </AppShell>
  );
}
