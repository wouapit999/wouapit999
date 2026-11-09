'use client';

import { useState } from 'react';

import { useCan } from '@/components/shell/session-provider';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TBody, THead, Table, TableContainer, Td, Th, Tr } from '@/components/ui/table';
import { describeError } from '@/lib/errors';
import { formatWhen } from '@/lib/format';
import { useFeatureFlags, useUpsertFeatureFlag } from '@/lib/queries';
import {
  type FeatureFlag,
  type UpsertFeatureFlagDto,
  featureFlagRuleSchema,
  upsertFeatureFlagSchema,
} from '@/lib/schemas';

/**
 * `PUT /v1/feature-flags/:key` replaces the whole flag, so a one-field change is sent as the
 * current flag merged with the change. Rules the portal cannot parse (written by a newer API)
 * are dropped from the body rather than sent back malformed; the API would reject them anyway.
 */
export function toUpsertBody(
  flag: FeatureFlag,
  change: Partial<Pick<UpsertFeatureFlagDto, 'enabled' | 'rolloutPercentage'>>,
): UpsertFeatureFlagDto {
  const rules = flag.rules.flatMap((rule) => {
    const parsed = featureFlagRuleSchema.safeParse(rule);
    return parsed.success ? [parsed.data] : [];
  });
  return upsertFeatureFlagSchema.parse({
    enabled: change.enabled ?? flag.enabled,
    rolloutPercentage: change.rolloutPercentage ?? flag.rolloutPercentage,
    rules,
    ...(flag.description ? { description: flag.description } : {}),
  });
}

export function FeatureFlagsPanel() {
  const canWrite = useCan('feature-flags:write');
  const flags = useFeatureFlags();
  const upsert = useUpsertFeatureFlag();
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const save = (
    flag: FeatureFlag,
    change: Partial<Pick<UpsertFeatureFlagDto, 'enabled' | 'rolloutPercentage'>>,
  ) => {
    setError(null);
    setBusyKey(flag.key);
    upsert.mutate(
      { key: flag.key, dto: toUpsertBody(flag, change) },
      {
        onError: (mutationError) => setError(describeError(mutationError)),
        onSettled: () => setBusyKey(null),
      },
    );
  };

  if (flags.isPending) return <LoadingState label="Loading feature flags…" />;
  if (flags.isError) return <ErrorState error={flags.error} onRetry={() => void flags.refetch()} />;
  if (flags.data.length === 0) {
    return (
      <EmptyState
        title="No feature flags"
        body="Flags are created by the API seed and migrations."
      />
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>
              Dismiss
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}
      {!canWrite ? (
        <p className="text-xs text-fg-subtle">
          Read-only: <code className="font-mono">feature-flags:write</code> is required to change
          flags.
        </p>
      ) : null}
      <TableContainer>
        <Table caption="Feature flags">
          <THead>
            <tr>
              <Th>Flag</Th>
              <Th>Enabled</Th>
              <Th>Rollout</Th>
              <Th>Targeting rules</Th>
              <Th>Updated</Th>
            </tr>
          </THead>
          <TBody>
            {flags.data.map((flag) => (
              <Tr key={flag.id} aria-busy={busyKey === flag.key}>
                <Td className="align-top">
                  <code className="font-mono text-sm font-medium text-fg">{flag.key}</code>
                  {flag.description ? (
                    <span className="mt-0.5 block max-w-md text-xs text-fg-muted">
                      {flag.description}
                    </span>
                  ) : null}
                </Td>
                <Td className="align-top">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={flag.enabled}
                      disabled={!canWrite || busyKey === flag.key}
                      label={`${flag.enabled ? 'Disable' : 'Enable'} ${flag.key}`}
                      onChange={(enabled) => save(flag, { enabled })}
                    />
                    <Badge tone={flag.enabled ? 'success' : 'neutral'}>
                      {flag.enabled ? 'On' : 'Off'}
                    </Badge>
                  </div>
                </Td>
                <Td className="align-top">
                  <RolloutEditor
                    flag={flag}
                    disabled={!canWrite || busyKey === flag.key}
                    onSave={(rolloutPercentage) => save(flag, { rolloutPercentage })}
                  />
                </Td>
                <Td className="align-top text-fg-muted tabular-nums">
                  {flag.rules.length === 0
                    ? 'Everyone'
                    : `${flag.rules.length} rule${flag.rules.length === 1 ? '' : 's'}`}
                </Td>
                <Td className="align-top text-fg-muted whitespace-nowrap">
                  {formatWhen(flag.updatedAt)}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  );
}

/** Percentage input that only saves on commit (Enter/blur) so every keystroke is not a request. */
function RolloutEditor({
  flag,
  disabled,
  onSave,
}: {
  flag: FeatureFlag;
  disabled: boolean;
  onSave: (value: number) => void;
}) {
  const [value, setValue] = useState<string>(String(flag.rolloutPercentage));
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 100;
  const dirty = valid && parsed !== flag.rolloutPercentage;
  const inputId = `rollout-${flag.id}`;

  const commit = () => {
    if (dirty) onSave(parsed);
    else setValue(String(flag.rolloutPercentage));
  };

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={inputId} className="sr-only">
        Rollout percentage for {flag.key}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="number"
          min={0}
          max={100}
          step={5}
          inputMode="numeric"
          disabled={disabled}
          value={value}
          aria-invalid={!valid}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              setValue(String(flag.rolloutPercentage));
            }
          }}
          className="h-8 w-20 rounded-md border border-border-strong bg-surface-raised pr-6 pl-2 text-right text-sm tabular-nums disabled:bg-surface-muted aria-[invalid=true]:border-danger"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-fg-subtle"
        >
          %
        </span>
      </div>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${flag.rolloutPercentage}%` }}
        />
      </div>
      {dirty ? <span className="text-xs text-warning">Unsaved</span> : null}
    </div>
  );
}
