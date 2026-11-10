import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { humanize } from '@/lib/format';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'gold';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-fg-muted border-border',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  info: 'bg-info-soft text-info border-transparent',
  brand: 'bg-accent-soft text-accent border-transparent',
  gold: 'bg-gold-100 text-gold-900 border-transparent dark:bg-gold-900 dark:text-gold-100',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Tone for every status enum used in Lite. Unknown values fall back to neutral. */
const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  // transfers
  COMPLETED: 'success',
  PROCESSING: 'info',
  ON_HOLD: 'warning',
  FAILED: 'danger',
  REJECTED: 'danger',
  REVERSED: 'neutral',
  // generic
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  SUSPENDED: 'danger',
  CLOSED: 'neutral',
  PENDING: 'warning',
  MAINTENANCE: 'warning',
  PLANNED: 'neutral',
  // KYC
  NONE: 'neutral',
  VERIFIED: 'success',
  SUBMITTED: 'info',
  IN_REVIEW: 'warning',
  APPROVED: 'success',
  RESUBMIT_REQUESTED: 'warning',
  // health / liquidity
  HEALTHY: 'success',
  DEGRADED: 'warning',
  DOWN: 'danger',
  UNKNOWN: 'neutral',
  OK: 'success',
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
  CRITICAL: 'danger',
  // AML
  OPEN: 'warning',
  ESCALATED: 'danger',
  DISMISSED: 'neutral',
  RESOLVED: 'success',
  UNDER_REVIEW: 'info',
  RELEASED: 'success',
  DRAFT: 'neutral',
  FILED: 'success',
  FLAG: 'warning',
  HOLD: 'danger',
  // partners / commissions / webhooks
  ACCRUED: 'info',
  SETTLED: 'success',
  PAID: 'success',
  DELIVERED: 'success',
  // audit
  SUCCESS: 'success',
  FAILURE: 'danger',
  DENIED: 'danger',
  // roadmap
  IN_PROGRESS: 'info',
  DONE: 'success',
  // environment
  SANDBOX: 'gold',
  PRODUCTION: 'brand',
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  ON_HOLD: 'Under review',
  REJECTED: 'Not approved',
};

/** Badge for a status enum value, with a consistent tone and a humanised label. */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} className={className}>
      {label ?? STATUS_LABELS[status] ?? humanize(status)}
    </Badge>
  );
}

/** Honest marker for anything that never talks to a real operator or vendor. */
export function SimulatedBadge({ className }: { className?: string }) {
  return (
    <Badge tone="gold" className={className}>
      Simulated
    </Badge>
  );
}
