import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SessionProvider } from '@/components/shell/session-provider';
import { AdminShell } from '@/components/shell/shell';
import { BFF, PAGES, safeNextPath } from '@/lib/routes';
import { getSession } from '@/lib/server/session';
import { PATHNAME_HEADER } from '@/proxy';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (session.status !== 'authenticated') {
    const headerStore = await headers();
    const next = safeNextPath(headerStore.get(PATHNAME_HEADER), PAGES.dashboard);
    if (session.status === 'forbidden') {
      // A valid non-admin session: drop it rather than bouncing through refresh forever.
      redirect(`${PAGES.login}?reason=forbidden`);
    }
    const target = session.status === 'expired' ? BFF.auth.refresh : PAGES.login;
    redirect(`${target}?next=${encodeURIComponent(next)}`);
  }

  return (
    <SessionProvider user={session.user}>
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  );
}
