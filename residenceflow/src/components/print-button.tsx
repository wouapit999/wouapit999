"use client";

import { buttonClass } from "./ui";

export function PrintButton({ label = "Print / PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("secondary", "no-print")}>
      {label}
    </button>
  );
}
