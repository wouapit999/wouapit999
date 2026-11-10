'use client';

import { useState } from 'react';

import { type ActionData, asSerialized } from '@/app/app/_lib/client';
import { groupSecret } from '@/app/app/_lib/user-agent';
import { beginMfaAction, confirmMfaAction } from '@/app/app/security/actions';
import {
  ActionForm,
  Alert,
  Button,
  FormActions,
  FormMessage,
  Input,
  SubmitButton,
} from '@/components/ui';

const beginAction = asSerialized(beginMfaAction);
type Enrolment = ActionData<typeof beginMfaAction>;

/**
 * Two-factor enrolment: "Set up" asks the server for a new secret (shown once, here), the
 * customer adds it to an authenticator app and proves it with a first code.
 */
export function MfaSetup() {
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);

  if (!enrolment) {
    return (
      <ActionForm<Enrolment>
        action={beginAction}
        className="space-y-3"
        onResult={(state) => {
          if (state.ok && state.data) setEnrolment(state.data);
        }}
      >
        <p className="text-sm text-fg-muted">
          Use an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis,
          1Password…) to generate a 6-digit code each time you sign in.
        </p>
        <FormMessage showSuccess={false} />
        <FormActions>
          <SubmitButton pendingLabel="Preparing…">Set up two-factor authentication</SubmitButton>
        </FormActions>
      </ActionForm>
    );
  }

  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Save this key now">
        It is shown only once. If you leave this page before finishing, start again to get a new
        key.
      </Alert>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-fg">
        <li>
          Add an account in your authenticator app with this key (time-based, 6 digits):
          <p className="mt-1.5 break-all rounded-lg border border-border bg-surface-muted px-3 py-2 font-mono text-base tracking-wider">
            {groupSecret(enrolment.secret)}
          </p>
          <a
            href={enrolment.otpauthUri}
            className="mt-1.5 inline-block text-sm font-medium text-accent underline"
          >
            Or open it in the authenticator app on this device
          </a>
        </li>
        <li>Enter the 6-digit code the app shows to finish.</li>
      </ol>
      <ActionForm action={confirmMfaAction} className="space-y-4">
        <Input
          name="code"
          label="Authentication code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="123 456"
          required
          containerClassName="max-w-xs"
        />
        <FormMessage />
        <FormActions>
          <SubmitButton pendingLabel="Checking…">Turn on two-factor</SubmitButton>
          <Button variant="ghost" onClick={() => setEnrolment(null)}>
            Cancel
          </Button>
        </FormActions>
      </ActionForm>
    </div>
  );
}
