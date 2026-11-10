import Link from 'next/link';

import { buttonClasses } from './button';

/**
 * Previous / next links for paged lists. `hrefFor(page)` builds the URL (keep the current
 * filters in it).
 */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-fg-muted"
    >
      <p>
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={buttonClasses('secondary', 'sm')} rel="prev">
            Previous
          </Link>
        ) : (
          <span aria-disabled="true" className={buttonClasses('secondary', 'sm')}>
            Previous
          </span>
        )}
        <span aria-current="page">
          Page {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className={buttonClasses('secondary', 'sm')} rel="next">
            Next
          </Link>
        ) : (
          <span aria-disabled="true" className={buttonClasses('secondary', 'sm')}>
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
