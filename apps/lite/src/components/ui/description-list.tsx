import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** Label / value pairs for detail pages (stacks on mobile, two columns from `sm`). */
export function DescriptionList({
  items,
  className,
}: {
  items: ReadonlyArray<{ label: string; value: ReactNode }>;
  className?: string;
}) {
  return (
    <dl className={cn('divide-y divide-border text-sm', className)}>
      {items.map((item) => (
        <div key={item.label} className="grid gap-1 py-2.5 sm:grid-cols-3 sm:gap-4">
          <dt className="text-fg-muted">{item.label}</dt>
          <dd className="min-w-0 break-words text-fg sm:col-span-2">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
