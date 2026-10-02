"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/forms";
import { inputClass } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import { matchLineAction } from "../actions";

export function MatchLineForm({ sessionId, line, options, labels }: { sessionId: string; line: number; options: { value: string; label: string }[]; labels: { choose: string; match: string; none: string } }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(matchLineAction, null);
  if (options.length === 0) return <span className="text-xs text-slate-500">{labels.none}</span>;
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="line" value={line} />
      <div className="flex items-center gap-1">
        <select name="paymentId" required className={`${inputClass} w-64 py-1 text-xs`} defaultValue="" aria-label={labels.match}>
          <option value="">{labels.choose}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <SubmitButton variant="secondary" className="py-1 text-xs">{labels.match}</SubmitButton>
      </div>
      {state && !state.ok && <span role="alert" className="text-xs text-red-700 dark:text-red-400">{state.error}</span>}
    </form>
  );
}
