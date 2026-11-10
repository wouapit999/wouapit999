import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type StatTone = 'default' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<StatTone, string> = {
  default: 'text-fg',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** KPI tile: a label, a big value and an optional hint line. */
export function Stat({
  label,
  value,
  hint,
  tone = 'default',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-border bg-surface-raised p-4 shadow-[var(--shadow-card)] sm:p-5',
        className,
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={cn('tabular mt-1.5 text-2xl font-semibold', TONE_CLASSES[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
    </div>
  );
}

/** Responsive grid for `Stat` tiles. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4', className)}>
      {children}
    </div>
  );
}
