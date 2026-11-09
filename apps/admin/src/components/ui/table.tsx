import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/**
 * Table primitives. Tables always carry a caption (visually hidden when `captionHidden`) so
 * screen readers announce what the grid contains; the scroll container is focusable so keyboard
 * users can pan wide tables.
 */
export function TableContainer({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      tabIndex={0}
      className={cn(
        'overflow-x-auto rounded-card border border-border bg-surface-raised',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Table({
  caption,
  captionHidden = true,
  className,
  children,
}: {
  caption: string;
  captionHidden?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <table className={cn('w-full border-collapse text-left text-sm', className)}>
      <caption
        className={cn(captionHidden ? 'sr-only' : 'px-4 py-3 text-left text-sm text-fg-muted')}
      >
        {caption}
      </caption>
      {children}
    </table>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-surface-muted text-xs tracking-wide text-fg-subtle uppercase">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function Tr({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-surface-muted/60', className)} {...rest} />;
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('px-4 py-2.5 font-semibold whitespace-nowrap', className)}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle', className)} {...rest} />;
}

export function TableEmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-fg-muted">
        {children}
      </td>
    </tr>
  );
}
