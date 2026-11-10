import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { FilterBar } from '@/components/admin/filter-bar';
import {
  type SearchParams,
  countryParam,
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
import {
  Card,
  EmptyState,
  Input,
  Money,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatDateTime, humanize } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { listProviders } from '@/server/connectors';
import { listCountries } from '@/server/countries';
import { STAFF_ROLES } from '@/server/rbac';
import { listTransfers } from '@/server/transfers';

export const metadata: Metadata = { title: 'Transfers' };

const STATUSES = ['PROCESSING', 'ON_HOLD', 'COMPLETED', 'FAILED', 'REJECTED', 'REVERSED'] as const;
const TYPES = ['W2W', 'W2M', 'W2A', 'INTERNATIONAL', 'TOPUP'] as const;
const TYPE_LABELS: Record<(typeof TYPES)[number], string> = {
  W2W: 'Wallet to wallet',
  W2M: 'Merchant payment',
  W2A: 'Agent cash-out',
  INTERNATIONAL: 'International',
  TOPUP: 'Top-up',
};

const querySchema = z.object({
  q: textParam,
  status: enumParam(STATUSES),
  type: enumParam(TYPES),
  from: dateParam,
  to: dateParam,
  source: countryParam,
  target: countryParam,
  provider: uuidParam,
  user: uuidParam,
  partner: uuidParam,
  page: pageParam,
});

/** Transfer monitor: every money movement, filterable, newest first. */
export default async function TransfersPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx } = await getPageContext(...STAFF_ROLES);
  const query = querySchema.parse(flattenParams(await searchParams));
  const [result, countries, providers] = await Promise.all([
    listTransfers(ctx, {
      search: query.q,
      status: query.status,
      type: query.type,
      from: dayStart(query.from),
      to: dayEnd(query.to),
      sourceCountry: query.source,
      targetCountry: query.target,
      providerId: query.provider,
      userId: query.user,
      partnerId: query.partner,
      page: query.page,
      pageSize: 25,
    }),
    listCountries(),
    listProviders(ctx),
  ]);
  const { page: _page, ...filters } = query;
  const filtered = Object.values(filters).some(Boolean);
  const countryOptions = countries.map((country) => ({
    value: country.code,
    label: `${country.name} (${country.code})`,
  }));

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Monitor every transfer and top-up. Open one to see its timeline, the ledger journals behind it and — if you are allowed — reverse it."
      />
      <Card>
        <FilterBar action="/admin/transfers" hidden={{ user: query.user, partner: query.partner }}>
          <Input
            name="q"
            type="search"
            label="Reference, name or account"
            defaultValue={query.q}
            placeholder="BR-…, Amina, +2376…"
          />
          <Select
            name="status"
            label="Status"
            placeholder="Any status"
            defaultValue={query.status}
            options={enumOptions(STATUSES, humanize)}
          />
          <Select
            name="type"
            label="Type"
            placeholder="Any type"
            defaultValue={query.type}
            options={TYPES.map((type) => ({ value: type, label: TYPE_LABELS[type] }))}
          />
          <Select
            name="provider"
            label="Provider"
            placeholder="Any provider"
            defaultValue={query.provider}
            options={providers.map((provider) => ({ value: provider.id, label: provider.name }))}
          />
          <Select
            name="source"
            label="From country"
            placeholder="Any country"
            defaultValue={query.source}
            options={countryOptions}
          />
          <Select
            name="target"
            label="To country"
            placeholder="Any country"
            defaultValue={query.target}
            options={countryOptions}
          />
          <Input name="from" type="date" label="From date" defaultValue={query.from} />
          <Input name="to" type="date" label="To date" defaultValue={query.to} />
        </FilterBar>

        {query.user || query.partner ? (
          <p className="px-5 pt-3 text-sm text-fg-muted sm:px-6">
            Showing the transfers of one {query.user ? 'customer' : 'partner'}.{' '}
            <Link href="/admin/transfers" className="font-medium text-accent underline">
              Show all
            </Link>
          </p>
        ) : null}

        {result.items.length === 0 ? (
          <EmptyState
            title={filtered ? 'No transfer matches these filters' : 'No transfers yet'}
            description={filtered ? 'Widen the date range or remove a filter.' : undefined}
          />
        ) : (
          <>
            <p className="px-5 pt-3 text-sm text-fg-muted sm:px-6" role="status">
              {result.total} transfer{result.total === 1 ? '' : 's'}
            </p>
            <Table caption="Transfers">
              <THead>
                <Tr>
                  <Th>Reference</Th>
                  <Th>Sender</Th>
                  <Th>Recipient</Th>
                  <Th>Route</Th>
                  <Th align="right">Sent</Th>
                  <Th align="right">Received</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                </Tr>
              </THead>
              <TBody>
                {result.items.map((transfer) => (
                  <Tr key={transfer.id}>
                    <Td>
                      <Link
                        href={`/admin/transfers/${transfer.id}`}
                        className="tabular font-medium text-fg underline-offset-2 hover:underline"
                      >
                        {transfer.reference}
                      </Link>
                      <p className="text-xs text-fg-subtle">{TYPE_LABELS[transfer.type]}</p>
                    </Td>
                    <Td>{transfer.senderName}</Td>
                    <Td>
                      {transfer.recipientName}
                      <p className="tabular text-xs text-fg-subtle">{transfer.recipientAccount}</p>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {transfer.sourceCountry} → {transfer.targetCountry}
                      <p className="text-xs text-fg-subtle">{humanize(transfer.deliveryMethod)}</p>
                    </Td>
                    <Td align="right">
                      <Money amount={transfer.sendAmount} currency={transfer.sourceCurrency} />
                    </Td>
                    <Td align="right">
                      <Money amount={transfer.receiveAmount} currency={transfer.targetCurrency} />
                    </Td>
                    <Td>
                      <StatusBadge
                        status={transfer.status}
                        label={
                          transfer.status === 'ON_HOLD'
                            ? 'On hold'
                            : transfer.status === 'REJECTED'
                              ? 'Rejected'
                              : undefined
                        }
                      />
                    </Td>
                    <Td className="whitespace-nowrap">{formatDateTime(transfer.createdAt)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              hrefFor={(page) => hrefWith('/admin/transfers', { ...filters, page })}
            />
          </>
        )}
      </Card>
    </>
  );
}
