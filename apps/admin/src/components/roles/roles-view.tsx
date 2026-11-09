'use client';

import { useState } from 'react';

import { useSession } from '@/components/shell/session-provider';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import {
  TBody,
  THead,
  Table,
  TableContainer,
  TableEmptyRow,
  Td,
  Th,
  Tr,
} from '@/components/ui/table';
import { describeError } from '@/lib/errors';
import { formatWhen } from '@/lib/format';
import { useDeleteRole, useRoles } from '@/lib/queries';
import type { Role } from '@/lib/schemas';

import { PermissionChips } from './permission-matrix';
import { RoleFormDialog } from './role-form-dialog';

type Editor = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; role: Role };

export function RolesView() {
  const { can } = useSession();
  const canWrite = can('roles:write');
  const canDelete = can('roles:delete');
  const roles = useRoles();
  const remove = useDeleteRole();
  const [editor, setEditor] = useState<Editor>({ mode: 'closed' });
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmDelete = () => {
    if (!deleting) return;
    setDeleteError(null);
    remove.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
      onError: (error) => setDeleteError(describeError(error)),
    });
  };

  return (
    <>
      <PageHeader
        title="Roles"
        description="Roles bundle resource:action permissions. Users receive the union of their roles."
        actions={
          canWrite ? (
            <Button
              onClick={() => setEditor({ mode: 'create' })}
              leadingIcon={<Icon name="plus" className="h-4 w-4" />}
            >
              Create role
            </Button>
          ) : undefined
        }
      />
      {roles.isPending ? (
        <LoadingState label="Loading roles…" />
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
      ) : (
        <TableContainer>
          <Table caption="All roles">
            <THead>
              <tr>
                <Th>Role</Th>
                <Th>Permissions</Th>
                <Th>Users</Th>
                <Th>Updated</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </THead>
            <TBody>
              {roles.data.length === 0 ? (
                <TableEmptyRow colSpan={5}>No roles yet.</TableEmptyRow>
              ) : (
                roles.data.map((role) => (
                  <Tr key={role.id}>
                    <Td className="align-top">
                      <span className="inline-flex items-center gap-2 font-medium text-fg">
                        <code className="font-mono text-sm">{role.name}</code>
                        {role.isSystem ? <Badge tone="neutral">Built-in</Badge> : null}
                      </span>
                      {role.description ? (
                        <span className="mt-0.5 block text-xs text-fg-muted">
                          {role.description}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="max-w-md align-top">
                      <span className="mb-1 block text-xs text-fg-subtle">
                        {role.permissions.length} total
                      </span>
                      <PermissionChips permissions={role.permissions} max={8} />
                    </Td>
                    <Td className="align-top text-fg-muted tabular-nums">
                      {role.userCount ?? '—'}
                    </Td>
                    <Td className="align-top text-fg-muted whitespace-nowrap">
                      {formatWhen(role.updatedAt)}
                    </Td>
                    <Td className="align-top">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setEditor({ mode: 'edit', role })}
                        >
                          {canWrite ? 'Edit' : 'View'}
                        </Button>
                        {canDelete && !role.isSystem ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-danger"
                            onClick={() => setDeleting(role)}
                          >
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </TableContainer>
      )}

      {editor.mode !== 'closed' ? (
        canWrite ? (
          <RoleFormDialog
            role={editor.mode === 'edit' ? editor.role : null}
            onClose={() => setEditor({ mode: 'closed' })}
          />
        ) : editor.mode === 'edit' ? (
          <RoleViewDialog role={editor.role} onClose={() => setEditor({ mode: 'closed' })} />
        ) : null
      ) : null}

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'role'}?`}
        description="Users holding this role lose its permissions immediately. This cannot be undone."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              loadingLabel="Deleting"
              onClick={confirmDelete}
            >
              Delete role
            </Button>
          </>
        }
      >
        {deleteError ? <Alert tone="danger">{deleteError}</Alert> : null}
        {deleting?.userCount ? (
          <Alert tone="warning">
            {deleting.userCount} user{deleting.userCount === 1 ? ' holds' : 's hold'} this role.
          </Alert>
        ) : (
          <p className="text-sm text-fg-muted">No users currently hold this role.</p>
        )}
      </Dialog>
    </>
  );
}

function RoleViewDialog({ role, onClose }: { role: Role; onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={role.name}
      description={role.description ?? 'No description.'}
      size="lg"
    >
      <PermissionChips permissions={role.permissions} max={100} />
    </Dialog>
  );
}
