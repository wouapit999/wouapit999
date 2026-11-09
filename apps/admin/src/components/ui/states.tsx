import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { correlationIdOf, describeError } from '@/lib/errors';

import { Alert } from './alert';
import { Button } from './button';
import { Icon } from './icons';
import { Spinner } from './spinner';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-muted', className)}
    />
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-fg-muted">
      <Spinner label={label} />
      <span aria-hidden="true">{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const correlationId = correlationIdOf(error);
  return (
    <Alert
      tone="danger"
      title="Something went wrong"
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      <p>{describeError(error)}</p>
      {correlationId ? (
        <p className="mt-1 font-mono text-xs opacity-80">Reference: {correlationId}</p>
      ) : null}
    </Alert>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border px-6 py-12 text-center">
      <p className="text-base font-semibold text-fg">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-fg-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ForbiddenState({ permission }: { permission?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-border bg-surface-raised px-6 py-14 text-center shadow-card">
      <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-warning-soft text-warning">
        <Icon name="lock" className="h-6 w-6" />
      </span>
      <h2 className="text-lg font-semibold text-fg">You do not have access to this area</h2>
      <p className="mt-1 max-w-md text-sm text-fg-muted">
        Ask a super administrator to grant you{' '}
        {permission ? (
          <code className="font-mono text-xs">{permission}</code>
        ) : (
          'the required permission'
        )}
        .
      </p>
    </div>
  );
}
