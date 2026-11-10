import Link from 'next/link';

import { Money, StatusBadge, TBody, THead, Table, Td, Th, Tr } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { TransferListItem } from '@/server/transfers';

const TYPE_LABELS: Readonly<Record<string, string>> = {
  W2W: 'Wallet transfer',
  W2M: 'Merchant payment',
  W2A: 'Agent cash-out',
  INTERNATIONAL: 'International',
  TOPUP: 'Top-up',
};

/** Statuses in which the amount is (still) debited from or credited to the partner. */
const MOVED: ReadonlySet<string> = new Set(['COMPLETED', 'PROCESSING', 'ON_HOLD']);

/**
 * The partner's transfers: one row per transfer with its direction spelled out (never colour
 * alone), the counterparty and the amount that moved on the partner's side.
 */
export function TransactionsTable({
  items,
  caption,
  compact = false,
}: {
  items: readonly TransferListItem[];
  caption: string;
  /**
   * Dashboard variant: relative dates, no fee column, and the status under the amount rather
   * than in a column of its own — the table sits in a two-thirds-width card and must show its
   * outcome without horizontal scrolling.
   */
  compact?: boolean;
}) {
  return (
    <Table caption={caption}>
      <THead>
        <Tr>
          <Th>Date</Th>
          <Th>Reference</Th>
          <Th>Type</Th>
          <Th>Counterparty</Th>
          <Th align="right">Amount</Th>
          {compact ? null : <Th align="right">Fee</Th>}
          {compact ? null : <Th>Status</Th>}
        </Tr>
      </THead>
      <TBody>
        {items.map((item) => {
          const received = item.direction === 'received';
          return (
            <Tr key={item.id}>
              <Td className="whitespace-nowrap text-fg-muted">
                <time dateTime={item.createdAt.toISOString()}>
                  {compact ? formatRelative(item.createdAt) : formatDateTime(item.createdAt)}
                </time>
              </Td>
              <Td>
                <Link
                  href={`/partner/transactions/${item.id}`}
                  className="font-mono text-[0.8125rem] font-medium text-accent hover:underline"
                >
                  {item.reference}
                </Link>
              </Td>
              <Td className="whitespace-nowrap">
                {TYPE_LABELS[item.type] ?? item.type}
                <span className="block text-xs text-fg-subtle">
                  {received ? 'Received' : 'Sent'}
                  {item.deliveryMethod === 'MOBILE_MONEY' ? ' · mobile money' : ''}
                </span>
              </Td>
              <Td>
                <span className="block max-w-48 truncate" title={item.counterpartyName}>
                  {item.counterpartyName}
                </span>
                {item.counterpartyAccount ? (
                  <span className="block max-w-48 truncate text-xs text-fg-subtle">
                    {item.counterpartyAccount}
                  </span>
                ) : null}
              </Td>
              <Td align="right">
                {MOVED.has(item.status) ? (
                  <Money
                    amount={received ? item.amount : -item.amount}
                    currency={item.currency}
                    signed
                  />
                ) : (
                  // Failed / rejected / reversed: the money went back, so no sign and no colour.
                  <Money amount={item.amount} currency={item.currency} className="text-fg-muted" />
                )}
                {compact ? (
                  <span className="mt-1 block">
                    <StatusBadge status={item.status} />
                  </span>
                ) : null}
              </Td>
              {compact ? null : (
                <Td align="right" className="text-fg-muted">
                  {received || item.feeAmount === 0n ? (
                    '—'
                  ) : (
                    <Money
                      amount={item.feeAmount}
                      currency={item.sourceCurrency}
                      withCode={false}
                    />
                  )}
                </Td>
              )}
              {compact ? null : (
                <Td>
                  <StatusBadge status={item.status} />
                </Td>
              )}
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
