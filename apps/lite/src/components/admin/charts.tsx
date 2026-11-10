import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Dependency-free charts for the dashboards: inline SVG / CSS only. Every chart has a text
 * alternative — a summary on the graphic and the exact figures in a data table (visible list or
 * a "Show data" disclosure) — and never relies on colour alone.
 */

export interface ChartPoint {
  /** Axis label, e.g. `2026-11-10`. */
  readonly label: string;
  /** Height of the bar (display scale only — exact figures go in `display`). */
  readonly value: number;
  /** Exact, formatted figure shown in the tooltip and the data table. */
  readonly display: string;
  /** Optional second series stacked on top (e.g. FX margin on fees). */
  readonly value2?: number;
  readonly display2?: string;
}

const shortDate = (label: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(label) ? `${label.slice(8, 10)}/${label.slice(5, 7)}` : label;

/** Vertical bars over time (one bar per point), optionally stacked with a second series. */
export function BarChart({
  title,
  points,
  seriesLabel,
  series2Label,
  summary,
  height = 160,
  axisLabels = true,
}: {
  title: string;
  points: readonly ChartPoint[];
  seriesLabel: string;
  series2Label?: string;
  /** One-sentence takeaway read by screen readers instead of the bars. */
  summary: string;
  height?: number;
  /** Print first / middle / last labels under the bars (turn off for non-date series). */
  axisLabels?: boolean;
}) {
  const width = 640;
  const padding = { top: 8, right: 4, bottom: 2, left: 4 };
  const innerHeight = height - padding.top - padding.bottom;
  const innerWidth = width - padding.left - padding.right;
  const max = Math.max(...points.map((point) => point.value + (point.value2 ?? 0)), 0);
  const step = points.length > 0 ? innerWidth / points.length : innerWidth;
  const barWidth = Math.max(Math.min(step * 0.72, 28), 1.5);
  const scale = (value: number): number => (max <= 0 ? 0 : (value / max) * innerHeight);
  const stacked = series2Label !== undefined;

  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium text-fg">{title}</span>
        {stacked ? (
          <span className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-sm bg-accent" />
              {seriesLabel}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-sm bg-gold-500" />
              {series2Label}
            </span>
          </span>
        ) : null}
      </figcaption>
      {max <= 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-fg-muted">
          No activity in this period.
        </p>
      ) : (
        <svg
          role="img"
          aria-label={`${title}. ${summary}`}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-40 w-full"
        >
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + innerHeight}
            y2={padding.top + innerHeight}
            stroke="var(--border-strong)"
            strokeWidth="1"
          />
          {points.map((point, index) => {
            const x = padding.left + index * step + (step - barWidth) / 2;
            const first = scale(point.value);
            const second = scale(point.value2 ?? 0);
            const base = padding.top + innerHeight;
            return (
              <g key={point.label}>
                <title>
                  {`${point.label}: ${seriesLabel} ${point.display}${
                    stacked && point.display2 ? `, ${series2Label} ${point.display2}` : ''
                  }`}
                </title>
                {first > 0 ? (
                  <rect
                    x={x}
                    y={base - first}
                    width={barWidth}
                    height={first}
                    rx="1.5"
                    fill="var(--accent)"
                  />
                ) : null}
                {second > 0 ? (
                  <rect
                    x={x}
                    y={base - first - second - (first > 0 ? 1 : 0)}
                    width={barWidth}
                    height={second}
                    rx="1.5"
                    fill="var(--color-gold-500)"
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
      )}
      {max > 0 && axisLabels && points.length > 1 ? (
        // Axis labels live in HTML: text inside a stretched SVG would be distorted.
        <div
          aria-hidden="true"
          className="tabular flex justify-between text-[0.6875rem] text-fg-subtle"
        >
          <span>{shortDate(points[0]?.label ?? '')}</span>
          {points.length > 4 ? (
            <span>{shortDate(points[Math.floor(points.length / 2)]?.label ?? '')}</span>
          ) : null}
          <span>{shortDate(points[points.length - 1]?.label ?? '')}</span>
        </div>
      ) : null}
      {points.length > 0 ? (
        <details className="text-xs text-fg-muted">
          <summary className="cursor-pointer select-none hover:text-fg">Show data</summary>
          <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-border">
            <table className="w-full text-left">
              <caption className="sr-only">{title}</caption>
              <thead className="bg-surface-muted/60 text-fg-subtle">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    {seriesLabel}
                  </th>
                  {stacked ? (
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">
                      {series2Label}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {points.map((point) => (
                  <tr key={point.label}>
                    <th scope="row" className="px-3 py-1 font-normal">
                      {point.label}
                    </th>
                    <td className="tabular px-3 py-1 text-right">{point.display}</td>
                    {stacked ? (
                      <td className="tabular px-3 py-1 text-right">{point.display2 ?? '—'}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}

export interface BarListItem {
  readonly key: string;
  readonly label: ReactNode;
  readonly value: number;
  readonly display: string;
  readonly hint?: string;
}

/** Horizontal bars for a ranking (countries, corridors, rules…). The figures are always visible. */
export function BarList({
  items,
  emptyLabel = 'Nothing to show for this period.',
  tone = 'accent',
}: {
  items: readonly BarListItem[];
  emptyLabel?: string;
  tone?: 'accent' | 'gold' | 'danger';
}) {
  const max = Math.max(...items.map((item) => item.value), 0);
  if (items.length === 0) return <p className="text-sm text-fg-muted">{emptyLabel}</p>;
  const fill = tone === 'gold' ? 'bg-gold-500' : tone === 'danger' ? 'bg-danger' : 'bg-accent';
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.key} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-fg">{item.label}</span>
            <span className="tabular shrink-0 font-medium text-fg">{item.display}</span>
          </div>
          <div aria-hidden="true" className="mt-1 h-2 rounded-full bg-surface-muted">
            <div
              className={cn('h-2 rounded-full', fill)}
              style={{ width: `${max <= 0 ? 0 : Math.max((item.value / max) * 100, 1.5)}%` }}
            />
          </div>
          {item.hint ? <p className="mt-0.5 text-xs text-fg-muted">{item.hint}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export interface Segment {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
}

const SEGMENT_FILL: Record<Segment['tone'], string> = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-fg-subtle',
};

/** One stacked bar showing parts of a whole, with a legend that carries the numbers. */
export function SegmentBar({ title, segments }: { title: string; segments: readonly Segment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const visible = segments.filter((segment) => segment.value > 0);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-fg">{title}</p>
      {total === 0 ? (
        <p className="text-sm text-fg-muted">Nothing to show for this period.</p>
      ) : (
        <>
          <div aria-hidden="true" className="flex h-3 gap-0.5 overflow-hidden rounded-full">
            {visible.map((segment) => (
              <div
                key={segment.key}
                className={SEGMENT_FILL[segment.tone]}
                style={{ width: `${(segment.value / total) * 100}%` }}
              />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
            {visible.map((segment) => (
              <li key={segment.key} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn('size-2.5 rounded-sm', SEGMENT_FILL[segment.tone])}
                />
                <span>
                  {segment.label}{' '}
                  <span className="tabular font-medium text-fg">
                    {segment.value} ({Math.round((segment.value / total) * 100)}%)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
