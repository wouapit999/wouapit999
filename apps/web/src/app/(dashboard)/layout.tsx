import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SessionProvider } from '@/components/dashboard/session-provider';
import { DashboardShell } from '@/components/dashboard/shell';
import { BFF, PAGES, safeNextPath } from '@/lib/routes';
import { getSession } from '@/lib/server/session';

/** Header set by `proxy.ts` so the layout can send users back to the page they asked for. */
export const PATHNAME_HEADER = 'x-birem-pathname';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (session.status !== 'authenticated') {
    const headerStore = await headers();
    const next = safeNextPath(headerStore.get(PATHNAME_HEADER), PAGES.dashboard);
    const target = session.status === 'expired' ? BFF.auth.refresh : PAGES.login;
    redirect(`${target}?next=${encodeURIComponent(next)}`);
  }

  return (
    <SessionProvider user={session.user}>
      <DashboardShell>{children}</DashboardShell>
    </SessionProvider>
  );
}
