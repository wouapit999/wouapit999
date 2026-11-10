import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/**
 * Responsive table: scrolls horizontally on small screens. Always give it a `caption` (visually
 * hidden by default) so screen readers announce what the table contains. The wrapper is
 * `relative` so visually hidden labels inside cells stay in the scroller and never widen the page.
 */
export function Table({
  caption,
  showCaption = false,
  className,
  children,
}: {
  caption: string;
  showCaption?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('relative overflow-x-auto', className)}>
      {/* The 36rem floor keeps columns readable on a phone (the wrapper scrolls). From `lg` up
          the table takes its natural width, so it also fits a half-width card. */}
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm lg:min-w-0">
        <caption className={showCaption ? 'px-4 py-2 text-left text-sm text-fg-muted' : 'sr-only'}>
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-border bg-surface-muted/60 text-xs uppercase tracking-wide text-fg-subtle">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function Tr({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('hover:bg-surface-muted/50', className)} {...rest}>
      {children}
    </tr>
  );
}

export function Th({
  align = 'left',
  className,
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      scope="col"
      className={cn(
        'px-3 py-2.5 font-medium first:pl-4 last:pr-4 2xl:px-4',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  align = 'left',
  className,
  children,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={cn(
        'px-3 py-3 align-middle first:pl-4 last:pr-4 2xl:px-4',
        align === 'right' && 'tabular text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}
