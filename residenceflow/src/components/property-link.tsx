"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  id: string;
  name: string;
  /** Second line in the card (reference, city…). */
  subtitle?: string | null;
  className?: string;
  children?: ReactNode;
}

const SHOW_DELAY = 180;
const CARD_W = 300;
const CARD_H = 236;

/**
 * Link to a building that shows a floating picture of it when the pointer rests beside the link
 * (or when the link receives keyboard focus). The picture is the server-rendered isometric view
 * at /api/properties/:id/preview, so it respects the viewer's permissions and scope.
 */
export function PropertyLink({ id, name, subtitle, className, children }: Props) {
  const ref = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [failed, setFailed] = useState(false);

  function place() {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer the right of the link; fall back to the left, then below.
    let left = r.right + 12;
    let top = Math.min(Math.max(8, r.top - 40), vh - CARD_H - 8);
    if (left + CARD_W > vw - 8) {
      left = r.left - CARD_W - 12;
      if (left < 8) {
        left = Math.min(Math.max(8, r.left), vw - CARD_W - 8);
        top = r.bottom + 8 + CARD_H > vh ? Math.max(8, r.top - CARD_H - 8) : r.bottom + 8;
      }
    }
    setPos({ top, left });
  }

  function show() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(place, SHOW_DELAY);
  }
  function hide() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPos(null);
  }

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, [pos]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <>
      <Link
        ref={ref}
        href={`/properties/${id}`}
        className={className ?? "hover:underline"}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={pos ? `building-preview-${id}` : undefined}
      >
        {children ?? name}
      </Link>
      {pos && (
        <div
          id={`building-preview-${id}`}
          role="tooltip"
          data-testid="building-preview"
          className="pointer-events-none fixed z-50 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
          style={{ top: pos.top, left: pos.left, width: CARD_W }}
        >
          <div className="flex h-[170px] items-center justify-center bg-gradient-to-b from-sky-50 to-slate-100 dark:from-slate-800 dark:to-slate-900">
            {failed ? (
              <span className="text-4xl" aria-hidden>🏢</span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/properties/${id}/preview`}
                alt={name}
                width={CARD_W}
                height={170}
                className="h-full w-full object-contain p-2"
                onError={() => setFailed(true)}
              />
            )}
          </div>
          <div className="px-3 py-2">
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{name}</div>
            {subtitle && <div className="truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>}
          </div>
        </div>
      )}
    </>
  );
}
