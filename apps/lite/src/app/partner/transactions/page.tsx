import type { Metadata } from 'next';
import { z } from 'zod';

import { TransactionsTable } from '@/components/partner/transactions-table';
import {
  Card,
  CardHeader,
  EmptyState,
  Input,
  LinkButton,
  PageHeader,
  Pagination,
  Select,
  buttonClasses,
} from '@/components/ui';
import { listMyTransfers } from '@/server/transfers';

import {
  TRANSFER_STATUS_LABELS,
  TRANSFER_TYPE_LABELS,
  getPartnerPage,
  hrefWith,
} from '../_lib/partner';

export const metadata: Metadata = { title: 'Transactions' };

const STATUSES = ['PROCESSING', 'ON_HOLD', 'COMPLETED', 'FAILED', 'REJECTED', 'REVERSED'] as const;
const TYPES = ['W2W', 'W2M', 'W2A', 'INTERNATIONAL'] as const;
const day = z.iso.date();

// Search params come from the URL: anything unexpected is dropped, never trusted.
const querySchema = z.object({
  direction: z.enum(['sent', 'received']).optional().catch(undefined),
  status: z.enum(STATUSES).optional().catch(undefined),
  type: z.enum(TYPES).optional().catch(undefined),
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

const first = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value) || undefined;

export default async function PartnerTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx } = await getPartnerPage();
  const raw = await searchParams;
  const query = querySchema.parse({
    direction: first(raw.direction),
    status: first(raw.status),
    type: first(raw.type),
    from: first(raw.from),
    to: first(raw.to),
    page: first(raw.page) ?? 1,
  });
  const result = await listMyTransfers(ctx, {
    direction: query.direction,
    status: query.status,
    type: query.type,
    from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined,
    to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
    page: query.page,
    pageSize: 25,
  });
  const { page: _page, ...filters } = query;
  const filtered = Object.values(filters).some(Boolean);
  const hrefFor = (page: number) => hrefWith('/partner/transactions', { ...filters, page });

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Payments you received and transfers you sent — from the portal or through the API. Times are UTC."
      />

      <Card className="mb-4 p-4 sm:p-5">
        <form
          method="get"
          action="/partner/transactions"
          role="search"
          aria-label="Filter transactions"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Select
              name="direction"
              label="Direction"
              placeholder="Sent and received"
              defaultValue={query.direction ?? ''}
              options={[
                { value: 'received', label: 'Received' },
                { value: 'sent', label: 'Sent' },
              ]}
            />
            <Select
              name="status"
              label="Status"
              placeholder="Any status"
              defaultValue={query.status ?? ''}
              options={STATUSES.map((value) => ({
                value,
                label: TRANSFER_STATUS_LABELS[value] ?? value,
              }))}
            />
            <Select
              name="type"
              label="Type"
              placeholder="Any type"
              defaultValue={query.type ?? ''}
              options={TYPES.map((value) => ({
                value,
                label: TRANSFER_TYPE_LABELS[value] ?? value,
              }))}
            />
            <Input name="from" type="date" label="From" defaultValue={query.from ?? ''} />
            <Input name="to" type="date" label="To" defaultValue={query.to ?? ''} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" className={buttonClasses('primary', 'sm')}>
              Apply filters
            </button>
            {filtered ? (
              <LinkButton href="/partner/transactions" variant="ghost" size="sm">
                Clear
              </LinkButton>
            ) : null}
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title={filtered ? 'Matching transactions' : 'All transactions'}
          description={result.total === 1 ? '1 transaction' : `${result.total} transactions`}
        />
        {result.items.length === 0 ? (
          <EmptyState
            title={filtered ? 'Nothing matches these filters' : 'No transactions yet'}
            description={
              filtered
                ? 'Try a wider date range or clear the filters.'
                : 'Payments to your code and transfers sent through the API will appear here.'
            }
            action={
              filtered ? (
                <LinkButton href="/partner/transactions" variant="secondary">
                  Clear filters
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <TransactionsTable items={result.items} caption="Transactions" />
        )}
        <Pagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          hrefFor={hrefFor}
        />
      </Card>
    </>
  );
}
