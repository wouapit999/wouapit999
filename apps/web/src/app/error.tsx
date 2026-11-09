'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { useT } from '@/i18n/provider';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">{t('state.error.title')}</h1>
      <p className="max-w-md text-sm text-fg-muted">{t('state.error.generic')}</p>
      {error.digest ? (
        <p className="font-mono text-xs text-fg-subtle">
          {t('state.error.correlation', { id: error.digest })}
        </p>
      ) : null}
      <Button onClick={reset}>{t('action.retry')}</Button>
    </main>
  );
}
