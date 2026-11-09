import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PermissionGate } from '@/components/shell/permission-gate';
import { UsersView } from '@/components/users/users-view';
import { LoadingState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Users' };

export default function UsersPage() {
  return (
    <PermissionGate section="users" permission="users:read">
      <Suspense fallback={<LoadingState />}>
        <UsersView />
      </Suspense>
    </PermissionGate>
  );
}
