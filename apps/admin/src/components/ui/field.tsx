'use client';

import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
  useState,
} from 'react';

import { cn } from '@/lib/cn';

import { Icon } from './icons';

/**
 * Accessible form fields: every control is labelled, errors are announced through `role="alert"`
 * and linked with `aria-describedby`, and invalid state is exposed via `aria-invalid`. Designed for
 * react-hook-form (`{...register('name')}` spreads `ref`, `name`, `onChange`, `onBlur`).
 */

interface FieldChromeProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
}

export const INPUT_CLASSES =
  'block w-full rounded-lg border bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-subtle shadow-sm transition-colors ' +
  'border-border-strong hover:border-fg-subtle focus:border-accent disabled:cursor-not-allowed disabled:bg-surface-muted ' +
  'aria-[invalid=true]:border-danger';

function Chrome({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: FieldChromeProps & { id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="flex items-baseline justify-between text-sm font-medium text-fg"
      >
        <span>{label}</span>
        {optional ? <span className="text-xs font-normal text-fg-subtle">Optional</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export type TextFieldProps = FieldChromeProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
    id?: string;
    ref?: React.Ref<HTMLInputElement>;
  };

export function TextField({
  label,
  hint,
  error,
  optional,
  className,
  id: idProp,
  ...rest
}: TextFieldProps) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <Chrome id={id} label={label} hint={hint} error={error} optional={optional}>
      <input
        id={id}
        className={cn(INPUT_CLASSES, className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
    </Chrome>
  );
}

export type PasswordFieldProps = Omit<TextFieldProps, 'type'>;

export function PasswordField({
  label,
  hint,
  error,
  optional,
  className,
  id: idProp,
  ...rest
}: PasswordFieldProps) {
  const generated = useId();
  const id = idProp ?? generated;
  const [visible, setVisible] = useState(false);
  return (
    <Chrome id={id} label={label} hint={hint} error={error} optional={optional}>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className={cn(INPUT_CLASSES, 'pr-11', className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-fg-subtle hover:text-fg"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} />
        </button>
      </div>
    </Chrome>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectFieldProps = FieldChromeProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
    id?: string;
    ref?: React.Ref<HTMLSelectElement>;
    options: readonly SelectOption[];
    placeholder?: string;
  };

const SELECT_ARROW =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")";

export function SelectField({
  label,
  hint,
  error,
  optional,
  className,
  id: idProp,
  options,
  placeholder,
  ...rest
}: SelectFieldProps) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <Chrome id={id} label={label} hint={hint} error={error} optional={optional}>
      <select
        id={id}
        className={cn(INPUT_CLASSES, 'appearance-none bg-no-repeat pr-10', className)}
        style={{ backgroundImage: SELECT_ARROW, backgroundPosition: 'right 0.75rem center' }}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Chrome>
  );
}

export type TextareaFieldProps = FieldChromeProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
    id?: string;
    ref?: React.Ref<HTMLTextAreaElement>;
  };

export function TextareaField({
  label,
  hint,
  error,
  optional,
  className,
  id: idProp,
  rows = 4,
  ...rest
}: TextareaFieldProps) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <Chrome id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        id={id}
        rows={rows}
        className={cn(
          INPUT_CLASSES,
          'min-h-24 resize-y font-mono text-xs leading-relaxed',
          className,
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
    </Chrome>
  );
}

export type CheckboxFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> & {
  id?: string;
  ref?: React.Ref<HTMLInputElement>;
  label: ReactNode;
  description?: ReactNode;
  error?: string | undefined;
};

export function CheckboxField({
  label,
  description,
  error,
  className,
  id: idProp,
  ...rest
}: CheckboxFieldProps) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong accent-accent',
            className,
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : description ? `${id}-desc` : undefined}
          {...rest}
        />
        <label htmlFor={id} className="text-sm text-fg">
          {label}
          {description ? (
            <span id={`${id}-desc`} className="block text-xs text-fg-muted">
              {description}
            </span>
          ) : null}
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Accessible toggle switch (`role="switch"`). Controlled only. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  size = 'md',
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const knob = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  const travel = size === 'sm' ? 'translate-x-4' : 'translate-x-5';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full border-2 border-transparent transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-border-strong',
        track,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block transform rounded-full bg-white shadow transition-transform',
          knob,
          checked ? travel : 'translate-x-0',
        )}
      />
    </button>
  );
}
