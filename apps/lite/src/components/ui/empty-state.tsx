import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** Friendly placeholder for empty lists, with an optional call to action. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}>
      <div
        aria-hidden="true"
        className="mb-1 flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M4 7h16M4 12h10M4 17h6" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-sm text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
