import type { Metadata } from 'next';

import { RolesView } from '@/components/roles/roles-view';
import { PermissionGate } from '@/components/shell/permission-gate';

export const metadata: Metadata = { title: 'Roles' };

export default function RolesPage() {
  return (
    <PermissionGate section="roles" permission="roles:read">
      <RolesView />
    </PermissionGate>
  );
}
