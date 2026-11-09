import type { Metadata } from 'next';

import { PermissionGate } from '@/components/shell/permission-gate';
import { TemplatesView } from '@/components/templates/templates-view';

export const metadata: Metadata = { title: 'Notification templates' };

export default function TemplatesPage() {
  return (
    <PermissionGate section="templates" permission="notification-templates:read">
      <TemplatesView />
    </PermissionGate>
  );
}
