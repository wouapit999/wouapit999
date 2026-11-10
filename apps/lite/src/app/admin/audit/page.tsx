import type { Metadata } from 'next';
import { z } from 'zod';

import { FilterBar } from '@/components/admin/filter-bar';
import {
  type SearchParams,
  dateParam,
  dayEnd,
  dayStart,
  enumOptions,
  enumParam,
  flattenParams,
  hrefWith,
  pageParam,
  textParam,
  uuidParam,
} from '@/components/admin/helpers';
import { JsonView } from '@/components/admin/json-view';
import { ExportButtons } from '@/components/admin/export-buttons';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
} from '@/components/ui';
import { formatDateTime, humanize } from '@/lib/format';
import { listAuditLogs } from '@/server/audit';
import { getPageContext, requirePermission } from '@/server/auth/session';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';

export const metadata: Metadata = { title: 'Audit log' };

const OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
const RESOURCE_TYPES = [
  'user',
  'session',
  'kyc_case',
  'kyc_document',
  'transfer',
  'provider',
  'fee_rule',
  'fx_rate',
  'ledger_account',
  'aml_alert',
  'aml_case',
  'aml_rule',
  'sar_report',
  'sanctions_entry',
  'partner',
  'api_key',
  'webhook_endpoint',
  'settlement',
  'country',
  'setting',
  'report',
] as const;

const querySchema = z.object({
  action: textParam,
  resource: textParam,
  resourceId: textParam,
  actor: uuidParam,
  outcome: enumParam(OUTCOMES),
  from: dateParam,
  to: dateParam,
  page: pageParam,
});

/** Append-only audit trail: who did what, to what, from where — with before / after values. */
export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission('audit:read');
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const query = querySchema.parse(flattenParams(await searchParams));
  const result = await listAuditLogs(ctx, {
    action: query.action,
    resourceType: query.resource,
    resourceId: query.resourceId,
    actorId: query.actor,
    outcome: query.outcome,
    from: dayStart(query.from),
    to: dayEnd(query.to),
    page: query.page,
    pageSize: 30,
  });
  const { page: _page, ...filters } = query;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every mutation writes a row here inside the same database transaction as the change. Rows cannot be edited or deleted — the database rejects it. Sensitive values are redacted before they are stored."
      />
      <Card>
        <FilterBar action="/admin/audit" hidden={{ actor: query.actor }}>
          <Input
            name="action"
            type="search"
            label="Action contains"
            defaultValue={query.action}
            placeholder="transfer., kyc.review, fx_rate…"
          />
          <Select
            name="resource"
            label="Resource type"
            placeholder="Any resource"
            defaultValue={query.resource}
            options={enumOptions(RESOURCE_TYPES, humanize)}
          />
          <Input
            name="resourceId"
            label="Resource id"
            defaultValue={query.resourceId}
            placeholder="uuid, XAF/AOA, setting key…"
          />
          <Select
            name="outcome"
            label="Outcome"
            placeholder="Any outcome"
            defaultValue={query.outcome}
            options={enumOptions(OUTCOMES, humanize)}
          />
          <Input name="from" type="date" label="From date" defaultValue={query.from} />
          <Input name="to" type="date" label="To date" defaultValue={query.to} />
        </FilterBar>
        {query.actor ? (
          <p className="px-5 pt-3 text-sm text-fg-muted sm:px-6">
            Showing the actions of one actor.{' '}
            <a
              href={hrefWith('/admin/audit', { ...filters, actor: undefined })}
              className="underline"
            >
              Show all actors
            </a>
          </p>
        ) : null}
        {result.items.length === 0 ? (
          <EmptyState
            title={filtered ? 'No audit entry matches these filters' : 'The audit log is empty'}
          />
        ) : (
          <>
            <p className="px-5 pt-3 text-sm text-fg-muted sm:px-6" role="status">
              {result.total} entr{result.total === 1 ? 'y' : 'ies'}
            </p>
            <ul className="divide-y divide-border" aria-label="Audit entries">
              {result.items.map((row) => (
                <li key={row.id} className="px-5 py-3 sm:px-6" data-audit-action={row.action}>
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="tabular w-44 shrink-0 text-fg-muted">
                        {formatDateTime(row.createdAt)}
                      </span>
                      <code className="text-xs font-medium text-fg">{row.action}</code>
                      <span className="text-fg-muted">
                        {humanize(row.resourceType)}
                        {row.resourceId ? (
                          <span className="ml-1 font-mono text-xs">
                            {row.resourceId.length > 20
                              ? `${row.resourceId.slice(0, 8)}…`
                              : row.resourceId}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-fg">
                        {row.actorLabel ?? humanize(row.actorType)}
                        {row.actorRole ? (
                          <span className="text-xs text-fg-subtle">
                            {' '}
                            · {humanize(row.actorRole)}
                          </span>
                        ) : null}
                      </span>
                      <StatusBadge status={row.outcome} className="ml-auto" />
                    </summary>
                    <div className="mt-3 space-y-3 rounded-lg bg-surface-muted/50 p-3">
                      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                        <div className="flex gap-2">
                          <dt className="text-fg-subtle">Resource id</dt>
                          <dd className="break-all font-mono text-fg">{row.resourceId ?? '—'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-fg-subtle">Actor id</dt>
                          <dd className="break-all font-mono text-fg">
                            {row.actorId ? (
                              <a
                                href={hrefWith('/admin/audit', { actor: row.actorId })}
                                className="underline"
                              >
                                {row.actorId}
                              </a>
                            ) : (
                              '—'
                            )}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-fg-subtle">IP</dt>
                          <dd className="font-mono text-fg">{row.ip ?? '—'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-fg-subtle">Request id</dt>
                          <dd className="break-all font-mono text-fg">{row.requestId ?? '—'}</dd>
                        </div>
                        <div className="flex gap-2 sm:col-span-2">
                          <dt className="shrink-0 text-fg-subtle">User agent</dt>
                          <dd className="break-all text-fg">{row.userAgent ?? '—'}</dd>
                        </div>
                      </dl>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <JsonView label="Before" value={row.before} />
                        <JsonView label="After" value={row.after} />
                      </div>
                      <JsonView label="Metadata" value={row.metadata} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              hrefFor={(page) => hrefWith('/admin/audit', { ...filters, page })}
            />
          </>
        )}
      </Card>

      {roleHasPermission(user.role, 'reports:export') ? (
        <Card className="mt-5">
          <CardHeader
            title="Export"
            description="Audit log of the selected dates (last 30 days when no date is set)."
          />
          <CardBody className="py-2">
            <ExportButtons
              name="audit"
              label="Audit log"
              from={query.from && query.to ? query.from : undefined}
              to={query.from && query.to ? query.to : undefined}
              days={query.from && query.to ? undefined : 30}
            />
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
