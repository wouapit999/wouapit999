'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PERMISSION_KEYS } from '@bi-rem/shared/constants';
import { roleNameSchema } from '@bi-rem/shared/schemas';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useSubmit } from '@/components/auth/use-submit';
import { useCan } from '@/components/shell/session-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/field';
import { useCreateRole, usePermissions, useUpdateRole } from '@/lib/queries';
import { type Role, createRoleSchema, updateRoleSchema } from '@/lib/schemas';

import { PermissionMatrix } from './permission-matrix';

const roleFormSchema = z.object({
  name: roleNameSchema,
  description: z.string().trim().max(500),
});
type RoleFormValues = z.infer<typeof roleFormSchema>;

/**
 * Create/edit a role. The permission list comes from `GET /v1/permissions` (the API's catalogue,
 * which is wider than the shared constant) when the admin may read it, otherwise from the shared
 * constant without descriptions.
 */
export function RoleFormDialog({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const canReadPermissions = useCan('permissions:read');
  const permissions = usePermissions(canReadPermissions);
  const create = useCreateRole();
  const update = useUpdateRole();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(role?.permissions ?? []));

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: { name: role?.name ?? '', description: role?.description ?? '' },
  });
  const { run, formError, submitting, setFormError } = useSubmit<RoleFormValues>(setError);

  const available = permissions.data?.map((record) => record.key) ?? [...PERMISSION_KEYS];
  const descriptions = new Map(
    permissions.data?.map((record) => [record.key, record.description]) ?? [],
  );

  const onSubmit = handleSubmit(async (values) => {
    const permissionList = [...selected];
    const unknown = permissionList.filter((code) => !available.includes(code));
    if (unknown.length > 0) {
      setFormError(`Unknown permissions: ${unknown.join(', ')}`);
      return;
    }
    const result = await run(async () => {
      if (role) {
        const dto = updateRoleSchema.parse({
          ...(role.isSystem ? {} : { name: values.name }),
          description: values.description === '' ? null : values.description,
          permissions: permissionList,
        });
        return update.mutateAsync({ id: role.id, dto });
      }
      const dto = createRoleSchema.parse({
        name: values.name,
        ...(values.description ? { description: values.description } : {}),
        permissions: permissionList,
      });
      return create.mutateAsync(dto);
    }, ['name', 'description']);
    if (result) onClose();
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={role ? `Edit ${role.name}` : 'Create role'}
      description={
        role?.isSystem
          ? 'Built-in roles keep their name; you can still adjust their description and permissions.'
          : 'Role names are UPPER_SNAKE_CASE. Permissions are granted per resource and action.'
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form="role-form" type="submit" loading={submitting} loadingLabel="Saving">
            {role ? 'Save role' : 'Create role'}
          </Button>
        </>
      }
    >
      <form id="role-form" onSubmit={onSubmit} noValidate className="space-y-5">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Name"
            placeholder="SUPPORT_LEAD"
            autoComplete="off"
            disabled={role?.isSystem ?? false}
            className="font-mono uppercase"
            error={errors.name?.message}
            {...register('name')}
          />
          <TextField
            label="Description"
            optional
            error={errors.description?.message}
            {...register('description')}
          />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-fg">
            Permissions{' '}
            <span className="text-xs font-normal text-fg-subtle">({selected.size} selected)</span>
          </p>
          {permissions.isError ? (
            <Alert tone="warning" className="mb-3">
              Could not load permission descriptions; showing the built-in list.
            </Alert>
          ) : null}
          <PermissionMatrix
            available={available}
            selected={selected}
            onChange={setSelected}
            descriptions={descriptions}
          />
        </div>
      </form>
    </Dialog>
  );
}
