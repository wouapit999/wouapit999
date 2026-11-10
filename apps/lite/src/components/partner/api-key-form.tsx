'use client';

import { useState } from 'react';

import {
  ActionForm,
  Button,
  Checkbox,
  FormActions,
  FormMessage,
  Input,
  SubmitButton,
  useFieldError,
} from '@/components/ui';
import type { ActionState } from '@/lib/action-state';

import { SecretReveal } from './secret-reveal';

export interface CreatedApiKey {
  id: string;
  name: string;
  prefix: string;
  secret: string;
}

export interface ScopeOption {
  value: string;
  label: string;
  description: string;
}

function GroupError({ name }: { name: string }) {
  const error = useFieldError(name);
  return error ? (
    <p role="alert" className="text-xs font-medium text-danger">
      {error}
    </p>
  ) : null;
}

/**
 * Creates an API key and shows the full key exactly once. After that only its prefix is listed.
 */
export function ApiKeyForm({
  action,
  scopes,
  disabled = false,
}: {
  action: (
    previous: ActionState<CreatedApiKey>,
    formData: FormData,
  ) => Promise<ActionState<CreatedApiKey>>;
  scopes: readonly ScopeOption[];
  disabled?: boolean;
}) {
  // Remounting the form (new key) clears the one-time secret from memory and resets the fields.
  const [generation, setGeneration] = useState(0);
  // Controlled, so a failed submit never re-ticks boxes the partner had left empty.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(['transfers:read']));
  const toggle = (value: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(value);
      else next.delete(value);
      return next;
    });
  return (
    <ActionForm key={generation} action={action} className="space-y-4" autoComplete="off">
      {(state) =>
        state.ok && state.data ? (
          <div className="space-y-4">
            <SecretReveal
              title={`API key “${state.data.name}” created — copy it now`}
              secret={state.data.secret}
              testId="api-key-secret"
            >
              Send it as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>. If it
              is ever exposed, revoke it below and create a new one.
            </SecretReveal>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSelected(new Set(['transfers:read']));
                setGeneration((n) => n + 1);
              }}
            >
              I have stored it — create another key
            </Button>
          </div>
        ) : (
          <>
            <Input
              name="name"
              label="Key name"
              hint="Where it will be used, e.g. “Production payouts server”."
              required
              minLength={2}
              maxLength={80}
              disabled={disabled}
            />
            <fieldset className="space-y-2.5" disabled={disabled}>
              <legend className="text-sm font-medium text-fg">
                Scopes
                <span aria-hidden="true" className="ml-0.5 text-danger">
                  *
                </span>
              </legend>
              <p className="text-xs text-fg-muted">
                Grant only what this integration needs. Scopes cannot be changed later.
              </p>
              {scopes.map((scope) => (
                <Checkbox
                  key={scope.value}
                  name="scopes[]"
                  value={scope.value}
                  label={<code className="font-mono text-[0.8125rem]">{scope.label}</code>}
                  hint={scope.description}
                  checked={selected.has(scope.value)}
                  onChange={(event) => toggle(scope.value, event.target.checked)}
                />
              ))}
              <GroupError name="scopes" />
            </fieldset>
            <FormMessage showSuccess={false} />
            <FormActions>
              <SubmitButton pendingLabel="Creating…" disabled={disabled || undefined}>
                Create API key
              </SubmitButton>
            </FormActions>
          </>
        )
      }
    </ActionForm>
  );
}
