'use client';

import {
  type ComponentProps,
  type ReactNode,
  createContext,
  useActionState,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { useFormStatus } from 'react-dom';

import { cn } from '@/lib/cn';
import { type ActionState, initialActionState } from '@/lib/action-state';

import { Alert } from './alert';
import { type ButtonSize, type ButtonVariant, buttonClasses } from './button';

/**
 * Form helpers for server actions built with `createAction` / `createPublicAction`.
 *
 *   <ActionForm action={saveThingAction} className="space-y-4">
 *     <Input name="name" label="Name" required />
 *     <FormMessage />
 *     <SubmitButton>Save</SubmitButton>
 *   </ActionForm>
 *
 * `ActionForm` runs the action through `useActionState`, exposes the returned state to the
 * fields (`Input`, `Select`, `Textarea` show their own `fieldErrors[name]` and keep the typed
 * values after an error) and moves focus to the first invalid field.
 */

const FormStateContext = createContext<ActionState | null>(null);

/** State of the enclosing `ActionForm` (null outside one). */
export function useFormState<T = unknown>(): ActionState<T> | null {
  return useContext(FormStateContext) as ActionState<T> | null;
}

/** First error of a field from the enclosing form state. */
export function useFieldError(name: string | undefined): string | undefined {
  const state = useContext(FormStateContext);
  return name ? state?.fieldErrors?.[name]?.[0] : undefined;
}

/** Value echoed back by the action after a failed submit (so inputs keep what was typed). */
export function useFieldValue(name: string | undefined): string | undefined {
  const state = useContext(FormStateContext);
  return name && state && !state.ok ? state.values?.[name] : undefined;
}

export interface ActionFormProps<T> extends Omit<
  ComponentProps<'form'>,
  'action' | 'children' | 'onReset'
> {
  action: (previous: ActionState<T>, formData: FormData) => Promise<ActionState<T>>;
  /** Called after each completed run (success or failure) — e.g. to close a dialog. */
  onResult?: (state: ActionState<T>) => void;
  /** Render prop gets the latest state (e.g. to show a one-time secret from `state.data`). */
  children: ReactNode | ((state: ActionState<T>) => ReactNode);
}

export function ActionForm<T = unknown>({
  action,
  onResult,
  children,
  className,
  ...rest
}: ActionFormProps<T>) {
  const [state, formAction] = useActionState(action, initialActionState as ActionState<T>);
  const formRef = useRef<HTMLFormElement>(null);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    if (state === initialActionState) return;
    onResultRef.current?.(state);
    if (!state.ok && state.fieldErrors) {
      const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      invalid?.focus();
    }
  }, [state]);

  return (
    <FormStateContext.Provider value={state}>
      <form ref={formRef} action={formAction} noValidate={false} className={className} {...rest}>
        {typeof children === 'function' ? children(state) : children}
      </form>
    </FormStateContext.Provider>
  );
}

/**
 * Shows the action's message: errors as an alert, success as a status. Renders nothing before
 * the first submit. Field-level errors are shown by the fields themselves.
 */
export function FormMessage({
  className,
  showSuccess = true,
}: {
  className?: string;
  showSuccess?: boolean;
}) {
  const state = useContext(FormStateContext);
  const formErrors = state?.fieldErrors?._form;
  if (!state || state === initialActionState) return null;
  if (state.ok) {
    return showSuccess && state.message ? (
      <Alert tone="success" className={className}>
        {state.message}
      </Alert>
    ) : null;
  }
  if (!state.message && !formErrors) return null;
  return (
    <Alert tone="danger" className={className}>
      {state.message}
      {formErrors ? (
        <ul className="mt-1 list-disc pl-5">
          {formErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

export interface SubmitButtonProps extends Omit<ComponentProps<'button'>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Label while the action is running (default: the children). */
  pendingLabel?: string;
}

/** Submit button that disables itself and shows a spinner while the form action runs. */
export function SubmitButton({
  variant = 'primary',
  size = 'md',
  pendingLabel,
  className,
  children,
  disabled,
  ...rest
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={buttonClasses(variant, size, className)}
      disabled={disabled ?? pending}
      aria-busy={pending || undefined}
      {...rest}
    >
      {pending ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 animate-spin" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
          <path
            d="M21 12a9 9 0 0 0-9-9"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      ) : null}
      <span>{pending && pendingLabel ? pendingLabel : children}</span>
    </button>
  );
}

/**
 * A button that asks for confirmation before submitting its form — for destructive or
 * irreversible actions (reverse a transfer, revoke a key).
 */
export function ConfirmSubmitButton({
  confirm,
  onClick,
  ...rest
}: SubmitButtonProps & { confirm: string }) {
  return (
    <SubmitButton
      {...rest}
      onClick={(event) => {
        if (!window.confirm(confirm)) event.preventDefault();
        else onClick?.(event);
      }}
    />
  );
}

/** Visually groups a form's actions at the bottom. */
export function FormActions({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-wrap items-center gap-3 pt-1', className)}>{children}</div>;
}
