'use client';

import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { type DiffEntry, diffJson, formatDiffValue, summarizeDiff } from '@/lib/json-diff';

type View = 'changes' | 'before' | 'after';

const KIND_CLASSES: Record<DiffEntry['kind'], string> = {
  added: 'bg-diff-added',
  removed: 'bg-diff-removed',
  changed: 'bg-warning-soft/60',
  unchanged: '',
};

const KIND_LABEL: Record<DiffEntry['kind'], string> = {
  added: '+',
  removed: '−',
  changed: '~',
  unchanged: '=',
};

function snapshotText(value: unknown): string {
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable]';
  }
}

/** Before/after viewer for audit rows: flattened field changes plus the raw snapshots. */
export function JsonDiffViewer({ before, after }: { before: unknown; after: unknown }) {
  const [view, setView] = useState<View>('changes');
  const [showUnchanged, setShowUnchanged] = useState(false);

  const entries = useMemo(() => diffJson(before, after), [before, after]);
  const summary = useMemo(() => summarizeDiff(entries), [entries]);
  const visible = showUnchanged ? entries : entries.filter((entry) => entry.kind !== 'unchanged');
  const hasSnapshot = before !== null && before !== undefined;
  const hasAfter = after !== null && after !== undefined;

  if (!hasSnapshot && !hasAfter) {
    return <p className="text-sm text-fg-muted">This entry carries no before/after snapshot.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge tone="success">+{summary.added} added</Badge>
          <Badge tone="danger">−{summary.removed} removed</Badge>
          <Badge tone="warning">~{summary.changed} changed</Badge>
          <Badge tone="neutral">={summary.unchanged} unchanged</Badge>
        </div>
        <div
          role="group"
          aria-label="Diff view"
          className="inline-flex rounded-lg border border-border p-0.5 text-xs"
        >
          {(
            [
              ['changes', 'Changes'],
              ['before', 'Before'],
              ['after', 'After'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
              className={cn(
                'rounded-md px-2.5 py-1 font-medium',
                view === key ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'changes' ? (
        <>
          <label className="inline-flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-accent"
              checked={showUnchanged}
              onChange={(event) => setShowUnchanged(event.target.checked)}
            />
            Show unchanged fields
          </label>
          {visible.length === 0 ? (
            <p className="text-sm text-fg-muted">No field-level differences.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0}>
              <table className="w-full border-collapse font-mono text-xs">
                <caption className="sr-only">
                  Field changes between the before and after snapshots
                </caption>
                <thead className="bg-surface-muted text-left text-[11px] tracking-wide text-fg-subtle uppercase">
                  <tr>
                    <th scope="col" className="w-6 px-2 py-1.5" aria-label="Change kind" />
                    <th scope="col" className="px-2 py-1.5 font-semibold">
                      Path
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-semibold">
                      Before
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-semibold">
                      After
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((entry) => (
                    <tr key={`${entry.kind}:${entry.path}`} className={KIND_CLASSES[entry.kind]}>
                      <td className="px-2 py-1.5 text-center font-bold" aria-label={entry.kind}>
                        {KIND_LABEL[entry.kind]}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-fg">{entry.path}</td>
                      <td
                        className={cn(
                          'max-w-xs truncate px-2 py-1.5',
                          entry.kind === 'removed' || entry.kind === 'changed'
                            ? 'text-fg'
                            : 'text-fg-subtle',
                        )}
                        title={formatDiffValue(entry.before)}
                      >
                        {formatDiffValue(entry.before)}
                      </td>
                      <td
                        className={cn(
                          'max-w-xs truncate px-2 py-1.5',
                          entry.kind === 'added' || entry.kind === 'changed'
                            ? 'text-fg'
                            : 'text-fg-subtle',
                        )}
                        title={formatDiffValue(entry.after)}
                      >
                        {formatDiffValue(entry.after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-surface-muted p-3 font-mono text-xs leading-relaxed text-fg">
          {snapshotText(view === 'before' ? before : after)}
        </pre>
      )}
    </div>
  );
}
