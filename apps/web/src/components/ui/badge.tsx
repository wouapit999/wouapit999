import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'brand' | 'gold' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-fg-muted',
  brand: 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100',
  gold: 'bg-gold-100 text-gold-900 dark:bg-gold-900 dark:text-gold-100',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
