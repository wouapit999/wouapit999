import { type PhaseStatus, type RoadmapPhase, phaseStatus } from '@/data/lite-phases';
import { formatDate } from '@/lib/format';

/**
 * Compact programme timeline: one bar per phase on a shared time axis, with year marks and a
 * "today" line. It is a picture of the list that follows, so it is exposed to assistive
 * technology as a single image with a text summary; every date is in the phase cards below.
 */

const DAY = 86_400_000;
const dayOf = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

const BAR_CLASSES: Readonly<Record<PhaseStatus, string>> = {
  DONE: 'bg-brand-600',
  IN_PROGRESS: 'bg-gold-500',
  PLANNED: 'bg-brand-300',
};

const LEGEND: ReadonlyArray<{ status: PhaseStatus; label: string }> = [
  { status: 'PLANNED', label: 'Planned' },
  { status: 'IN_PROGRESS', label: 'In progress' },
  { status: 'DONE', label: 'Scheduled end passed' },
];

export function RoadmapTimeline({
  phases,
  today,
}: {
  phases: readonly RoadmapPhase[];
  today: Date;
}) {
  const first = phases[0];
  const last = phases[phases.length - 1];
  if (!first || !last) return null;
  const start = Math.min(...phases.map((phase) => dayOf(phase.start)));
  const end = Math.max(...phases.map((phase) => dayOf(phase.end))) + DAY;
  const span = end - start;
  const percent = (time: number): number =>
    Math.round((Math.min(Math.max(time - start, 0), span) / span) * 10_000) / 100;

  const now = today.getTime();
  const todayInRange = now >= start && now <= end;
  const active = phases.filter((phase) => phaseStatus(phase, today) === 'IN_PROGRESS');
  const summary =
    now < start
      ? `The programme starts on ${formatDate(first.start)}.`
      : now > end
        ? `The planned programme ended on ${formatDate(last.end)}.`
        : active.length > 0
          ? `Today falls in phase ${active.map((phase) => phase.id).join(' and ')}.`
          : 'Today falls between two phases.';

  // Year boundaries inside the range, as axis marks.
  const marks: Array<{ label: string; at: number }> = [];
  const firstYear = new Date(start).getUTCFullYear();
  const lastYear = new Date(end).getUTCFullYear();
  for (let year = firstYear + 1; year <= lastYear; year += 1) {
    marks.push({ label: String(year), at: percent(Date.UTC(year, 0, 1)) });
  }

  return (
    <figure className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-4 shadow-[var(--shadow-card)] sm:p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-semibold text-fg">Timeline</span>
        <span className="text-xs text-fg-muted">
          {formatDate(first.start)} → {formatDate(last.end)} · {summary}
        </span>
      </figcaption>

      <div
        role="img"
        aria-label={`Programme timeline: ${phases.length} phases from ${formatDate(first.start)} to ${formatDate(last.end)}. ${summary} The dates of each phase are listed below.`}
        className="mt-4"
      >
        <div className="relative">
          {/* Year marks and the today line span every row. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-7 right-0">
            {marks.map((mark) => (
              <span
                key={mark.label}
                className="absolute inset-y-0 border-l border-dashed border-border-strong"
                style={{ left: `${mark.at}%` }}
              />
            ))}
            {todayInRange ? (
              <span
                className="absolute inset-y-0 w-0.5 bg-danger"
                style={{ left: `${percent(now)}%` }}
              />
            ) : null}
          </div>
          <ul className="space-y-1.5">
            {phases.map((phase) => {
              const left = percent(dayOf(phase.start));
              const width = Math.max(percent(dayOf(phase.end) + DAY) - left, 1.5);
              return (
                <li key={phase.id} className="flex items-center gap-2">
                  <span className="tabular w-5 shrink-0 text-right text-xs font-medium text-fg-muted">
                    {phase.id}
                  </span>
                  <span className="relative block h-4 flex-1 rounded-full bg-surface-muted">
                    <span
                      title={`Phase ${phase.id} · ${phase.name}: ${formatDate(phase.start)} → ${formatDate(phase.end)}`}
                      className={`absolute inset-y-0 rounded-full ${BAR_CLASSES[phaseStatus(phase, today)]}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div
          aria-hidden="true"
          className="relative ml-7 mt-1.5 h-4 text-[0.6875rem] text-fg-subtle"
        >
          {/* The first year is labelled only when it has room before the next year mark. */}
          {(marks[0]?.at ?? 100) >= 14 ? (
            <span className="absolute left-0">{new Date(start).getUTCFullYear()}</span>
          ) : null}
          {marks.map((mark) => (
            <span key={mark.label} className="absolute pl-1" style={{ left: `${mark.at}%` }}>
              {mark.label}
            </span>
          ))}
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        {LEGEND.map((item) => (
          <li key={item.status} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`size-2.5 rounded-full ${BAR_CLASSES[item.status]}`}
            />
            {item.label}
          </li>
        ))}
        {todayInRange ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3 w-0.5 bg-danger" />
            Today
          </li>
        ) : null}
      </ul>
    </figure>
  );
}
