'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Icon } from '@/components/ui/icons';
import { formatWhen } from '@/lib/format';
import type { HealthProbe } from '@/lib/server/health';

const STATE_META: Record<
  HealthProbe['state'],
  { label: string; tone: BadgeTone; summary: string }
> = {
  ok: { label: 'Operational', tone: 'success', summary: 'All health indicators report up.' },
  degraded: {
    label: 'Degraded',
    tone: 'warning',
    summary: 'The API answered but at least one dependency is down.',
  },
  unreachable: {
    label: 'Unreachable',
    tone: 'danger',
    summary: 'The API did not return a health report.',
  },
};

/**
 * Platform health, probed server-side by the dashboard page (`GET /health`). "Re-check" re-runs
 * the server component through `router.refresh()`, so the browser never calls the API directly.
 */
export function HealthCard({ probe }: { probe: HealthProbe }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const meta = STATE_META[probe.state];
  const indicators = probe.state === 'unreachable' ? [] : Object.entries(probe.report.details);

  return (
    <Card aria-live="polite">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Icon name="activity" className="h-5 w-5 text-accent" />
            Platform health
          </span>
        }
        description={meta.summary}
        action={
          <>
            <Badge tone={meta.tone} dot>
              {meta.label}
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              loading={pending}
              loadingLabel="Re-checking"
              onClick={() => startTransition(() => router.refresh())}
              leadingIcon={<Icon name="refresh" className="h-4 w-4" />}
            >
              Re-check
            </Button>
          </>
        }
      />
      {probe.state === 'unreachable' ? (
        <p className="text-sm text-danger">{probe.reason}</p>
      ) : indicators.length === 0 ? (
        <p className="text-sm text-fg-muted">The API reported no individual indicators.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {indicators.map(([name, indicator]) => (
            <li
              key={name}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <span className="truncate font-medium text-fg">{name}</span>
              <Badge tone={indicator.status === 'up' ? 'success' : 'danger'} dot>
                {indicator.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-fg-subtle">
        Checked {formatWhen(probe.checkedAt)} · {probe.latencyMs} ms
      </p>
    </Card>
  );
}
