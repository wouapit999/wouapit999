'use client';

import { USER_REALMS, USER_STATUSES } from '@bi-rem/shared/constants';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useCan } from '@/components/shell/session-provider';
import { Alert } from '@/components/ui/alert';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { INPUT_CLASSES } from '@/components/ui/field';
import { Icon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { ErrorState, Skeleton } from '@/components/ui/states';
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
import type { ListUsersParams } from '@/lib/api';
import { formatRelative, fullName, humanizeEnum } from '@/lib/format';
import { useUsers } from '@/lib/queries';
import { PAGES } from '@/lib/routes';

import { CreateUserDialog } from './create-user-dialog';
import { UserStatusActions } from './user-status-actions';

const PAGE_SIZE = 20;
const COLUMNS = 7;

function readParams(searchParams: URLSearchParams): ListUsersParams {
  const page = Number(searchParams.get('page') ?? '1');
  const realm = searchParams.get('realm') ?? '';
  const status = searchParams.get('status') ?? '';
  const search = searchParams.get('search') ?? '';
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZE,
    ...(search ? { search } : {}),
    ...((USER_REALMS as readonly string[]).includes(realm) ? { realm } : {}),
    ...((USER_STATUSES as readonly string[]).includes(status) ? { status } : {}),
  };
}

export function UsersView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = readParams(new URLSearchParams(searchParams.toString()));
  const canWrite = useCan('users:write');

  const [searchInput, setSearchInput] = useState(params.search ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const users = useUsers(params);

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || (key === 'page' && value === 1)) next.delete(key);
      else next.set(key, String(value));
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  // Debounce free-text search into the URL so back/forward and sharing keep the filter.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === (params.search ?? '')) return;
    const timer = window.setTimeout(() => update({ search: trimmed, page: 1 }), 350);
    return () => window.clearTimeout(timer);
    // `update` closes over router/pathname/searchParams which only change with the URL itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, params.search]);

  return (
    <>
      <PageHeader
        title="Users"
        description="Customers and administrators across both realms. Suspending blocks sign-in immediately."
        actions={
          canWrite ? (
            <Button
              onClick={() => setCreateOpen(true)}
              leadingIcon={<Icon name="plus" className="h-4 w-4" />}
            >
              Create user
            </Button>
          ) : undefined
        }
      />

      <form
        role="search"
        aria-label="Filter users"
        className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          update({ search: searchInput.trim(), page: 1 });
        }}
      >
        <div className="relative">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-fg-subtle"
          />
          <label htmlFor="users-search" className="sr-only">
            Search by name or email
          </label>
          <input
            id="users-search"
            type="search"
            placeholder="Search by name or email…"
            className={`${INPUT_CLASSES} pl-9`}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="users-realm" className="sr-only">
            Realm
          </label>
          <select
            id="users-realm"
            className={`${INPUT_CLASSES} sm:w-44`}
            value={params.realm ?? ''}
            onChange={(event) => update({ realm: event.target.value, page: 1 })}
          >
            <option value="">All realms</option>
            {USER_REALMS.map((realm) => (
              <option key={realm} value={realm}>
                {humanizeEnum(realm)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="users-status" className="sr-only">
            Status
          </label>
          <select
            id="users-status"
            className={`${INPUT_CLASSES} sm:w-52`}
            value={params.status ?? ''}
            onChange={(event) => update({ status: event.target.value, page: 1 })}
          >
            <option value="">All statuses</option>
            {USER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {humanizeEnum(status)}
              </option>
            ))}
          </select>
        </div>
      </form>

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

      {users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <>
          <TableContainer aria-busy={users.isFetching}>
            <Table caption="Users matching the current filters">
              <THead>
                <tr>
                  <Th>User</Th>
                  <Th>Realm</Th>
                  <Th>Status</Th>
                  <Th>Roles</Th>
                  <Th>MFA</Th>
                  <Th>Last sign-in</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </THead>
              <TBody>
                {users.isPending ? (
                  Array.from({ length: 6 }, (_, index) => (
                    <tr key={index}>
                      <td colSpan={COLUMNS} className="px-4 py-3">
                        <Skeleton className="h-6 w-full" />
                      </td>
                    </tr>
                  ))
                ) : users.data.data.length === 0 ? (
                  <TableEmptyRow colSpan={COLUMNS}>No users match these filters.</TableEmptyRow>
                ) : (
                  users.data.data.map((user) => (
                    <Tr key={user.id}>
                      <Td>
                        <Link href={PAGES.user(user.id)} className="block min-w-0 rounded">
                          <span className="block truncate font-medium text-fg">
                            {fullName(user) || '—'}
                          </span>
                          <span className="block truncate text-xs text-fg-muted">{user.email}</span>
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={user.realm === 'ADMIN' ? 'gold' : 'neutral'}>
                          {humanizeEnum(user.realm)}
                        </Badge>
                      </Td>
                      <Td>
                        <Badge tone={statusTone(user.status)} dot>
                          {humanizeEnum(user.status)}
                        </Badge>
                      </Td>
                      <Td className="max-w-56">
                        <span className="flex flex-wrap gap-1">
                          {user.roles.length === 0 ? (
                            <span className="text-xs text-fg-subtle">None</span>
                          ) : (
                            user.roles.map((role) => (
                              <Badge key={role} tone="brand">
                                {role}
                              </Badge>
                            ))
                          )}
                        </span>
                      </Td>
                      <Td>
                        {user.mfaEnabled ? (
                          <Badge tone="success">On</Badge>
                        ) : (
                          <Badge tone="neutral">Off</Badge>
                        )}
                      </Td>
                      <Td className="text-fg-muted whitespace-nowrap">
                        {formatRelative(user.lastLoginAt)}
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end gap-2">
                          <UserStatusActions user={user} size="xs" onError={setActionError} />
                          <Link href={PAGES.user(user.id)} className={buttonClasses('ghost', 'xs')}>
                            View
                          </Link>
                        </div>
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </TableContainer>
          {users.data ? (
            <Pagination
              meta={users.data.meta}
              itemLabel="users"
              onPageChange={(page) => update({ page })}
            />
          ) : null}
        </>
      )}

      {canWrite ? (
        <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      ) : null}
    </>
  );
}
