import { publicEnv } from '@/env';
import { cn } from '@/lib/cn';

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gold-500 text-sm font-black text-brand-900"
      >
        B
      </span>
      {compact ? null : (
        <span className="leading-tight">
          <span className="block text-sm font-semibold">{publicEnv.NEXT_PUBLIC_APP_NAME}</span>
          <span className="block text-[11px] tracking-wide uppercase opacity-70">Admin</span>
        </span>
      )}
    </span>
  );
}
