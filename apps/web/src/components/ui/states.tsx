'use client';

import type { ReactNode } from 'react';

import { useT } from '@/i18n/provider';
import { cn } from '@/lib/cn';
import { correlationIdOf, describeError } from '@/lib/errors';

import { Alert } from './alert';
import { Button } from './button';
import { Spinner } from './spinner';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-muted', className)}
    />
  );
}

export function LoadingState({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-fg-muted">
      <Spinner label={label ?? t('state.loading')} />
      <span aria-hidden="true">{label ?? t('state.loading')}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const correlationId = correlationIdOf(error);
  return (
    <Alert tone="danger" title={t('state.error.title')}>
      <p>{describeError(error, t)}</p>
      {correlationId ? (
        <p className="mt-1 font-mono text-xs opacity-80">
          {t('state.error.correlation', { id: correlationId })}
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          {t('action.retry')}
        </Button>
      ) : null}
    </Alert>
  );
}

export function EmptyState({
  title,
  body,
  icon,
}: {
  title: ReactNode;
  body?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-fg-subtle">{icon}</div> : null}
      <p className="text-base font-semibold text-fg">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-fg-muted">{body}</p> : null}
    </div>
  );
}
