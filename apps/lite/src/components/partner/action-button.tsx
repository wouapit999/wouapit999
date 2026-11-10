import type { ReactNode } from 'react';

import {
  ActionForm,
  type ButtonSize,
  type ButtonVariant,
  ConfirmSubmitButton,
  FormMessage,
  SubmitButton,
} from '@/components/ui';
import type { ActionState } from '@/lib/action-state';

/**
 * A one-click mutation in the partner portal (revoke a key, pause an endpoint): a small form
 * with hidden fields run through a `createAction` server action. Errors appear under the
 * button; on success the action revalidates the page, so the new state is the confirmation.
 */
export function PartnerActionButton<T>({
  action,
  fields,
  children,
  variant = 'secondary',
  size = 'sm',
  confirm,
  pendingLabel,
  showSuccess = false,
}: {
  action: (previous: ActionState<T>, formData: FormData) => Promise<ActionState<T>>;
  fields: Readonly<Record<string, string>>;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ask before submitting (destructive or irreversible actions). */
  confirm?: string;
  pendingLabel?: string;
  showSuccess?: boolean;
}) {
  return (
    <ActionForm action={action} className="inline-flex flex-col items-start gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {confirm ? (
        <ConfirmSubmitButton
          confirm={confirm}
          variant={variant}
          size={size}
          pendingLabel={pendingLabel}
        >
          {children}
        </ConfirmSubmitButton>
      ) : (
        <SubmitButton variant={variant} size={size} pendingLabel={pendingLabel}>
          {children}
        </SubmitButton>
      )}
      <FormMessage showSuccess={showSuccess} className="max-w-xs text-xs" />
    </ActionForm>
  );
}
