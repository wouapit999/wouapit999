'use client';

import type { ReactNode } from 'react';

import type { PermissionCode } from '@/lib/permissions';

import { useSession } from './session-provider';

/**
 * Renders children only when the admin holds the permission(s). With `mode="any"` one of the
 * listed permissions is enough. Use for hiding actions; for disabling, read `useCan` instead.
 */
export function Can({
  permission,
  mode = 'all',
  fallback = null,
  children,
}: {
  permission: PermissionCode | readonly PermissionCode[];
  mode?: 'all' | 'any';
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const session = useSession();
  const required = typeof permission === 'string' ? [permission] : permission;
  const allowed = mode === 'any' ? session.canAny(required) : session.canAll(required);
  return <>{allowed ? children : fallback}</>;
}
