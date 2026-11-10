import type { Metadata } from 'next';
import { z } from 'zod';

import { TransferList } from '@/components/customer/transfer-list';
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
import { getPageContext } from '@/server/auth/session';
import { listMyTransfers } from '@/server/transfers';

import { TRANSFER_STATUS_LABELS, TRANSFER_TYPE_LABELS, optionsFor } from '../_lib/labels';
import { type SearchParams, readSearchParams } from '../_lib/page';

export const metadata: Metadata = { title: 'Transfers' };

const STATUSES = ['PROCESSING', 'ON_HOLD', 'COMPLETED', 'FAILED', 'REJECTED', 'REVERSED'] as const;
const TYPES = ['W2W', 'W2M', 'W2A', 'INTERNATIONAL', 'TOPUP'] as const;
const PAGE_SIZE = 15;

const day = z.iso.date().optional().catch(undefined);

const querySchema = z.object({
  status: z.enum(STATUSES).optional().catch(undefined),
  type: z.enum(TYPES).optional().catch(undefined),
  direction: z.enum(['sent', 'received']).optional().catch(undefined),
  from: day,
  to: day,
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/** The customer's transfer history with filters and pagination. */
export default async function TransfersPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx } = await getPageContext('CUSTOMER');
  const query = querySchema.parse(await readSearchParams(searchParams));
  const result = await listMyTransfers(ctx, {
    status: query.status,
    type: query.type,
    direction: query.direction,
    from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined,
    to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
    page: query.page,
    pageSize: PAGE_SIZE,
  });

  const filters = {
    status: query.status,
    type: query.type,
    direction: query.direction,
    from: query.from,
    to: query.to,
  };
  const filtered = Object.values(filters).some(Boolean);
  const hrefFor = (page: number): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    if (page > 1) params.set('page', String(page));
    const text = params.toString();
    return text ? `/app/transfers?${text}` : '/app/transfers';
  };

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Everything you sent, received and topped up. Open a transfer to track it or get its receipt."
        actions={<LinkButton href="/app/send">Send money</LinkButton>}
      />

      <Card className="mb-4 p-4 sm:p-5">
        <form method="get" action="/app/transfers" role="search" aria-label="Filter transfers">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Select
              name="direction"
              label="Direction"
              placeholder="Sent and received"
              defaultValue={query.direction ?? ''}
              options={[
                { value: 'sent', label: 'Sent' },
                { value: 'received', label: 'Received' },
              ]}
            />
            <Select
              name="status"
              label="Status"
              placeholder="Any status"
              defaultValue={query.status ?? ''}
              options={optionsFor(STATUSES, TRANSFER_STATUS_LABELS)}
            />
            <Select
              name="type"
              label="Type"
              placeholder="Any type"
              defaultValue={query.type ?? ''}
              options={optionsFor(TYPES, TRANSFER_TYPE_LABELS)}
            />
            <Input name="from" type="date" label="From" defaultValue={query.from ?? ''} />
            <Input name="to" type="date" label="To" defaultValue={query.to ?? ''} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" className={buttonClasses('primary', 'sm')}>
              Apply filters
            </button>
            {filtered ? (
              <LinkButton href="/app/transfers" variant="ghost" size="sm">
                Clear
              </LinkButton>
            ) : null}
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title={filtered ? 'Matching transfers' : 'All transfers'}
          description={result.total === 1 ? '1 transfer' : `${result.total} transfers`}
        />
        {result.items.length === 0 ? (
          <EmptyState
            title={filtered ? 'Nothing matches these filters' : 'No transfers yet'}
            description={
              filtered
                ? 'Try a wider date range or clear the filters.'
                : 'Your transfers and top-ups will appear here.'
            }
            action={
              filtered ? (
                <LinkButton href="/app/transfers" variant="secondary">
                  Clear filters
                </LinkButton>
              ) : (
                <LinkButton href="/app/send">Send money</LinkButton>
              )
            }
          />
        ) : (
          <>
            <TransferList items={result.items} label="Transfers" />
            <div className="border-t border-border empty:hidden">
              <Pagination
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                hrefFor={hrefFor}
              />
            </div>
          </>
        )}
      </Card>
    </>
  );
}
