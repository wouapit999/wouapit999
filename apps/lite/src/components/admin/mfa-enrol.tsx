'use client';

import { useState } from 'react';

import { ActionForm, Alert, FormMessage, Input, SubmitButton } from '@/components/ui';
import type { ActionState } from '@/lib/action-state';

interface Enrolment {
  secret: string;
  otpauthUri: string;
}

type Action<T> = (previous: ActionState<T>, formData: FormData) => Promise<ActionState<T>>;

/**
 * Two-step TOTP enrolment. "Start" returns the secret once — it is shown here and can never be
 * read again — then the 6-digit code from the authenticator app switches two-factor on.
 */
export function MfaEnrol({
  beginAction,
  confirmAction,
}: {
  beginAction: Action<Enrolment>;
  confirmAction: Action<void>;
}) {
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);

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
          Protect this back-office account with a time-based one-time code (TOTP) from an
          authenticator app.
        </p>
        <FormMessage showSuccess={false} />
        <SubmitButton size="sm" pendingLabel="Preparing…">
          Start two-factor setup
        </SubmitButton>
      </ActionForm>
    );
  }

  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Add this key to your authenticator app">
        <p>It is shown once. Type it into the app, or open the link on a device that has it.</p>
        <code
          data-testid="mfa-secret"
          className="mt-2 block break-all rounded-md bg-surface-raised px-2 py-1.5 font-mono text-sm"
        >
          {enrolment.secret}
        </code>
        <a href={enrolment.otpauthUri} className="mt-2 inline-block text-sm font-medium underline">
          Open in authenticator app
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
