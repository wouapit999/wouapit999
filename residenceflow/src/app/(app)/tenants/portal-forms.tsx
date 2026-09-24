"use client";

import { useActionState, type ReactNode } from "react";
import { SubmitButton } from "@/components/forms";
import type { ActionResult } from "@/lib/action";
import { cn, inputClass } from "@/components/ui";

type LinkResult = ActionResult<{ link: string; emailed: boolean }>;
type LinkAction = (prev: LinkResult | null, fd: FormData) => Promise<LinkResult>;

export interface LinkFormLabels {
  submit: string;
  linkOnce: string;
  emailed: string;
  notEmailed: string;
  fixFields?: string;
}

/**
 * Form for actions that return a one-time activation link. The link lives only in this component's
 * state (never persisted client-side) and disappears on navigation.
 */
export function LinkActionForm({
  action,
  labels,
  children,
  className,
  compact = false,
}: {
  action: LinkAction;
  labels: LinkFormLabels;
  children?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const link = state?.ok ? state.data?.link : undefined;
  return (
    <div className={cn("space-y-3", className)}>
      <form action={formAction} className={compact ? "inline-flex" : "space-y-4"}>
        {children}
        <SubmitButton variant={compact ? "secondary" : "primary"}>{labels.submit}</SubmitButton>
      </form>
      {state && !state.ok && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p>{state.error === "Please correct the highlighted fields." && labels.fixFields ? labels.fixFields : state.error}</p>
          {state.fieldErrors && (
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(state.fieldErrors).map(([k, v]) => (
                <li key={k}><strong>{k}</strong>: {v.join(", ")}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {link && (
        <div role="status" className="space-y-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          {state?.ok && state.message && <p className="font-medium">{state.message}</p>}
          <p>{labels.linkOnce}</p>
          <input
            readOnly
            value={link}
            aria-label={labels.linkOnce}
            onFocus={(e) => e.currentTarget.select()}
            className={cn(inputClass, "font-mono text-xs")}
          />
          <p className="text-xs">{state?.ok && state.data?.emailed ? labels.emailed : labels.notEmailed}</p>
        </div>
      )}
    </div>
  );
}
