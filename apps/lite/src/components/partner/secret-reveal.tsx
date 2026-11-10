'use client';

import type { ReactNode } from 'react';

import { Alert } from '@/components/ui';

import { CopyButton } from './copy-button';

/**
 * One-time display of a secret (API key, webhook signing secret). The value lives only in this
 * component's props for the current render — it is never stored in the browser and cannot be
 * fetched again.
 */
export function SecretReveal({
  title,
  secret,
  testId,
  children,
}: {
  title: string;
  secret: string;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <Alert tone="warning" title={title}>
      <p>It is shown once and cannot be displayed again. Store it in your secret manager now.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code
          data-testid={testId}
          className="min-w-0 flex-1 basis-64 select-all break-all rounded-lg border border-border bg-surface-raised px-3 py-2 font-mono text-sm text-fg"
        >
          {secret}
        </code>
        <CopyButton value={secret} />
      </div>
      {children ? <div className="mt-3 text-sm">{children}</div> : null}
    </Alert>
  );
}
