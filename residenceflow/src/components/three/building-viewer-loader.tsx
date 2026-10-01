"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { BuildingViewer } from "./building-viewer";

// Three.js only runs in the browser; load it lazily so the rest of the app stays light.
const Viewer = dynamic(() => import("./building-viewer").then((m) => m.BuildingViewer), {
  ssr: false,
  loading: () => (
    <div className="flex h-[70vh] min-h-[420px] items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
      3D…
    </div>
  ),
});

export function BuildingViewerLoader(props: ComponentProps<typeof BuildingViewer>) {
  return <Viewer {...props} />;
}
