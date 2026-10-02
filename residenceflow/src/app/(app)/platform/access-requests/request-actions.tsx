"use client";

import { useActionState } from "react";
import { approveRequestAction, rejectRequestAction } from "./actions";
import type { ActionResult } from "@/lib/action";

type Approved = { code: string; expiresAt: string; emailed: boolean; email: string };

export function RequestActions({ id, canDecide, labels, tz }: { id: string; canDecide: boolean; tz: string; labels: { approve: string; reject: string; done: string; notEmailed: string } }) {
  const [a, approve] = useActionState(approveRequestAction as (p: ActionResult<Approved> | null, fd: FormData) => Promise<ActionResult<Approved>>, null);
  const [r, reject] = useActionState(rejectRequestAction, null);
  if (a?.ok && a.data) {
    const time = new Date(a.data.expiresAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    return (
      <div role="status" className="max-w-xs rounded-md border border-green-300 bg-green-50 px-2 py-2 text-xs text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
        <p>{(a.data.emailed ? labels.done : labels.notEmailed).replace("{time}", time)}</p>
        <p data-testid="access-code" className="mt-1 font-mono text-lg font-semibold tracking-widest">{a.data.code}</p>
      </div>
    );
  }
  if (r?.ok) return <span className="text-xs text-slate-500">—</span>;
  if (!canDecide) return <span className="text-xs text-slate-500">—</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex gap-2">
        <form action={approve}><input type="hidden" name="id" value={id} /><button className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs font-medium text-white hover:brightness-110">{labels.approve}</button></form>
        <form action={reject}><input type="hidden" name="id" value={id} /><button className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600">{labels.reject}</button></form>
      </div>
      {a && !a.ok && <span role="alert" className="text-xs text-red-700">{a.error}</span>}
      {r && !r.ok && <span role="alert" className="text-xs text-red-700">{r.error}</span>}
    </div>
  );
}
