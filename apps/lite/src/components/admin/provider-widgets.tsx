'use client';

import { useState } from 'react';

import {
  ActionForm,
  Alert,
  type ButtonSize,
  FormMessage,
  Input,
  SimulatedBadge,
  StatusBadge,
  SubmitButton,
} from '@/components/ui';
import type { ActionState } from '@/lib/action-state';
import { formatDateTime } from '@/lib/format';

export interface ConnectivityResult {
  id: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  latencyMs: number;
  message: string;
  simulated: boolean;
  checkedAt: string;
}

type Action<T> = (previous: ActionState<T>, formData: FormData) => Promise<ActionState<T>>;

/** "Test connectivity" button that shows the outcome and latency of the ping in place. */
export function ConnectivityTest({
  action,
  providerId,
  size = 'sm',
  label = 'Test connectivity',
}: {
  action: Action<ConnectivityResult>;
  providerId: string;
  size?: ButtonSize;
  label?: string;
}) {
  return (
    <ActionForm action={action} className="space-y-2">
      {(state) => (
        <>
          <input type="hidden" name="providerId" value={providerId} />
          <SubmitButton variant="secondary" size={size} pendingLabel="Testing…">
            {label}
          </SubmitButton>
          {state.ok && state.data ? (
            <p
              role="status"
              data-testid="connectivity-result"
              className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted"
            >
              <StatusBadge status={state.data.status} />
              <span className="tabular font-medium text-fg">{state.data.latencyMs} ms</span>
              {state.data.simulated ? <SimulatedBadge /> : null}
              <span className="basis-full">
                {state.data.message} · {formatDateTime(state.data.checkedAt)}
              </span>
            </p>
          ) : null}
          <FormMessage showSuccess={false} className="text-xs" />
        </>
      )}
    </ActionForm>
  );
}

export interface RotatedSecret {
  id: string;
  version: number;
  generatedSecret: string | null;
}

/**
 * Webhook signing secret rotation. Either generate one (displayed once, to be copied to the
 * operator) or store the operator's own. The input is write-only: nothing is ever read back.
 */
export function WebhookSecretForm({
  action,
  providerId,
  hasSecret,
}: {
  action: Action<RotatedSecret>;
  providerId: string;
  hasSecret: boolean;
}) {
  const [mode, setMode] = useState<'GENERATE' | 'CUSTOM'>('GENERATE');
  return (
    <ActionForm action={action} className="space-y-3" autoComplete="off">
      {(state) => (
        <>
          <input type="hidden" name="providerId" value={providerId} />
          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium text-fg">New signing secret</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                value="GENERATE"
                checked={mode === 'GENERATE'}
                onChange={() => setMode('GENERATE')}
                className="size-4 accent-[var(--accent)]"
              />
              Generate a random secret (shown once)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                value="CUSTOM"
                checked={mode === 'CUSTOM'}
                onChange={() => setMode('CUSTOM')}
                className="size-4 accent-[var(--accent)]"
              />
              Store the operator&apos;s own secret
            </label>
          </fieldset>
          {mode === 'CUSTOM' ? (
            <Input
              name="webhookSecret"
              type="password"
              label="Operator secret"
              hint="16–500 characters. Write-only: it cannot be displayed after saving."
              autoComplete="new-password"
              required
              minLength={16}
              maxLength={500}
            />
          ) : null}
          {state.ok && state.data?.generatedSecret ? (
            <Alert tone="warning" title="Copy this secret now">
              <p>
                It is shown once and cannot be retrieved later. The previous secret keeps verifying
                for 24 hours.
              </p>
              <code
                data-testid="generated-webhook-secret"
                className="mt-2 block break-all rounded-md bg-surface-raised px-2 py-1.5 font-mono text-xs"
              >
                {state.data.generatedSecret}
              </code>
            </Alert>
          ) : null}
          <FormMessage />
          <SubmitButton size="sm" variant="secondary" pendingLabel="Rotating…">
            {hasSecret ? 'Rotate webhook secret' : 'Set webhook secret'}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
