/** Skeleton shown while a customer page loads (the shell stays in place). */
export default function CustomerLoading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse space-y-5">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-lg bg-border" />
        <div className="h-4 w-72 max-w-full rounded bg-border" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-28 rounded-[var(--radius-card)] border border-border bg-surface-raised"
          />
        ))}
      </div>
      <div className="h-64 rounded-[var(--radius-card)] border border-border bg-surface-raised" />
    </div>
  );
}
