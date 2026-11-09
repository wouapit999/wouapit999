import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuditView } from '@/components/audit/audit-view';
import { PermissionGate } from '@/components/shell/permission-gate';
import { LoadingState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Audit log' };

export default function AuditPage() {
  return (
    <PermissionGate section="audit" permission="audit:read">
      <Suspense fallback={<LoadingState />}>
        <AuditView />
      </Suspense>
    </PermissionGate>
  );
}
