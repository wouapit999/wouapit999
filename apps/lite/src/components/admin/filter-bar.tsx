import Link from 'next/link';
import type { ReactNode } from 'react';

import { buttonClasses } from '@/components/ui';

/**
 * Search / filter form of a list page. Plain GET form: the filters live in the URL, so a
 * filtered list can be bookmarked, shared and paged.
 */
export function FilterBar({
  action,
  children,
  resetHref,
  submitLabel = 'Apply filters',
  hidden = {},
}: {
  /** Path of the list page. */
  action: string;
  children: ReactNode;
  /** Where "Reset" goes (defaults to `action`). */
  resetHref?: string;
  submitLabel?: string;
  /** Params to keep (e.g. the active tab). */
  hidden?: Readonly<Record<string, string | undefined>>;
}) {
  return (
    <form
      method="get"
      action={action}
      role="search"
      aria-label="Filters"
      className="grid grid-cols-1 gap-3 border-b border-border px-5 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4"
    >
      {Object.entries(hidden).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      {children}
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className={buttonClasses('primary', 'sm')}>
          {submitLabel}
        </button>
        <Link href={resetHref ?? action} className={buttonClasses('ghost', 'sm')}>
          Reset
        </Link>
      </div>
    </form>
  );
}

/** Link tabs (the active tab is a query parameter or a path, so tabs work without JavaScript). */
export function Tabs({
  tabs,
  active,
  label,
}: {
  tabs: ReadonlyArray<{ key: string; label: string; href: string; count?: number }>;
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="mb-5 overflow-x-auto border-b border-border">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const current = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={current ? 'page' : undefined}
                className={
                  current
                    ? 'inline-flex items-center gap-2 border-b-2 border-accent px-3 py-2.5 text-sm font-semibold text-accent'
                    : 'inline-flex items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-fg-muted hover:border-border-strong hover:text-fg'
                }
              >
                {tab.label}
                {tab.count ? (
                  <span className="tabular rounded-full bg-gold-500 px-1.5 py-0.5 text-[0.6875rem] font-semibold leading-none text-slate-950">
                    {tab.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
