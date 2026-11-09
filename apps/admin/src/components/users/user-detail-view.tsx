'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { COUNTRIES, COUNTRY_CODES, SUPPORTED_LOCALES, isLocale } from '@bi-rem/shared/constants';
import {
  type AdminUpdateUserDto,
  adminUpdateUserSchema,
  e164PhoneSchema,
  localeSchema,
  personNameSchema,
} from '@bi-rem/shared/schemas';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useSubmit } from '@/components/auth/use-submit';
import { PermissionMatrix } from '@/components/roles/permission-matrix';
import { useSession } from '@/components/shell/session-provider';
import { Alert } from '@/components/ui/alert';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card, CardHeader, Property } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { CheckboxField, SelectField, TextField } from '@/components/ui/field';
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
import {
  countryName,
  formatRelative,
  formatWhen,
  fullName,
  humanizeEnum,
  isKnownCountryCode,
} from '@/lib/format';
import { effectivePermissions } from '@/lib/permissions';
import { useAssignRoles, useAuditLog, useRoles, useUpdateUser, useUser } from '@/lib/queries';
import { PAGES } from '@/lib/routes';
import type { UserProfile } from '@/lib/schemas';

import { UserStatusActions } from './user-status-actions';

export function UserDetailView({ id }: { id: string }) {
  const user = useUser(id);
  const [actionError, setActionError] = useState<string | null>(null);

  if (user.isPending) return <LoadingState label="Loading user…" />;
  if (user.isError) return <ErrorState error={user.error} onRetry={() => void user.refetch()} />;

  const profile = user.data;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={PAGES.users} className="inline-flex items-center gap-1 hover:underline">
            <Icon name="chevronLeft" className="h-3.5 w-3.5" /> Users
          </Link>
        }
        title={fullName(profile) || profile.email}
        description={profile.email}
        actions={
          <>
            <Badge tone={statusTone(profile.status)} dot>
              {humanizeEnum(profile.status)}
            </Badge>
            <UserStatusActions user={profile} size="sm" onError={setActionError} />
            <EditProfileButton user={profile} />
          </>
        }
      />
      {actionError ? (
        <Alert
          tone="danger"
          className="mb-4"
          action={
            <Button variant="ghost" size="sm" onClick={() => setActionError(null)}>
              Dismiss
            </Button>
          }
        >
          {actionError}
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <ProfileCard user={profile} />
          <RolesCard user={profile} />
        </div>
        <RecentAuditCard user={profile} />
      </div>
    </>
  );
}

function ProfileCard({ user }: { user: UserProfile }) {
  return (
    <Card>
      <CardHeader title="Profile" />
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Property label="User id">
          <code className="font-mono text-xs">{user.id}</code>
        </Property>
        <Property label="Realm">
          <Badge tone={user.realm === 'ADMIN' ? 'gold' : 'neutral'}>
            {humanizeEnum(user.realm)}
          </Badge>
        </Property>
        <Property label="Email verified">
          {user.emailVerifiedAt ? formatWhen(user.emailVerifiedAt) : 'Not yet'}
        </Property>
        <Property label="Phone">{user.phone ?? '—'}</Property>
        <Property label="Country">{countryName(user.countryCode)}</Property>
        <Property label="Locale">{user.locale.toUpperCase()}</Property>
        <Property label="MFA">{user.mfaEnabled ? 'Enabled' : 'Disabled'}</Property>
        <Property label="Last sign-in">{formatRelative(user.lastLoginAt)}</Property>
        <Property label="Created">{formatWhen(user.createdAt)}</Property>
        <Property label="Updated">{formatWhen(user.updatedAt)}</Property>
      </dl>
    </Card>
  );
}

// --- Edit profile -----------------------------------------------------------------------------

const editProfileFormSchema = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,
  phone: z.union([z.literal(''), e164PhoneSchema]),
  /** `''` clears the country; a stored code outside the shared list is kept as-is. */
  countryCode: z.string().trim().max(3),
  locale: localeSchema,
});
type EditProfileValues = z.infer<typeof editProfileFormSchema>;

