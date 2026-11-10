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
 * One-click mutation: a form with hidden fields and a submit button, run through a server
 * action built with `createAction`. Errors are shown next to the button; on success the page is
 * revalidated by the action, so the new state is the confirmation.
 */
export function ActionButton<T>({
  action,
  fields = {},
  children,
  variant = 'secondary',
  size = 'sm',
  confirm,
  pendingLabel,
  showSuccess = false,
  className,
}: {
  action: (previous: ActionState<T>, formData: FormData) => Promise<ActionState<T>>;
  /** Hidden inputs sent with the form. */
  fields?: Readonly<Record<string, string>>;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ask for confirmation first (destructive or irreversible actions). */
  confirm?: string;
  pendingLabel?: string;
  showSuccess?: boolean;
  className?: string;
}) {
  return (
    <ActionForm action={action} className={className ?? 'inline-flex flex-col items-start gap-1'}>
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
