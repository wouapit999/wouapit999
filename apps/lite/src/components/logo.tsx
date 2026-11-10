import { cn } from '@/lib/cn';

/** BI-Rem mark: two arrows crossing a coin — money going both ways. Decorative by default. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0B6E4F" />
      <path
        d="M8 13h13l-3.5-3.5M24 19H11l3.5 3.5"
        fill="none"
        stroke="#F2B705"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className, name = 'BI-Rem Lite' }: { className?: string; name?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-semibold tracking-tight text-fg',
        className,
      )}
    >
      <LogoMark />
      <span>{name}</span>
    </span>
  );
}
