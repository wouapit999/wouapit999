import { cn } from '@/lib/cn';

export function Spinner({
  size = 'md',
  label,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  label?: string | undefined;
  className?: string;
}) {
  const dimension = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-10 w-10' : 'h-6 w-6';
  return (
    <span role="status" className={cn('inline-flex items-center', className)}>
      <svg
        className={cn('animate-spin text-current', dimension)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
          className="opacity-25"
        />
        <path
          d="M4 12a8 8 0 0 1 8-8"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          className="opacity-90"
        />
      </svg>
      <span className="sr-only">{label ?? 'Loading'}</span>
    </span>
  );
}
