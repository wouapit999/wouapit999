import Link from 'next/link';

import { transferEffect } from '@/app/app/_lib/display';
import { transferKindLabel } from '@/app/app/_lib/labels';
import { Money, StatusBadge } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import type { TransferListItem } from '@/server/transfers';

/**
 * Transfers as a list of rows that reads well on a phone (no horizontal scrolling): who, what
 * kind, when, status and the signed amount on the customer's side. Each row links to tracking.
 */
export function TransferList({
  items,
  label,
}: {
  items: readonly TransferListItem[];
  /** Accessible name of the list, e.g. "Recent transfers". */
  label: string;
}) {
  return (
    <ul aria-label={label} className="divide-y divide-border">
      {items.map((item) => {
        const incoming = item.direction === 'received';
        // Show a sign only when money really left or reached the wallet: a failed, rejected or
        // reversed transfer moved nothing in the end, a failed top-up never credited anything.
        const effect = transferEffect(item.direction, item.status);
        return (
          <li key={item.id}>
            <Link
              href={`/app/transfers/${item.id}`}
              className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-muted/60 sm:px-6"
            >
              <span
                aria-hidden="true"
                className={`flex size-9 shrink-0 items-center justify-center rounded-full text-base font-semibold ${
                  incoming ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent'
                }`}
              >
                {incoming ? '↓' : '↑'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">
                  <span className="sr-only">{incoming ? 'Received from ' : 'Sent to '}</span>
                  {item.counterpartyName}
                </span>
                <span className="block truncate text-xs text-fg-muted">
                  {transferKindLabel(item.type, item.deliveryMethod)} ·{' '}
                  {formatDateTime(item.createdAt)}
                </span>
                <span className="mt-0.5 block font-mono text-[0.6875rem] text-fg-subtle">
                  {item.reference}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <Money
                  amount={effect === 'debit' ? -item.amount : item.amount}
                  currency={item.currency}
                  signed={effect === 'credit'}
                  className={
                    effect === 'none'
                      ? 'text-sm font-medium text-fg-muted line-through'
                      : 'text-sm font-semibold'
                  }
                />
                <StatusBadge status={item.status} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
