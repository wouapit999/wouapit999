"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui";

export interface MatrixGroup {
  key: string;
  label: string;
  permissions: { value: string; label: string; locked?: boolean; powerful?: boolean }[];
}

/** Permission checkboxes grouped by module, with "select all in group" and a read-only preset. */
export function PermissionMatrix({
  groups,
  initial,
  labels,
  disabled = false,
}: {
  groups: MatrixGroup[];
  initial: string[];
  labels: { selectAll: string; clearAll: string; readOnly: string; powerful: string; locked: string; selected: string };
  disabled?: boolean;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial));
  const all = groups.flatMap((g) => g.permissions);
  const locked = new Set(all.filter((p) => p.locked).map((p) => p.value));
  const update = (fn: (s: Set<string>) => void) =>
    setSel((prev) => {
      const next = new Set(prev);
      fn(next);
      for (const l of locked) if (prev.has(l)) next.add(l);
      return next;
    });

  return (
    <div className="space-y-3">
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass("secondary")} onClick={() => update((s) => { s.clear(); for (const p of all) if (p.value.endsWith(".view")) s.add(p.value); })}>{labels.readOnly}</button>
          <button type="button" className={buttonClass("ghost")} onClick={() => update((s) => s.clear())}>{labels.clearAll}</button>
          <span className="text-xs text-slate-500">{labels.selected.replace("{n}", String(sel.size))}</span>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => {
          const allOn = g.permissions.every((p) => sel.has(p.value));
          return (
            <fieldset key={g.key} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <legend className="px-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{g.label}</legend>
              {!disabled && (
                <label className="mb-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={(e) => update((s) => { for (const p of g.permissions) { if (e.target.checked) s.add(p.value); else s.delete(p.value); } })}
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                  {labels.selectAll}
                </label>
              )}
              <ul className="space-y-1">
                {g.permissions.map((p) => (
                  <li key={p.value}>
                    <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        name="permissions"
                        value={p.value}
                        checked={sel.has(p.value)}
                        disabled={disabled || (p.locked && sel.has(p.value))}
                        onChange={(e) => update((s) => { if (e.target.checked) s.add(p.value); else s.delete(p.value); })}
                        className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
                      />
                      <span className="min-w-0">
                        <span className="block">{p.label}</span>
                        <span className="block font-mono text-[11px] text-slate-500">{p.value}</span>
                        {p.powerful && <span className="mr-1 inline-block rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{labels.powerful}</span>}
                        {p.locked && <span className="inline-block rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">{labels.locked}</span>}
                      </span>
                    </label>
                    {/* disabled inputs are not submitted: keep locked permissions in the payload */}
                    {p.locked && sel.has(p.value) && <input type="hidden" name="permissions" value={p.value} />}
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
