'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

import {
  type PermissionCode,
  type PermissionSet,
  type SectionKey,
  canAccessSection,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  toPermissionSet,
} from '@/lib/permissions';
import type { AdminMe } from '@/lib/schemas';

export interface Session {
  user: AdminMe;
  permissions: PermissionSet;
  can: (permission: PermissionCode) => boolean;
  canAny: (permissions: readonly PermissionCode[]) => boolean;
  canAll: (permissions: readonly PermissionCode[]) => boolean;
  canAccess: (section: SectionKey) => boolean;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ user, children }: { user: AdminMe; children: ReactNode }) {
  const value = useMemo<Session>(() => {
    const permissions = toPermissionSet(user.permissions);
    return {
      user,
      permissions,
      can: (permission) => hasPermission(permissions, permission),
      canAny: (required) => hasAnyPermission(permissions, required),
      canAll: (required) => hasAllPermissions(permissions, required),
      canAccess: (section) => canAccessSection(permissions, section),
    };
  }, [user]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The authenticated admin and permission helpers, resolved server-side by the app layout. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error('useSession must be used inside the authenticated layout');
  }
  return session;
}

/** `true` when the current admin holds the permission. */
export function useCan(permission: PermissionCode): boolean {
  return useSession().can(permission);
}
