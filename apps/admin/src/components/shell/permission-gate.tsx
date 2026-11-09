'use client';

import type { ReactNode } from 'react';

import { ForbiddenState } from '@/components/ui/states';
import type { PermissionCode, SectionKey } from '@/lib/permissions';

import { useSession } from './session-provider';

/** Page-level guard: renders the forbidden state instead of the page when access is missing. */
export function PermissionGate({
  section,
  permission,
  children,
}: {
  section: SectionKey;
  permission: PermissionCode;
  children: ReactNode;
}) {
  const session = useSession();
  if (!session.canAccess(section)) return <ForbiddenState permission={permission} />;
  return <>{children}</>;
}
