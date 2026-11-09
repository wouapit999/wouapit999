'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PERMISSION_KEYS } from '@bi-rem/shared/constants';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useSubmit } from '@/components/auth/use-submit';
import { PermissionMatrix } from '@/components/roles/permission-matrix';
import { useCan } from '@/components/shell/session-provider';
import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TBody, THead, Table, TableContainer, Td, Th, Tr } from '@/components/ui/table';
import { describeError } from '@/lib/errors';
import { formatRelative, formatWhen, localInputToIso } from '@/lib/format';
import { useApiKeys, useCreateApiKey, usePermissions, useRevokeApiKey } from '@/lib/queries';
import { type ApiKey, type CreatedApiKey, createApiKeySchema } from '@/lib/schemas';

function keyState(key: ApiKey, now = Date.now()): { label: string; tone: BadgeTone } {
  if (key.revokedAt) return { label: 'Revoked', tone: 'neutral' };
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= now)
    return { label: 'Expired', tone: 'warning' };
  return { label: 'Active', tone: 'success' };
}

export function ApiKeysPanel() {
  const canWrite = useCan('api-keys:write');
  const canRevoke = useCan('api-keys:revoke');
  const keys = useApiKeys();
  const revoke = useRevokeApiKey();
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const confirmRevoke = () => {
    if (!revoking) return;
    setRevokeError(null);
    revoke.mutate(revoking.id, {
      onSuccess: () => setRevoking(null),
      onError: (error) => setRevokeError(describeError(error)),
    });
  };

  if (keys.isPending) return <LoadingState label="Loading API keys…" />;
  if (keys.isError) return <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          Service-account keys for integrations. The secret is shown once at creation and never
          again.
        </p>
        {canWrite ? (
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            leadingIcon={<Icon name="plus" className="h-4 w-4" />}
          >
            Create API key
          </Button>
        ) : null}
      </div>
      {keys.data.length === 0 ? (
        <EmptyState
          title="No API keys"
          body="Create a key to let a service call the API with x-api-key."
        />
      ) : (
        <TableContainer>
          <Table caption="API keys">
            <THead>
              <tr>
                <Th>Name</Th>
                <Th>Prefix</Th>
                <Th>Scopes</Th>
                <Th>Status</Th>
                <Th>Last used</Th>
                <Th>Expires</Th>
                <Th>Created</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </THead>
            <TBody>
              {keys.data.map((key) => {
                const state = keyState(key);
                return (
                  <Tr key={key.id} className={key.revokedAt ? 'opacity-60' : undefined}>
                    <Td className="font-medium text-fg">{key.name}</Td>
                    <Td>
                      <code className="font-mono text-xs">{key.prefix}…</code>
                    </Td>
                    <Td className="text-fg-muted tabular-nums" title={key.scopes.join(', ')}>
                      {key.scopes.length}
                    </Td>
                    <Td>
                      <Badge tone={state.tone} dot>
                        {state.label}
                      </Badge>
                    </Td>
                    <Td className="text-fg-muted whitespace-nowrap">
                      {formatRelative(key.lastUsedAt)}
                    </Td>
                    <Td className="text-fg-muted whitespace-nowrap">
                      {key.expiresAt ? formatWhen(key.expiresAt) : 'Never'}
                    </Td>
                    <Td className="text-fg-muted whitespace-nowrap">{formatWhen(key.createdAt)}</Td>
                    <Td>
                      <div className="flex justify-end">
                        {canRevoke && !key.revokedAt ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-danger"
                            onClick={() => setRevoking(key)}
                          >
                            Revoke
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
      )}

      {canWrite && createOpen ? <CreateApiKeyDialog onClose={() => setCreateOpen(false)} /> : null}

      <Dialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title={`Revoke "${revoking?.name ?? ''}"?`}
        description="Requests signed with this key start failing immediately. This cannot be undone."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={revoke.isPending}
              loadingLabel="Revoking"
              onClick={confirmRevoke}
            >
              Revoke key
            </Button>
          </>
        }
      >
        {revokeError ? (
          <Alert tone="danger">{revokeError}</Alert>
        ) : (
          <p className="text-sm text-fg-muted">
            Prefix <code className="font-mono">{revoking?.prefix}…</code>
          </p>
        )}
      </Dialog>
    </div>
  );
}

const createKeyFormSchema = z.object({
  name: createApiKeySchema.shape.name,
  expiresAt: z.string(),
});
type CreateKeyFormValues = z.infer<typeof createKeyFormSchema>;

function CreateApiKeyDialog({ onClose }: { onClose: () => void }) {
  const canReadPermissions = useCan('permissions:read');
  const permissions = usePermissions(canReadPermissions);
  const create = useCreateApiKey();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreateKeyFormValues>({
    resolver: zodResolver(createKeyFormSchema),
    defaultValues: { name: '', expiresAt: '' },
  });
  const { run, formError, submitting, setFormError } = useSubmit<CreateKeyFormValues>(setError);

  const available = permissions.data?.map((record) => record.key) ?? [...PERMISSION_KEYS];

  const onSubmit = handleSubmit(async (values) => {
    if (selected.size === 0) {
      setFormError('Select at least one permission for the key.');
      return;
    }
    const expiresAt = localInputToIso(values.expiresAt);
    if (values.expiresAt && !expiresAt) {
      setError('expiresAt', { type: 'validate', message: 'Invalid date' });
      return;
    }
    const dto = createApiKeySchema.parse({
      name: values.name,
      scopes: [...selected],
      ...(expiresAt ? { expiresAt } : {}),
    });
    const result = await run(() => create.mutateAsync(dto), ['name', 'expiresAt']);
    if (result) setCreated(result);
  });

  if (created) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="API key created"
        description="Copy the secret now. For security it is not stored and cannot be shown again."
        size="sm"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <Alert tone="warning" title="Shown once">
          Anyone with this value can call the API as <strong>{created.name}</strong>. Store it in a
          secret manager.
        </Alert>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-surface-muted p-3">
          <code
            className="flex-1 font-mono text-xs break-all select-all"
            aria-label="API key secret"
          >
            {created.key}
          </code>
          <CopyButton value={created.key} label="Copy key" />
        </div>
        <p className="mt-3 text-xs text-fg-subtle">
          Prefix <code className="font-mono">{created.prefix}</code> · {created.scopes.length}{' '}
          {created.scopes.length === 1 ? 'scope' : 'scopes'}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Create API key"
      description="Grant only the permissions the integration needs. Keys are sent as the x-api-key header."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form="create-key-form" type="submit" loading={submitting} loadingLabel="Creating">
            Create key
          </Button>
        </>
      }
    >
      <form id="create-key-form" onSubmit={onSubmit} noValidate className="space-y-5">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Name"
            placeholder="Reconciliation worker"
            autoComplete="off"
            error={errors.name?.message}
            {...register('name')}
          />
          <TextField
            label="Expires"
            type="datetime-local"
            optional
            hint="Leave empty for a non-expiring key."
            error={errors.expiresAt?.message}
            {...register('expiresAt')}
          />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-fg">
            Permissions{' '}
            <span className="text-xs font-normal text-fg-subtle">({selected.size} selected)</span>
          </p>
          <PermissionMatrix
            available={available}
            selected={selected}
            onChange={setSelected}
            caption="API key permissions"
          />
        </div>
      </form>
    </Dialog>
  );
}
