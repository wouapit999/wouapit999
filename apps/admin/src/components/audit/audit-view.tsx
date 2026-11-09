'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useSearchParams } from 'next/navigation';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/field';
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
import type { AuditQueryParams } from '@/lib/api';
import { formatWhen, humanizeEnum, localInputToIso } from '@/lib/format';
import { useAuditLog } from '@/lib/queries';
import { type AuditEntry, type AuditFilterValues, auditFilterSchema } from '@/lib/schemas';

import { JsonDiffViewer } from './json-diff-viewer';

const PAGE_SIZE = 25;
const COLUMNS = 6;

function toParams(values: AuditFilterValues, page: number): AuditQueryParams {
  return {
    page,
    pageSize: PAGE_SIZE,
    ...(values.actorId ? { actorId: values.actorId } : {}),
    ...(values.resource ? { resource: values.resource } : {}),
    ...(values.resourceId ? { resourceId: values.resourceId } : {}),
    ...(values.action ? { action: values.action } : {}),
    ...(localInputToIso(values.from) ? { from: localInputToIso(values.from) } : {}),
    ...(localInputToIso(values.to) ? { to: localInputToIso(values.to) } : {}),
  };
}

function outcomeTone(outcome: AuditEntry['outcome']) {
  return outcome === 'SUCCESS' ? 'success' : outcome === 'DENIED' ? 'warning' : 'danger';
}

