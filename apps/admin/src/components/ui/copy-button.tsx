'use client';

import { useEffect, useState } from 'react';

import { Button } from './button';
import { Icon } from './icons';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
      leadingIcon={<Icon name={copied ? 'check' : 'copy'} className="h-4 w-4" />}
      aria-live="polite"
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}
