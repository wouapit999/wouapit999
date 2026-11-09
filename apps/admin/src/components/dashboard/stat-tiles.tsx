'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useSession } from '@/components/shell/session-provider';
import { Card } from '@/components/ui/card';
import { Icon, type IconName } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/states';
import { formatNumber } from '@/lib/format';
import { useAuditLog, useFeatureFlags, useRoles, useUsers } from '@/lib/queries';
import { PAGES } from '@/lib/routes';

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

function Tile({
  label,
  value,
  hint,
  icon,
  href,
  loading,
  locked,
  error,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: IconName;
  href: string;
  loading: boolean;
  locked: boolean;
  error: boolean;
}) {
  const body = (
    <Card className="h-full transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-fg-muted">{label}</p>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-fg">
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-fg tabular-nums">
        {locked ? (
          <span className="text-base font-medium text-fg-subtle">No access</span>
        ) : loading ? (
          <Skeleton className="h-9 w-20" />
        ) : error ? (
          <span className="text-base font-medium text-danger">Unavailable</span>
        ) : (
          value
        )}
      </div>
      {hint ? <p className="mt-1 text-xs text-fg-subtle">{hint}</p> : null}
    </Card>
  );
  return locked ? (
    <div aria-disabled="true">{body}</div>
  ) : (
    <Link href={href} className="block rounded-card">
      {body}
    </Link>
  );
}

/** Live counts from Phase 1 endpoints; each tile degrades to "No access" without permission. */
export function StatTiles() {
  const { can } = useSession();
  const canUsers = can('users:read');
  const canRoles = can('roles:read');
  const canFlags = can('feature-flags:read');
  const canAudit = can('audit:read');

  const users = useUsers({ page: 1, pageSize: 1 }, canUsers);
  const admins = useUsers({ page: 1, pageSize: 1, realm: 'ADMIN' }, canUsers);
  const roles = useRoles(canRoles);
  const flags = useFeatureFlags(canFlags);
  const audit = useAuditLog({ page: 1, pageSize: 1, from: startOfTodayIso() }, canAudit);

  const enabledFlags = flags.data?.filter((flag) => flag.enabled).length ?? 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label="Users"
        icon="users"
        href={PAGES.users}
        locked={!canUsers}
        loading={users.isPending}
        error={users.isError}
        value={users.data ? formatNumber(users.data.meta.totalItems) : '—'}
        hint={
          admins.data ? `${formatNumber(admins.data.meta.totalItems)} administrators` : undefined
        }
      />
      <Tile
        label="Roles"
        icon="shield"
        href={PAGES.roles}
        locked={!canRoles}
        loading={roles.isPending}
        error={roles.isError}
        value={roles.data ? formatNumber(roles.data.length) : '—'}
        hint={
          roles.data ? `${roles.data.filter((role) => role.isSystem).length} built-in` : undefined
        }
      />
      <Tile
        label="Feature flags on"
        icon="flag"
        href={PAGES.settings}
        locked={!canFlags}
        loading={flags.isPending}
        error={flags.isError}
        value={flags.data ? `${enabledFlags}/${flags.data.length}` : '—'}
        hint="Enabled across both realms"
      />
      <Tile
        label="Audit events today"
        icon="scroll"
        href={PAGES.audit}
        locked={!canAudit}
        loading={audit.isPending}
        error={audit.isError}
        value={audit.data ? formatNumber(audit.data.meta.totalItems) : '—'}
        hint="Since 00:00 UTC"
      />
    </div>
  );
}
