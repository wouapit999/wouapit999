'use client';

import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
  useState,
} from 'react';

import { cn } from '@/lib/cn';
import { useT } from '@/i18n/provider';

interface FieldChromeProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
  /** Set to `false` to stop announcing "required" on fields that are always required. */
  showRequiredMarker?: boolean;
}

const INPUT_CLASSES =
  'block w-full rounded-lg border bg-surface-raised px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle shadow-sm transition-colors ' +
  'border-border-strong hover:border-fg-subtle focus:border-brand-600 disabled:cursor-not-allowed disabled:bg-surface-muted ' +
  'aria-[invalid=true]:border-danger';

function Chrome({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: FieldChromeProps & { id: string; children: ReactNode }) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="flex items-baseline justify-between text-sm font-medium text-fg"
      >
        <span>{label}</span>
        {optional ? (
          <span className="text-xs font-normal text-fg-subtle">{t('field.optional')}</span>
        ) : null}
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
  const ids: string[] = [];
  if (error) ids.push(`${id}-error`);
  else if (hint) ids.push(`${id}-hint`);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export type TextFieldProps = FieldChromeProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & { id?: string };

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, optional, className, id: idProp, ...rest },
  ref,
) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <Chrome id={id} label={label} hint={hint} error={error} optional={optional}>
      <input
        ref={ref}
        id={id}
        className={cn(INPUT_CLASSES, className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
    </Chrome>
  );
});

export type PasswordFieldProps = Omit<TextFieldProps, 'type'>;

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ label, hint, error, optional, className, id: idProp, ...rest }, ref) {
    const t = useT();
    const generated = useId();
    const id = idProp ?? generated;
    const [visible, setVisible] = useState(false);
    return (
      <Chrome id={id} label={label} hint={hint} error={error} optional={optional}>
        <div className="relative">
          <input
            ref={ref}
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
            aria-label={visible ? t('field.hidePassword') : t('field.showPassword')}
            aria-pressed={visible}
          >
            <EyeIcon open={visible} />
          </button>
        </div>
      </Chrome>
    );
  },
);

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectFieldProps = FieldChromeProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
    id?: string;
    options: readonly SelectOption[];
    placeholder?: string;
  };

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, optional, className, id: idProp, options, placeholder, ...rest },
  ref,
) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <Chrome id={id} label={label} hint={hint} error={error} optional={optional}>
      <select
        ref={ref}
        id={id}
        className={cn(INPUT_CLASSES, 'appearance-none bg-no-repeat pr-10', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
          backgroundPosition: 'right 0.75rem center',
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Chrome>
  );
});

export type CheckboxFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> & {
  id?: string;
  label: ReactNode;
  error?: string | undefined;
};

export const CheckboxField = forwardRef<HTMLInputElement, CheckboxFieldProps>(
  function CheckboxField({ label, error, className, id: idProp, ...rest }, ref) {
    const generated = useId();
    const id = idProp ?? generated;
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-3">
          <input
            ref={ref}
            id={id}
            type="checkbox"
            className={cn(
              'mt-0.5 h-5 w-5 shrink-0 rounded border-border-strong text-brand-600 accent-brand-600',
              className,
            )}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            {...rest}
          />
          <label htmlFor={id} className="text-sm text-fg">
            {label}
          </label>
        </div>
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {open ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="m1 1 22 22" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
