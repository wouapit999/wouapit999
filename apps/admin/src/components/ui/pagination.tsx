import type { PaginationMeta } from '@bi-rem/shared/schemas';

import { formatNumber } from '@/lib/format';

import { Button } from './button';
import { Icon } from './icons';

export function Pagination({
  meta,
  onPageChange,
  itemLabel = 'items',
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}) {
  const start = meta.totalItems === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const end = Math.min(meta.page * meta.pageSize, meta.totalItems);
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 px-1 pt-3 text-sm text-fg-muted"
    >
      <p aria-live="polite">
        Showing <span className="font-medium text-fg">{formatNumber(start)}</span>–
        <span className="font-medium text-fg">{formatNumber(end)}</span> of{' '}
        <span className="font-medium text-fg">{formatNumber(meta.totalItems)}</span> {itemLabel}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!meta.hasPreviousPage}
          onClick={() => onPageChange(meta.page - 1)}
          leadingIcon={<Icon name="chevronLeft" className="h-4 w-4" />}
        >
          Previous
        </Button>
        <span className="tabular-nums">
          Page {meta.page} of {Math.max(meta.totalPages, 1)}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={!meta.hasNextPage}
          onClick={() => onPageChange(meta.page + 1)}
        >
          Next
          <Icon name="chevronRight" className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
