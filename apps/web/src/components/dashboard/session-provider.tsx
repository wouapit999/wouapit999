'use client';

import { createContext, type ReactNode, useContext } from 'react';

import type { SessionUser } from '@/lib/auth-schemas';

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

/** The authenticated user, resolved server-side by the dashboard layout. */
export function useSession(): SessionUser {
  const user = useContext(SessionContext);
  if (!user) {
    throw new Error('useSession must be used inside the authenticated layout');
  }
  return user;
}
