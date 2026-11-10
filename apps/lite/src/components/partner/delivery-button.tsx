'use client';

import type { ReactNode } from 'react';

import { ActionForm, FormMessage, SubmitButton } from '@/components/ui';
import type { ActionState } from '@/lib/action-state';

export interface DeliveryOutcome {
  delivered: boolean;
  message: string;
}

/**
 * "Send test event" / "Retry" button. The outcome of the attempt (delivered or not, with the
 * HTTP status or the error) is shown in place; the delivery log below is refreshed by the action.
 */
export function DeliveryButton({
  action,
  fields,
  pendingLabel = 'Sending…',
  children,
}: {
  action: (
    previous: ActionState<DeliveryOutcome>,
    formData: FormData,
  ) => Promise<ActionState<DeliveryOutcome>>;
  fields: Readonly<Record<string, string>>;
  pendingLabel?: string;
  children: ReactNode;
}) {
  return (
    <ActionForm action={action} className="inline-flex flex-col items-start gap-1">
      {(state) => (
        <>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <SubmitButton variant="secondary" size="sm" pendingLabel={pendingLabel}>
            {children}
          </SubmitButton>
          {state.ok && state.data ? (
            <p
              role="status"
              data-testid="delivery-outcome"
              className={
                state.data.delivered
                  ? 'max-w-xs text-xs font-medium text-success'
                  : 'max-w-xs text-xs font-medium text-danger'
              }
            >
              {state.data.message}
            </p>
          ) : null}
          <FormMessage showSuccess={false} className="max-w-xs text-xs" />
        </>
      )}
    </ActionForm>
  );
}
