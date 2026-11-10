import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import {
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  Money,
  PageHeader,
  Pagination,
  Stat,
  StatGrid,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatBps, formatDateTime } from '@/lib/format';
import { getCommissionSummary, listCommissions } from '@/server/partners';

import { TRANSFER_TYPE_LABELS, getPartnerPage, hrefWith } from '../_lib/partner';

export const metadata: Metadata = { title: 'Commissions' };

const STATUSES = ['ACCRUED', 'SETTLED', 'REVERSED'] as const;
const querySchema = z.object({
  status: z.enum(STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});
const first = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value) || undefined;

const FILTERS: ReadonlyArray<{ value: (typeof STATUSES)[number] | undefined; label: string }> = [
  { value: undefined, label: 'All' },
  { value: 'ACCRUED', label: 'Accrued' },
  { value: 'SETTLED', label: 'Settled' },
  { value: 'REVERSED', label: 'Reversed' },
];

/** Commission earned per transaction, and what is still payable. */
export default async function PartnerCommissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx, partner } = await getPartnerPage();
  const raw = await searchParams;
  const query = querySchema.parse({ status: first(raw.status), page: first(raw.page) ?? 1 });
  const [summary, result] = await Promise.all([
    getCommissionSummary(ctx),
    listCommissions(ctx, { status: query.status, page: query.page, pageSize: 25 }),
  ]);
  const rows =
    summary.length > 0
      ? summary
      : [
          {
            currency: partner.currency,
            accrued: 0n,
            accruedCount: 0,
            settled: 0n,
            settledCount: 0,
            reversed: 0n,
          },
        ];

  return (
    <>
      <PageHeader
        title="Commissions"
        description={`You earn ${formatBps(partner.commissionBps)} of every completed transaction that involves you. Commission accrues in the same database transaction as the transfer and is paid out by settlement.`}
        actions={
          <LinkButton href="/partner/settlements" variant="secondary" size="sm">
            Settlements
          </LinkButton>
        }
      />

      {rows.map((row) => (
        <StatGrid key={row.currency} className="mb-4 lg:grid-cols-3">
          <Stat
            label={`Accrued · ${row.currency}`}
            value={<Money amount={row.accrued} currency={row.currency} />}
            hint={`${row.accruedCount} transaction${row.accruedCount === 1 ? '' : 's'} awaiting settlement`}
            tone={row.accrued > 0n ? 'success' : 'default'}
          />
          <Stat
            label={`Settled · ${row.currency}`}
            value={<Money amount={row.settled} currency={row.currency} />}
            hint={`${row.settledCount} transaction${row.settledCount === 1 ? '' : 's'} paid to your wallet`}
          />
          <Stat
            label={`Reversed · ${row.currency}`}
            value={<Money amount={row.reversed} currency={row.currency} />}
            hint="Cancelled with a reversed transfer"
          />
        </StatGrid>
      ))}

      <Card>
        <CardHeader
          title="Commission lines"
          description={result.total === 1 ? '1 line' : `${result.total} lines`}
          action={
            <nav aria-label="Filter by status" className="flex flex-wrap gap-1">
              {FILTERS.map((filter) => {
                const active = filter.value === query.status;
                return (
                  <Link
                    key={filter.label}
                    href={hrefWith('/partner/commissions', { status: filter.value })}
                    aria-current={active ? 'true' : undefined}
                    className={
                      active
                        ? 'rounded-lg bg-accent-soft px-2.5 py-1 text-sm font-medium text-accent'
                        : 'rounded-lg px-2.5 py-1 text-sm font-medium text-fg-muted hover:bg-surface-muted hover:text-fg'
                    }
                  >
                    {filter.label}
                  </Link>
                );
              })}
            </nav>
          }
        />
        {result.items.length === 0 ? (
          <EmptyState
            title="No commission yet"
            description="A line is added each time a transaction that involves you completes."
          />
        ) : (
          <Table caption="Commission lines">
            <THead>
              <Tr>
                <Th>Date</Th>
                <Th>Transaction</Th>
                <Th>Type</Th>
                <Th align="right">Transaction amount</Th>
                <Th align="right">Rate</Th>
                <Th align="right">Commission</Th>
                <Th>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {result.items.map((commission) => (
                <Tr key={commission.id}>
                  <Td className="whitespace-nowrap text-fg-muted">
                    {formatDateTime(commission.createdAt)}
                  </Td>
                  <Td>
                    <Link
                      href={`/partner/transactions/${commission.transfer.id}`}
                      className="font-mono text-[0.8125rem] font-medium text-accent hover:underline"
                    >
                      {commission.transfer.reference}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {TRANSFER_TYPE_LABELS[commission.transfer.type] ?? commission.transfer.type}
                  </Td>
                  <Td align="right">
                    <Money
                      amount={commission.transfer.sendAmount}
                      currency={commission.transfer.sourceCurrency}
                    />
                  </Td>
                  <Td align="right">{formatBps(commission.bps)}</Td>
                  <Td align="right">
                    <Money
                      amount={commission.amount}
                      currency={commission.currency}
                      className="font-medium"
                    />
                  </Td>
                  <Td>
                    <StatusBadge status={commission.status} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          hrefFor={(page) => hrefWith('/partner/commissions', { status: query.status, page })}
        />
      </Card>
    </>
  );
}
