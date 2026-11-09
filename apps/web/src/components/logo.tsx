import { cn } from '@/lib/cn';

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span
        aria-hidden="true"
        className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white dark:bg-brand-500 dark:text-brand-950"
      >
        B
      </span>
      {!compact ? (
        <span className="text-fg">
          BI-<span className="text-gold-600 dark:text-gold-400">Rem</span>
        </span>
      ) : null}
    </span>
  );
}
