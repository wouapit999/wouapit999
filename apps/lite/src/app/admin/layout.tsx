import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { adminNavFor } from '@/components/shell/nav';
import { getPageContext } from '@/server/auth/session';
import { countUnreadNotifications } from '@/server/notifications';
import { STAFF_ROLES } from '@/server/rbac';

export const metadata: Metadata = { title: 'Back office' };

/** Back-office chrome. Staff roles only; the sidebar lists what the role is allowed to open. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const unread = await countUnreadNotifications(ctx);
  return (
    <AppShell
      areaLabel="Back office"
      homeHref="/admin"
      user={user}
      nav={adminNavFor(user.role)}
      badges={{ '/admin/notifications': unread }}
    >
      {children}
    </AppShell>
  );
}
