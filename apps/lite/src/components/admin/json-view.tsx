/** Pretty-printed JSON (audit before / after, event payloads). Renders nothing for null. */
export function JsonView({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <pre className="mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-fg">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
