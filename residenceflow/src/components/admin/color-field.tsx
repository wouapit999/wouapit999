"use client";

import { useState } from "react";
import { contrastWithWhite } from "@/lib/branding";

/** Colour picker with a live preview of white text on the chosen colour and its contrast ratio. */
export function ColorField({ name, label, defaultValue, lowContrastLabel, checkContrast = false }: { name: string; label: string; defaultValue: string; lowContrastLabel?: string; checkContrast?: boolean }) {
  const [value, setValue] = useState(/^#[0-9a-f]{6}$/i.test(defaultValue) ? defaultValue : "#1d4ed8");
  const ratio = contrastWithWhite(value);
  const low = ratio < 4.5;
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>
      <div className="flex items-center gap-2">
        <input id={name} name={name} type="color" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-14 cursor-pointer rounded border border-slate-300 bg-white p-0.5 dark:border-slate-600" />
        <span className="rounded px-2 py-1 font-mono text-xs text-white" style={{ backgroundColor: value }}>{value}</span>
        <span className="text-xs text-slate-500">{ratio.toFixed(2)}:1</span>
      </div>
      {checkContrast && low && lowContrastLabel && <p className="text-xs text-amber-700 dark:text-amber-400">{lowContrastLabel}</p>}
    </div>
  );
}
