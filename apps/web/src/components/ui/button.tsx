import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { Spinner } from './spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Accessible label announced while `loading` is true. */
  loadingLabel?: string;
  leadingIcon?: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-600/50 dark:bg-brand-500 dark:hover:bg-brand-400 dark:text-brand-950',
  secondary:
    'border border-border-strong bg-surface-raised text-fg hover:bg-surface-muted disabled:opacity-60',
  ghost: 'text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-60',
  danger: 'bg-danger text-white hover:brightness-110 disabled:opacity-60',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export const buttonClasses = (variant: Variant = 'primary', size: Size = 'md', extra?: string) =>
  cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
    'disabled:cursor-not-allowed',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    extra,
  );

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  leadingIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size="sm" label={loadingLabel} /> : leadingIcon}
      <span>{children}</span>
    </button>
  );
}
