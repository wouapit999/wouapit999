import { publicEnv } from '@/env';
import { cn } from '@/lib/cn';

/** Topbar badge: production is loud so an operator always knows which environment they touch. */
export function EnvBadge({ className }: { className?: string }) {
  const env = publicEnv.NEXT_PUBLIC_ENV;
  const production = env === 'production';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide uppercase',
        production
          ? 'border-danger/40 bg-danger-soft text-danger'
          : 'border-gold-500/50 bg-gold-soft text-gold-soft-fg',
        className,
      )}
      title={`Connected to the ${env} API at ${publicEnv.NEXT_PUBLIC_API_URL}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {env}
    </span>
  );
}
