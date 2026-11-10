'use client';

import { useState } from 'react';

import { ActionForm, Alert, FormMessage, Input, SubmitButton } from '@/components/ui';
import type { ActionState } from '@/lib/action-state';

export interface MfaEnrolmentData {
  secret: string;
  otpauthUri: string;
}

type Action<T> = (previous: ActionState<T>, formData: FormData) => Promise<ActionState<T>>;

const grouped = (secret: string): string => secret.replace(/(.{4})/g, '$1 ').trim();

/**
 * Two-step TOTP enrolment for a partner user. "Set up" returns the secret once — it is shown
 * here and cannot be read again — then a first 6-digit code switches two-factor on.
 */
export function PartnerMfaEnrol({
  beginAction,
  confirmAction,
}: {
  beginAction: Action<MfaEnrolmentData>;
  confirmAction: Action<void>;
}) {
  const [enrolment, setEnrolment] = useState<MfaEnrolmentData | null>(null);

  if (!enrolment) {
    return (
      <ActionForm
        action={beginAction}
        className="space-y-3"
        onResult={(state) => {
          if (state.ok && state.data) setEnrolment(state.data);
        }}
      >
        <p className="text-sm text-fg-muted">
          This login can create API keys and move your float. Protect it with a 6-digit code from an
          authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, 1Password…).
        </p>
        <FormMessage showSuccess={false} />
        <SubmitButton size="sm" pendingLabel="Preparing…">
          Set up two-factor authentication
        </SubmitButton>
      </ActionForm>
    );
  }

  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Add this key to your authenticator app">
        <p>It is shown once. If you leave before confirming, start again to get a new key.</p>
        <code
          data-testid="mfa-secret"
          className="mt-2 block break-all rounded-lg border border-border bg-surface-raised px-3 py-2 font-mono text-sm tracking-wider text-fg"
        >
          {grouped(enrolment.secret)}
        </code>
        <a href={enrolment.otpauthUri} className="mt-2 inline-block text-sm font-medium underline">
          Open in an authenticator app on this device
        </a>
      </Alert>
      <ActionForm action={confirmAction} className="space-y-3" autoComplete="off">
        <Input
          name="code"
          label="6-digit code from the app"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
        />
        <FormMessage />
        <SubmitButton size="sm" pendingLabel="Checking…">
          Confirm and turn on
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