function EditProfileButton({ user }: { user: UserProfile }) {
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  if (!can('users:write')) return null;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        leadingIcon={<Icon name="pencil" className="h-4 w-4" />}
      >
        Edit
      </Button>
      {open ? <EditProfileDialog user={user} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function EditProfileDialog({ user, onClose }: { user: UserProfile; onClose: () => void }) {
  const update = useUpdateUser(user.id);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EditProfileValues>({
    resolver: zodResolver(editProfileFormSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone ?? '',
      countryCode: user.countryCode ?? '',
      locale: isLocale(user.locale) ? user.locale : 'en',
    },
  });
  const { run, formError, submitting } = useSubmit<EditProfileValues>(setError);

  const onSubmit = handleSubmit(async (values) => {
    // PATCH only what changed, so a stored value the API would no longer accept (e.g. a country
    // code missing from the shared list) is never re-submitted by an unrelated edit.
    const next = {
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone === '' ? null : values.phone,
      countryCode: values.countryCode === '' ? null : values.countryCode,
      locale: values.locale,
    };
    if (next.countryCode !== null && next.countryCode !== user.countryCode) {
      if (!isKnownCountryCode(next.countryCode)) {
        setError('countryCode', { type: 'validate', message: 'Choose a supported country' });
        return;
      }
    }
    const changes: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(next)) {
      if (value !== user[field as keyof typeof next]) changes[field] = value;
    }
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    const dto: AdminUpdateUserDto = adminUpdateUserSchema.parse(changes);
    const result = await run(
      () => update.mutateAsync(dto),
      ['firstName', 'lastName', 'phone', 'countryCode', 'locale'],
    );
    if (result) onClose();
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit profile"
      description="Email and status are changed through dedicated flows and are not editable here."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form="edit-profile-form" type="submit" loading={submitting} loadingLabel="Saving">
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-profile-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <TextField label="Last name" error={errors.lastName?.message} {...register('lastName')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Phone"
            optional
            hint="E.164 format"
            inputMode="tel"
            error={errors.phone?.message}
            {...register('phone')}
          />
          <SelectField
            label="Country"
            optional
            placeholder="Not set"
            options={countryOptions(user.countryCode)}
            error={errors.countryCode?.message}
            {...register('countryCode')}
          />
        </div>
        <SelectField
          label="Locale"
          options={SUPPORTED_LOCALES.map((value) => ({ value, label: value.toUpperCase() }))}
          error={errors.locale?.message}
          {...register('locale')}
        />
      </form>
    </Dialog>
  );
}

/** Shared country list plus the user's current code when it is not (yet) in that list. */
function countryOptions(current: string | null): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = COUNTRY_CODES.map((code) => ({
    value: code,
    label: COUNTRIES[code].name,
  }));
  if (current && !isKnownCountryCode(current)) {
    options.unshift({ value: current, label: `${current} (not in the supported list)` });
  }
  return options;
}

// --- Roles ------------------------------------------------------------------------------------

function RolesCard({ user }: { user: UserProfile }) {
  const { can } = useSession();
  const canReadRoles = can('roles:read');
  const canAssign = can('roles:assign');
  const roles = useRoles(canReadRoles);
  const assign = useAssignRoles(user.id);
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assignedIds = useMemo(() => {
    const byName = new Map((roles.data ?? []).map((role) => [role.name, role.id]));
    return new Set(
      user.roles.map((name) => byName.get(name)).filter((id): id is string => id !== undefined),
    );
  }, [roles.data, user.roles]);

  const selectedIds = draft ?? assignedIds;
  const dirty =
    draft !== null &&
    (draft.size !== assignedIds.size || [...draft].some((id) => !assignedIds.has(id)));

  const selectedRoles = (roles.data ?? []).filter((role) => selectedIds.has(role.id));
  const preview = effectivePermissions(selectedRoles);
  const available = useMemo(() => {
    const union = new Set<string>();
    for (const role of roles.data ?? [])
      for (const permission of role.permissions) union.add(permission);
    return [...union];
  }, [roles.data]);

  if (!canReadRoles) {
    return (
      <Card>
        <CardHeader title="Roles" description="Role names as reported by the user record." />
        <div className="flex flex-wrap gap-1.5">
          {user.roles.length === 0 ? (
            <span className="text-sm text-fg-muted">No roles assigned.</span>
          ) : null}
          {user.roles.map((role) => (
            <Badge key={role} tone="brand">
              {role}
            </Badge>
          ))}
        </div>
        <p className="mt-3 text-xs text-fg-subtle">
          You need <code className="font-mono">roles:read</code> to see role permissions.
        </p>
      </Card>
    );
  }

  const save = () => {
    if (!draft) return;
    setError(null);
    assign.mutate(
      { roleIds: [...draft] },
      {
        onSuccess: () => setDraft(null),
        onError: (mutationError) => setError(mutationError.message),
      },
    );
  };

  return (
    <Card>
      <CardHeader
        title="Roles"
        description={
          canAssign
            ? 'Tick the roles this user should hold. The preview shows the resulting permissions.'
            : 'Read-only: you need roles:assign to change assignments.'
        }
        action={
          canAssign ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={!dirty || assign.isPending}
                onClick={() => setDraft(null)}
              >
                Reset
              </Button>
              <Button
                size="sm"
                disabled={!dirty}
                loading={assign.isPending}
                loadingLabel="Saving"
                onClick={save}
              >
                Save roles
              </Button>
            </>
          ) : undefined
        }
      />
      {error ? (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      ) : null}
      {roles.isPending ? (
        <LoadingState label="Loading roles…" />
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
      ) : (
        <div className="space-y-5">
          <fieldset className="grid gap-2 sm:grid-cols-2" disabled={!canAssign || assign.isPending}>
            <legend className="sr-only">Assigned roles</legend>
            {roles.data
              .filter((role) => (user.realm === 'ADMIN' ? role.name !== 'CUSTOMER' : true))
              .map((role) => (
                <CheckboxField
                  key={role.id}
                  label={
                    <span className="inline-flex items-center gap-2">
                      {role.name}
                      {role.isSystem ? <Badge tone="neutral">Built-in</Badge> : null}
                    </span>
                  }
                  description={role.description ?? `${role.permissions.length} permissions`}
                  checked={selectedIds.has(role.id)}
                  onChange={(event) => {
                    const next = new Set(selectedIds);
                    if (event.target.checked) next.add(role.id);
                    else next.delete(role.id);
                    setDraft(next);
                  }}
                />
              ))}
          </fieldset>
          <div>
            <p className="mb-2 text-sm font-medium text-fg">
              Effective permissions{' '}
              <span className="text-xs font-normal text-fg-subtle">
                ({preview.length}
                {dirty ? ', unsaved' : ''})
              </span>
            </p>
            <PermissionMatrix
              available={available}
              selected={new Set(preview)}
              readOnly
              caption="Effective permissions preview"
            />
          </div>
        </div>
      )}
    </Card>
  );
}

// --- Recent audit -----------------------------------------------------------------------------

type AuditScope = 'about' | 'by';

function RecentAuditCard({ user }: { user: UserProfile }) {
  const { can } = useSession();
  const canAudit = can('audit:read');
  const [scope, setScope] = useState<AuditScope>('about');
  const params =
    scope === 'about'
      ? { page: 1, pageSize: 10, resource: 'User', resourceId: user.id }
      : { page: 1, pageSize: 10, actorId: user.id };
  const audit = useAuditLog(params, canAudit);

  return (
    <Card>
      <CardHeader
        title="Recent activity"
        action={
          canAudit ? (
            <Link
              href={`${PAGES.audit}?${scope === 'about' ? `resource=User&resourceId=${user.id}` : `actorId=${user.id}`}`}
              className={buttonClasses('ghost', 'sm')}
            >
              Open in audit log
            </Link>
          ) : undefined
        }
      />
      {!canAudit ? (
        <p className="text-sm text-fg-muted">
          You need <code className="font-mono text-xs">audit:read</code> to see activity.
        </p>
      ) : (
        <>
          <div
            role="group"
            aria-label="Activity scope"
            className="mb-3 inline-flex rounded-lg border border-border p-0.5 text-xs"
          >
            {(
              [
                ['about', 'Changes to this user'],
                ['by', 'Actions by this user'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={scope === key}
                onClick={() => setScope(key)}
                className={`rounded-md px-2.5 py-1 font-medium ${scope === key ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {audit.isPending ? (
            <LoadingState label="Loading activity…" />
          ) : audit.isError ? (
            <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
          ) : (
            <TableContainer className="border-0">
              <Table caption="Most recent audit entries">
                <THead>
                  <tr>
                    <Th>Action</Th>
                    <Th>Outcome</Th>
                    <Th>When</Th>
                  </tr>
                </THead>
                <TBody>
                  {audit.data.data.length === 0 ? (
                    <TableEmptyRow colSpan={3}>No activity recorded.</TableEmptyRow>
                  ) : (
                    audit.data.data.map((entry) => (
                      <Tr key={entry.id}>
                        <Td>
                          <code className="font-mono text-xs">{entry.action}</code>
                          {scope === 'about' && entry.actorEmail ? (
                            <span className="block truncate text-xs text-fg-subtle">
                              by {entry.actorEmail}
                            </span>
                          ) : null}
                          {scope === 'by' ? (
                            <span className="block truncate text-xs text-fg-subtle">
                              {entry.resource}
                              {entry.resourceId ? ` · ${entry.resourceId.slice(0, 8)}…` : ''}
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          <Badge
                            tone={
                              entry.outcome === 'SUCCESS'
                                ? 'success'
                                : entry.outcome === 'DENIED'
                                  ? 'warning'
                                  : 'danger'
                            }
                          >
                            {humanizeEnum(entry.outcome)}
                          </Badge>
                        </Td>
                        <Td className="text-fg-muted whitespace-nowrap">
                          {formatRelative(entry.createdAt)}
                        </Td>
                      </Tr>
                    ))
                  )}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}
    </Card>
  );
}
