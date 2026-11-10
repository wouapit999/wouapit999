'use client';

import { useEffect, useState } from 'react';

import { type ButtonSize, type ButtonVariant, buttonClasses } from '@/components/ui';

/** Copies `value` to the clipboard and confirms it (visually and to screen readers). */
export function CopyButton({
  value,
  label = 'Copy',
  variant = 'secondary',
  size = 'sm',
  className,
}: {
  value: string;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <button
      type="button"
      className={buttonClasses(variant, size, className)}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => setState('copied'),
          () => setState('failed'),
        );
      }}
    >
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy manually' : label}
      </span>
    </button>
  );
}
