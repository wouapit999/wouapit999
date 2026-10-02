"use client";

import { useActionState } from "react";
import { decideByTokenAction } from "../../actions";
import { SubmitButton } from "@/components/forms";
import type { ActionResult } from "@/lib/action";

type Decision = { approved?: true; rejected?: true; code?: string; expiresAt?: string; emailed?: boolean; email?: string };

export function ApproveForm({ token, decided, labels, tz }: {
  token: string; decided: boolean; tz: string;
  labels: { approve: string; reject: string; done: string; notEmailed: string; rejected: string };
}) {
  const [state, action] = useActionState(decideByTokenAction as (p: ActionResult<Decision> | null, fd: FormData) => Promise<ActionResult<Decision>>, null);
  const data = state?.ok ? state.data : undefined;
  if (data?.rejected) return <div role="status" className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">{labels.rejected}</div>;
  if (data?.approved) {
    const time = new Date(data.expiresAt!).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    return (
      <div role="status" className="space-y-3 rounded-md border border-green-300 bg-green-50 px-3 py-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
        <p>{(data.emailed ? labels.done : labels.notEmailed).replace("{time}", time)}</p>
        <p className="font-mono text-2xl font-semibold tracking-widest">{data.code}</p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state && !state.ok && <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{state.error}</div>}
      {!decided && (
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="decision" value="approve" className="inline-flex items-center rounded-md bg-[var(--brand)] px-3 py-2 text-sm font-medium text-white hover:brightness-110">{labels.approve}</button>
          <button type="submit" name="decision" value="reject" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">{labels.reject}</button>
        </div>
      )}
      <SubmitButton className="hidden">·</SubmitButton>
    </form>
  );
}
