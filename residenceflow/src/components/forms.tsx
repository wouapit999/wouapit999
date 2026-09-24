"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/action";
import { buttonClass, cn } from "./ui";

type Action = (prev: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;

export function SubmitButton({ children, variant = "primary", className, pendingLabel, disabled }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost"; className?: string; pendingLabel?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-busy={pending} className={buttonClass(variant, className)}>
      {pending ? pendingLabel ?? "…" : children}
    </button>
  );
}

/**
 * Form bound to a server action returning ActionResult. Shows inline validation errors,
 * a success message, and optionally resets on success. Server actions still validate everything.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  successMessage,
  confirm,
  dict,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
  confirm?: string;
  /** Translations for error/message keys returned by the action. */
  dict?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const [showOk, setShowOk] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      setShowOk(true);
      const t = setTimeout(() => setShowOk(false), 4000);
      return () => clearTimeout(t);
    }
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={cn("space-y-4", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {state && !state.ok && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p>{dict?.[state.error] ?? state.error}</p>
          {state.fieldErrors && (
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(state.fieldErrors).map(([k, v]) => (
                <li key={k}>
                  <strong>{k}</strong>: {v.join(", ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {showOk && state?.ok && (
        <div role="status" className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          {(state.message && (dict?.[state.message] ?? state.message)) ?? successMessage ?? "Saved."}
        </div>
      )}
      {children}
    </form>
  );
}

/** Small inline form with a single button (e.g. approve / archive) and optional confirmation. */
export function InlineAction({
  action,
  label,
  variant = "secondary",
  confirm,
  hidden,
}: {
  action: Action;
  label: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  confirm?: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant}>{label}</SubmitButton>
      {state && !state.ok && <span role="alert" className="text-xs text-red-700 dark:text-red-400">{state.error}</span>}
      {state?.ok && state.message && <span role="status" className="text-xs text-green-700 dark:text-green-400">{state.message}</span>}
    </form>
  );
}
