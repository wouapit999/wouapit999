"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action";
import { buttonClass, cn } from "@/components/ui";

type Action = (prev: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;

/** One-time data a server action may return (shown once, never stored in the page). */
export interface OneTimeData {
  link?: string;
  emailSent?: boolean;
  codes?: string[];
  secret?: string;
  uri?: string;
  rows?: { line: number; ok: boolean; message: string; label?: string; link?: string }[];
}

export interface ResultLabels {
  link?: string;
  codes?: string;
  secret?: string;
  uri?: string;
  emailSent?: string;
  emailNotSent?: string;
  once?: string;
  copy?: string;
  copied?: string;
  rows?: string;
}

function CopyButton({ value, labels }: { value: string; labels: ResultLabels }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary", "shrink-0 px-2 py-1 text-xs")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          /* clipboard unavailable: user can select the text manually */
        }
      }}
    >
      {done ? labels.copied ?? "Copied" : labels.copy ?? "Copy"}
    </button>
  );
}

function Secret({ label, value, labels }: { label?: string; value: string; labels: ResultLabels }) {
  return (
    <div className="space-y-1">
      {label && <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">{label}</p>}
      <div className="flex items-start gap-2">
        <code className="block min-w-0 flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700">{value}</code>
        <CopyButton value={value} labels={labels} />
      </div>
    </div>
  );
}

/**
 * Like ActionForm, but also renders one-time data returned by the action (activation/reset links,
 * MFA secrets, recovery codes, import reports). The data lives only in client memory.
 */
export function ResultForm({
  action,
  children,
  className,
  labels = {},
  dict,
  confirm,
  resetOnSuccess = false,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  labels?: ResultLabels;
  dict?: Record<string, string>;
  confirm?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const data = (state?.ok ? (state.data as OneTimeData | undefined) : undefined) ?? undefined;
  const tr = (s: string) => dict?.[s] ?? s;

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
          <p>{tr(state.error)}</p>
          {state.fieldErrors && (
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(state.fieldErrors).map(([k, v]) => (
                <li key={k}><strong>{k}</strong>: {v.join(", ")}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {state?.ok && (
        <div role="status" className="space-y-3 rounded-md border border-green-300 bg-green-50 px-3 py-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          {state.message && <p>{tr(state.message)}</p>}
          {data?.emailSent !== undefined && <p>{data.emailSent ? labels.emailSent : labels.emailNotSent}</p>}
          {data?.link && <Secret label={labels.link} value={data.link} labels={labels} />}
          {data?.secret && <Secret label={labels.secret} value={data.secret} labels={labels} />}
          {data?.uri && <Secret label={labels.uri} value={data.uri} labels={labels} />}
          {data?.codes && data.codes.length > 0 && (
            <div className="space-y-1">
              {labels.codes && <p className="text-xs font-medium uppercase tracking-wide">{labels.codes}</p>}
              <ul className="grid grid-cols-2 gap-1 font-mono text-xs sm:grid-cols-5">
                {data.codes.map((c) => <li key={c} className="rounded bg-white px-2 py-1 text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700">{c}</li>)}
              </ul>
              <CopyButton value={data.codes.join("\n")} labels={labels} />
            </div>
          )}
          {data?.rows && (
            <div className="overflow-x-auto">
              {labels.rows && <p className="mb-1 text-xs font-medium uppercase tracking-wide">{labels.rows}</p>}
              <table className="min-w-full text-xs">
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.line} className={r.ok ? "" : "text-red-800 dark:text-red-300"}>
                      <td className="pr-2 align-top font-mono">#{r.line}</td>
                      <td className="pr-2 align-top">{r.ok ? "✓" : "✗"} {r.label && <span className="font-medium">{r.label} — </span>}{tr(r.message)}</td>
                      <td className="align-top">{r.link && <Secret value={r.link} labels={labels} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(data?.link || data?.secret || data?.codes || data?.rows?.some((r) => r.link)) && labels.once && (
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{labels.once}</p>
          )}
        </div>
      )}
      {children}
    </form>
  );
}
