import { CopyButton } from './copy-button';

/**
 * A copyable code sample. Scrolls horizontally inside its own box (it never widens the page) and
 * is reachable by keyboard so a clipped line can be scrolled without a mouse.
 */
export function CodeBlock({
  code,
  label,
  language,
}: {
  code: string;
  /** What the sample is, announced to screen readers and shown above the block. */
  label: string;
  language?: string;
}) {
  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-surface-muted">
      <figcaption className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-fg-muted">
          {label}
          {language ? <span className="ml-1.5 text-fg-subtle">· {language}</span> : null}
        </span>
        <CopyButton value={code} variant="ghost" className="h-7 px-2 text-xs" />
      </figcaption>
      <pre
        tabIndex={0}
        aria-label={label}
        className="overflow-x-auto px-3 py-3 font-mono text-[0.8125rem] leading-relaxed text-fg"
      >
        <code>{code}</code>
      </pre>
    </figure>
  );
}