export function AuditView() {
  const searchParams = useSearchParams();
  const initial: AuditFilterValues = {
    actorId: searchParams.get('actorId') ?? '',
    resource: searchParams.get('resource') ?? '',
    resourceId: searchParams.get('resourceId') ?? '',
    action: searchParams.get('action') ?? '',
    from: '',
    to: '',
  };
  const [applied, setApplied] = useState<AuditQueryParams>(() => toParams(initial, 1));
  const [expanded, setExpanded] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AuditFilterValues>({
    resolver: zodResolver(auditFilterSchema),
    defaultValues: initial,
  });

  const audit = useAuditLog(applied);

  const apply = handleSubmit((values) => {
    setExpanded(null);
    setApplied(toParams(values, 1));
  });

  const clear = () => {
    const empty: AuditFilterValues = {
      actorId: '',
      resource: '',
      resourceId: '',
      action: '',
      from: '',
      to: '',
    };
    reset(empty);
    setExpanded(null);
    setApplied(toParams(empty, 1));
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every mutating request, with actor, outcome and a before/after snapshot of the resource."
      />
      <Card className="mb-4">
        <form
          onSubmit={apply}
          noValidate
          aria-label="Filter audit log"
          className="grid gap-3 md:grid-cols-3 xl:grid-cols-6"
        >
          <TextField
            label="Actor user id"
            placeholder="UUID"
            className="font-mono text-xs"
            error={errors.actorId?.message}
            {...register('actorId')}
          />
          <TextField
            label="Resource type"
            placeholder="User, Role, Setting…"
            error={errors.resource?.message}
            {...register('resource')}
          />
          <TextField
            label="Resource id"
            placeholder="UUID or key"
            className="font-mono text-xs"
            error={errors.resourceId?.message}
            {...register('resourceId')}
          />
          <TextField
            label="Action"
            placeholder="users.update"
            className="font-mono text-xs"
            error={errors.action?.message}
            {...register('action')}
          />
          <TextField
            label="From"
            type="datetime-local"
            error={errors.from?.message}
            {...register('from')}
          />
          <TextField
            label="To"
            type="datetime-local"
            error={errors.to?.message}
            {...register('to')}
          />
          <div className="flex items-center gap-2 md:col-span-3 xl:col-span-6">
            <Button
              type="submit"
              size="sm"
              leadingIcon={<Icon name="search" className="h-4 w-4" />}
            >
              Apply filters
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              Clear
            </Button>
            {audit.isFetching && !audit.isPending ? (
              <span className="text-xs text-fg-subtle">Refreshing…</span>
            ) : null}
          </div>
        </form>
      </Card>

      {audit.isError ? (
        <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
      ) : (
        <>
          <TableContainer aria-busy={audit.isFetching}>
            <Table caption="Audit log entries">
              <THead>
                <tr>
                  <Th className="w-8">
                    <span className="sr-only">Expand</span>
                  </Th>
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Resource</Th>
                  <Th>Outcome</Th>
                </tr>
              </THead>
              <TBody>
                {audit.isPending ? (
                  Array.from({ length: 8 }, (_, index) => (
                    <tr key={index}>
                      <td colSpan={COLUMNS} className="px-4 py-3">
                        <Skeleton className="h-5 w-full" />
                      </td>
                    </tr>
                  ))
                ) : audit.data.data.length === 0 ? (
                  <TableEmptyRow colSpan={COLUMNS}>
                    No audit entries match these filters.
                  </TableEmptyRow>
                ) : (
                  audit.data.data.map((entry) => {
                    const open = expanded === entry.id;
                    const detailId = `audit-detail-${entry.id}`;
                    return (
                      <Fragment key={entry.id}>
                        <Tr className={open ? 'bg-surface-muted/60' : undefined}>
                          <Td className="py-2">
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-controls={detailId}
                              aria-label={open ? 'Collapse entry' : 'Expand entry'}
                              onClick={() => setExpanded(open ? null : entry.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
                            >
                              <Icon
                                name={open ? 'chevronDown' : 'chevronRight'}
                                className="h-4 w-4"
                              />
                            </button>
                          </Td>
                          <Td className="text-fg-muted whitespace-nowrap">
                            {formatWhen(entry.createdAt)}
                          </Td>
                          <Td className="max-w-56">
                            {entry.actorEmail ? (
                              <>
                                <span className="block truncate text-fg">{entry.actorEmail}</span>
                                {entry.actorRealm ? (
                                  <span className="text-xs text-fg-subtle">
                                    {humanizeEnum(entry.actorRealm)}
                                  </span>
                                ) : null}
                              </>
                            ) : entry.actorType === 'API_KEY' ? (
                              <span className="inline-flex items-center gap-1 text-fg">
                                <Icon name="key" className="h-3.5 w-3.5" /> API key
                              </span>
                            ) : (
                              <span className="text-fg-subtle">System</span>
                            )}
                          </Td>
                          <Td>
                            <code className="font-mono text-xs">{entry.action}</code>
                          </Td>
                          <Td className="max-w-56">
                            <span className="text-fg">{entry.resource}</span>
                            {entry.resourceId ? (
                              <code
                                className="block truncate font-mono text-[11px] text-fg-subtle"
                                title={entry.resourceId}
                              >
                                {entry.resourceId}
                              </code>
                            ) : null}
                          </Td>
                          <Td>
                            <Badge tone={outcomeTone(entry.outcome)} dot>
                              {humanizeEnum(entry.outcome)}
                            </Badge>
                          </Td>
                        </Tr>
                        {open ? (
                          <tr id={detailId}>
                            <td colSpan={COLUMNS} className="bg-surface px-4 py-4 sm:px-6">
                              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
                                <JsonDiffViewer before={entry.before} after={entry.after} />
                                <dl className="space-y-2 text-xs">
                                  <div>
                                    <dt className="font-medium text-fg-subtle uppercase">
                                      Correlation id
                                    </dt>
                                    <dd className="font-mono break-all text-fg">
                                      {entry.correlationId ?? '—'}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="font-medium text-fg-subtle uppercase">
                                      IP address
                                    </dt>
                                    <dd className="font-mono text-fg">{entry.ip ?? '—'}</dd>
                                  </div>
                                  <div>
                                    <dt className="font-medium text-fg-subtle uppercase">
                                      User agent
                                    </dt>
                                    <dd className="break-words text-fg">
                                      {entry.userAgent ?? '—'}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="font-medium text-fg-subtle uppercase">
                                      Actor id
                                    </dt>
                                    <dd className="font-mono break-all text-fg">
                                      {entry.actorId ?? humanizeEnum(entry.actorType)}
                                    </dd>
                                  </div>
                                </dl>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </TBody>
            </Table>
          </TableContainer>
          {audit.data ? (
            <Pagination
              meta={audit.data.meta}
              itemLabel="entries"
              onPageChange={(page) => {
                setExpanded(null);
                setApplied((current) => ({ ...current, page }));
              }}
            />
          ) : null}
        </>
      )}
    </>
  );
}
