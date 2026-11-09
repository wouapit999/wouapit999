import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PermissionGate } from '@/components/shell/permission-gate';
import { UserDetailView } from '@/components/users/user-detail-view';

export const metadata: Metadata = { title: 'User' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  return (
    <PermissionGate section="users" permission="users:read">
      <UserDetailView id={id} />
    </PermissionGate>
  );
}
