'use client';

import { useEffect } from 'react';

import { Alert, Button, LinkButton } from '@/components/ui';

/**
 * Error boundary of the customer area. It renders inside the shell, so the navigation stays
 * usable. Money movements are atomic: an error on a page never leaves a half-posted transfer.
 */
export default function CustomerError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div data-page-state="error" className="mx-auto max-w-xl space-y-4 py-8">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
        This page could not be displayed
      </h1>
      <Alert tone="danger" title="Something went wrong on our side">
        No money has moved because of this error. If you were sending money, check your transfer
        history before trying again — a transfer is never sent twice for the same confirmation.
      </Alert>
      {error.digest ? (
        <p className="font-mono text-xs text-fg-subtle">Reference: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <LinkButton href="/app/transfers" variant="secondary">
          Transfer history
        </LinkButton>
        <LinkButton href="/app" variant="ghost">
          Back to home
        </LinkButton>
      </div>
    </div>
  );
}
