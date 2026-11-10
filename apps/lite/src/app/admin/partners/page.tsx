import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { FilterBar, Tabs } from '@/components/admin/filter-bar';
import {
  type SearchParams,
  enumOptions,
  enumParam,
  flattenParams,
  hrefWith,
  pageParam,
  textParam,
} from '@/components/admin/helpers';
import {
  ActionForm,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FormMessage,
  Input,
  LinkButton,
  Money,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  SubmitButton,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatBps, formatDate, formatDateTime, humanize } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { PARTNER_TYPES, listPartners, listSettlements } from '@/server/partners';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';

import { reviewPartnerAction } from './actions';

export const metadata: Metadata = { title: 'Partners' };

const STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'] as const;
const querySchema = z.object({
  tab: enumParam(['directory', 'applications', 'settlements']),
  q: textParam,
  type: enumParam(PARTNER_TYPES),
  status: enumParam(STATUSES),
  page: pageParam,
});

const statusLabel = (status: string): string | undefined =>
  status === 'REJECTED' ? 'Rejected' : undefined;

/** Partners, merchants and agents (phase 9): applications, directory and settlements. */
export default async function PartnersPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const query = querySchema.parse(flattenParams(await searchParams));
  const tab = query.tab ?? 'directory';
  const canWrite = roleHasPermission(user.role, 'partners:write');
  const [applications, directory, settlements] = await Promise.all([
    listPartners(ctx, { status: 'PENDING', pageSize: 50 }),
    tab === 'directory'
      ? listPartners(ctx, {
          search: query.q,
          type: query.type,
          status: query.status,
          page: query.page,
          pageSize: 20,
        })
      : null,
    tab === 'settlements' ? listSettlements(ctx, { limit: 100 }) : null,
  ]);

  return (
    <>
      <PageHeader
        title="Partners"
        description="Partners integrate over the API, merchants accept payments and agents cash customers in and out. Each earns a commission, accrued on every transfer and paid by settlement."
        actions={
          canWrite ? <LinkButton href="/admin/partners/new">Onboard partner</LinkButton> : undefined
        }
      />
      <Tabs
        label="Partner sections"
        active={tab}
        tabs={[
          { key: 'directory', label: 'Directory', href: '/admin/partners' },
          {
            key: 'applications',
            label: 'Applications',
            href: '/admin/partners?tab=applications',
            count: applications.total,
          },
          { key: 'settlements', label: 'Settlements', href: '/admin/partners?tab=settlements' },
        ]}
      />

      {tab === 'applications' ? (
        applications.items.length === 0 ? (
          <Card>
            <EmptyState
              title="No application is waiting"
              description="Self-serve applications from the public “Become a partner” form appear here."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {applications.items.map((partner) => (
              <Card key={partner.id} data-application={partner.code}>
                <CardHeader
                  title={partner.name}
                  description={`${humanize(partner.type)} · ${partner.countryCode} · ${partner.currency} · applied ${formatDate(partner.createdAt)}`}
                  action={<StatusBadge status={partner.status} />}
                />
                <CardBody className="space-y-4">
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-fg-muted">Legal name</dt>
                      <dd className="text-fg">{partner.legalName ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Contact</dt>
                      <dd className="break-all text-fg">{partner.contactEmail}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Phone</dt>
                      <dd className="text-fg">{partner.contactPhone ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Website</dt>
                      <dd className="break-all text-fg">{partner.website ?? '—'}</dd>
                    </div>
                  </dl>
                  {partner.description ? (
                    <p className="text-sm text-fg-muted">{partner.description}</p>
                  ) : null}
                  {canWrite ? (
                    <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
                      <ActionForm action={reviewPartnerAction} className="space-y-3">
                        <input type="hidden" name="partnerId" value={partner.id} />
                        <input type="hidden" name="decision" value="APPROVE" />
                        <Input
                          name="commissionBps"
                          type="number"
                          label="Commission (bps)"
                          hint="30 bps = 0.30% of each transfer"
                          min={0}
                          max={1000}
                          defaultValue={partner.commissionBps}
                        />
                        <FormMessage />
                        <SubmitButton size="sm" pendingLabel="Approving…">
                          Approve
                        </SubmitButton>
                      </ActionForm>
                      <ActionForm action={reviewPartnerAction} className="space-y-3">
                        <input type="hidden" name="partnerId" value={partner.id} />
                        <input type="hidden" name="decision" value="REJECT" />
                        <Input
                          name="note"
                          label="Reason (sent to the applicant)"
                          required
                          maxLength={1000}
                        />
                        <FormMessage />
                        <SubmitButton size="sm" variant="danger" pendingLabel="Rejecting…">
                          Reject
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'directory' && directory ? (
        <Card>
          <FilterBar action="/admin/partners">
            <Input name="q" type="search" label="Name, code or e-mail" defaultValue={query.q} />
            <Select
              name="type"
              label="Type"
              placeholder="Any type"
              defaultValue={query.type}
              options={enumOptions(PARTNER_TYPES, humanize)}
            />
            <Select
              name="status"
              label="Status"
              placeholder="Any status"
              defaultValue={query.status}
              options={enumOptions(STATUSES, (value) => statusLabel(value) ?? humanize(value))}
            />
          </FilterBar>
          {directory.items.length === 0 ? (
            <EmptyState title="No partner matches these filters" />
          ) : (
            <>
              <Table caption="Partner directory">
                <THead>
                  <Tr>
                    <Th>Partner</Th>
                    <Th>Type</Th>
                    <Th>Country</Th>
                    <Th align="right">Commission</Th>
                    <Th>Status</Th>
                    <Th>Since</Th>
                  </Tr>
                </THead>
                <TBody>
                  {directory.items.map((partner) => (
                    <Tr key={partner.id}>
                      <Td>
                        <Link
                          href={`/admin/partners/${partner.id}`}
                          className="font-medium text-fg underline-offset-2 hover:underline"
                        >
                          {partner.name}
                        </Link>
                        <p className="tabular text-xs text-fg-subtle">{partner.code}</p>
                      </Td>
                      <Td>
                        <Badge tone="brand">{humanize(partner.type)}</Badge>
                      </Td>
                      <Td>
                        {partner.countryCode}{' '}
                        <span className="text-xs text-fg-muted">{partner.currency}</span>
                      </Td>
                      <Td align="right">
                        {formatBps(partner.commissionBps)}
                        <span className="sr-only"> ({partner.commissionBps} basis points)</span>
                      </Td>
                      <Td>
                        <StatusBadge status={partner.status} label={statusLabel(partner.status)} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {formatDate(partner.approvedAt ?? partner.createdAt)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={directory.page}
                pageSize={directory.pageSize}
                total={directory.total}
                hrefFor={(page) =>
                  hrefWith('/admin/partners', {
                    q: query.q,
                    type: query.type,
                    status: query.status,
                    page,
                  })
                }
              />
            </>
          )}
        </Card>
      ) : null}

      {tab === 'settlements' && settlements ? (
        <Card>
          <CardHeader
            title="Commission settlements"
            description="A settlement run pays a partner's accrued commission into its wallet and is recorded as paid in the same ledger transaction. Run one from the partner's page."
          />
          {settlements.length === 0 ? (
            <EmptyState title="No settlement yet" />
          ) : (
            <Table caption="Commission settlements">
              <THead>
                <Tr>
                  <Th>Reference</Th>
                  <Th>Partner</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Commissions</Th>
                  <Th>Period</Th>
                  <Th>Status</Th>
                  <Th>Paid</Th>
                </Tr>
              </THead>
              <TBody>
                {settlements.map((settlement) => (
                  <Tr key={settlement.id}>
                    <Td className="tabular font-medium">{settlement.reference}</Td>
                    <Td>
                      <Link href={`/admin/partners/${settlement.partner.id}`} className="underline">
                        {settlement.partner.name}
                      </Link>
                    </Td>
                    <Td align="right">
                      <Money amount={settlement.amount} currency={settlement.currency} />
                    </Td>
                    <Td align="right">{settlement.commissionCount}</Td>
                    <Td className="whitespace-nowrap">
                      {formatDate(settlement.periodStart)} – {formatDate(settlement.periodEnd)}
                    </Td>
                    <Td>
                      <StatusBadge status={settlement.status} />
                    </Td>
                    <Td className="whitespace-nowrap">{formatDateTime(settlement.paidAt)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      ) : null}
    </>
  );
}
