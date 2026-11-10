'use client';

import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';

import { cn } from '@/lib/cn';

import { useFieldError, useFieldValue, useFormState } from './form';

/**
 * Labelled form controls. Each one renders its label, an optional hint and its error, wires
 * `aria-invalid` / `aria-describedby`, and — inside an `<ActionForm>` — shows the server-side
 * error for its `name` and keeps the submitted value after a failed submit.
 */

interface FieldChrome {
  label: ReactNode;
  hint?: ReactNode;
  /** Explicit error; defaults to the enclosing form's `fieldErrors[name]`. */
  error?: string;
  /** Hide the label visually (it stays available to screen readers). */
  hideLabel?: boolean;
  containerClassName?: string;
}

export const CONTROL_CLASSES =
  'block w-full rounded-lg border border-border-strong bg-surface-raised px-3 py-2.5 text-sm text-fg shadow-sm transition-colors ' +
  'placeholder:text-fg-subtle hover:border-fg-subtle focus:border-accent ' +
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-muted ' +
  'aria-[invalid=true]:border-danger';

function Chrome({
  id,
  label,
  hint,
  error,
  hideLabel,
  required,
  containerClassName,
  children,
}: FieldChrome & { id: string; required?: boolean; children: ReactNode }) {
  return (
    <div className={cn('space-y-1.5', containerClassName)}>
      <label
        htmlFor={id}
        className={cn('block text-sm font-medium text-fg', hideLabel && 'sr-only')}
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-danger">
            *
          </span>
        ) : (
          <span className="ml-1.5 text-xs font-normal text-fg-subtle">optional</span>
        )}
      </label>
      {children}
      {hint && !error ? (
        // Hints can carry unbreakable text (JSON, URLs): let it wrap instead of widening the page.
        <p id={`${id}-hint`} className="text-xs text-fg-muted [overflow-wrap:anywhere]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-xs font-medium text-danger [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint: ReactNode, error: string | undefined): string | undefined =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldChrome;

export function Input({
  label,
  hint,
  error,
  hideLabel,
  containerClassName,
  className,
  id,
  name,
  defaultValue,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const formError = useFieldError(name);
  const echoed = useFieldValue(name);
  const message = error ?? formError;
  const keepsValue = rest.type !== 'password' && rest.type !== 'file' && rest.value === undefined;
  return (
    <Chrome
      id={fieldId}
      label={label}
      hint={hint}
      error={message}
      hideLabel={hideLabel}
      required={rest.required}
      containerClassName={containerClassName}
    >
      <input
        id={fieldId}
        name={name}
        className={cn(CONTROL_CLASSES, className)}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, message)}
        {...(keepsValue ? { defaultValue: echoed ?? defaultValue } : {})}
        {...rest}
      />
    </Chrome>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldChrome;

export function Textarea({
  label,
  hint,
  error,
  hideLabel,
  containerClassName,
  className,
  id,
  name,
  defaultValue,
  rows = 4,
  ...rest
}: TextareaProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const formError = useFieldError(name);
  const echoed = useFieldValue(name);
  const message = error ?? formError;
  return (
    <Chrome
      id={fieldId}
      label={label}
      hint={hint}
      error={message}
      hideLabel={hideLabel}
      required={rest.required}
      containerClassName={containerClassName}
    >
      <textarea
        id={fieldId}
        name={name}
        rows={rows}
        className={cn(CONTROL_CLASSES, className)}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, message)}
        {...(rest.value === undefined ? { defaultValue: echoed ?? defaultValue } : {})}
        {...rest}
      />
    </Chrome>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> &
  FieldChrome & {
    options: readonly SelectOption[];
    /** First, empty option (e.g. "Choose a country"). */
    placeholder?: string;
  };

export function Select({
  label,
  hint,
  error,
  hideLabel,
  containerClassName,
  className,
  id,
  name,
  options,
  placeholder,
  defaultValue,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const formError = useFieldError(name);
  const echoed = useFieldValue(name);
  const message = error ?? formError;
  return (
    <Chrome
      id={fieldId}
      label={label}
      hint={hint}
      error={message}
      hideLabel={hideLabel}
      required={rest.required}
      containerClassName={containerClassName}
    >
      <select
        // Remount when the echoed value changes: React does not re-apply `defaultValue` to an
        // already-mounted <select>, and the form reset after an action would lose the choice.
        key={echoed ?? '_initial'}
        id={fieldId}
        name={name}
        className={cn(CONTROL_CLASSES, 'pr-8', className)}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, message)}
        {...(rest.value === undefined
          ? { defaultValue: echoed ?? defaultValue ?? (placeholder ? '' : undefined) }
          : {})}
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Chrome>
  );
}

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode;
  hint?: ReactNode;
};

export function Checkbox({
  label,
  hint,
  className,
  id,
  name,
  defaultChecked,
  ...rest
}: CheckboxProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const error = useFieldError(name);
  // After a failed submit the form resets: restore the box from the echoed values.
  const state = useFormState();
  const submitted = state && !state.ok && state.values ? state.values : null;
  const checkedByDefault = submitted && name ? Object.hasOwn(submitted, name) : defaultChecked;
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={fieldId}
        name={name}
        type="checkbox"
        className="mt-0.5 size-4 rounded border-border-strong accent-[var(--accent)]"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...(rest.checked === undefined ? { defaultChecked: checkedByDefault } : {})}
        {...rest}
      />
      <div className="text-sm">
        <label htmlFor={fieldId} className="font-medium text-fg">
          {label}
        </label>
        {hint && !error ? (
          <p id={`${fieldId}-hint`} className="text-xs text-fg-muted">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={`${fieldId}-error`} role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
