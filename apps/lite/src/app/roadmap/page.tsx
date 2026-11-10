import type { Metadata } from 'next';

import { PublicShell } from '@/components/shell/public-shell';
import { Alert, Badge, Card, CardBody, StatusBadge } from '@/components/ui';
import { type PhaseStatus, ROADMAP, type RoadmapPhase, phaseStatus } from '@/data/lite-phases';
import { formatDate } from '@/lib/format';

import { RoadmapTimeline } from './timeline';

export const metadata: Metadata = {
  title: 'Roadmap',
  description:
    'The 13 phases of the BI-Rem programme with dates, tracks and dependencies — and what BI-Rem Lite already does for each.',
};

/** Phase status depends on today's date — refresh the static page hourly. */
export const revalidate = 3600;

const STATUS_LABELS: Readonly<Record<PhaseStatus, string>> = {
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  DONE: 'Scheduled end passed',
};

/** `team` in schedule.json is the delivery track that owns the phase. */
const TRACK_LABELS: Readonly<Record<string, string>> = {
  core: 'Core product track',
  platform: 'Platform track',
  compliance: 'Compliance track',
  mobile: 'Mobile track',
  all: 'All tracks',
};

const DAY = 86_400_000;
const dayOf = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const plural = (count: number, unit: string): string => `${count} ${unit}${count === 1 ? '' : 's'}`;

/** "starts in 6 days", "12 days left", "ended 10 Dec 2027" — relative to the schedule only. */
function relativeToToday(phase: RoadmapPhase, status: PhaseStatus, today: Date): string {
  const now = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  if (status === 'PLANNED') {
    const days = Math.round((dayOf(phase.start) - now) / DAY);
    return days <= 60 ? `starts in ${plural(days, 'day')}` : `starts ${formatDate(phase.start)}`;
  }
  if (status === 'IN_PROGRESS') {
    const days = Math.round((dayOf(phase.end) - now) / DAY);
    return days === 0 ? 'scheduled to end today' : `${plural(days, 'day')} left on the schedule`;
  }
  return `scheduled end ${formatDate(phase.end)}`;
}

/**
 * Public roadmap: the 13 phases of the BI-Rem programme (dates, track and dependencies from
 * docs/roadmap/schedule.json, copied into the app by scripts/sync-roadmap.mjs) and, for each,
 * what BI-Rem Lite already does.
 */
export default function RoadmapPage() {
  const today = new Date();
  const phases = ROADMAP.phases;
  const names = new Map(phases.map((phase) => [phase.id, phase.name]));
  const statuses = new Map(phases.map((phase) => [phase.id, phaseStatus(phase, today)]));
  const count = (status: PhaseStatus): number =>
    [...statuses.values()].filter((value) => value === status).length;
  const last = phases[phases.length - 1];

  return (
    <PublicShell>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {ROADMAP.program} programme roadmap
        </h1>
        <p className="mt-2 max-w-2xl text-fg-muted">
          The full platform is delivered in {phases.length} independently deployable phases, from{' '}
          {formatDate(ROADMAP.programStart)} to {formatDate(last?.end)}. BI-Rem Lite reflects each
          phase today at small scale; the dates below are the plan for the production-grade
          platform.
        </p>

        <dl className="mt-6 grid grid-cols-3 gap-3 text-center">
          {(
            [
              ['PLANNED', 'Planned'],
              ['IN_PROGRESS', 'In progress'],
              ['DONE', 'Past scheduled end'],
            ] as const
          ).map(([status, label]) => (
            <div
              key={status}
              className="rounded-lg border border-border bg-surface-raised px-2 py-3"
            >
              <dd className="tabular text-2xl font-semibold text-fg">{count(status)}</dd>
              <dt className="text-xs text-fg-muted">{label}</dt>
            </div>
          ))}
        </dl>

        <div className="mt-4">
          <RoadmapTimeline phases={phases} today={today} />
        </div>

        <p className="mt-5">
          <a href="/roadmap-full.html" className="font-medium text-accent hover:underline">
            Open the full interactive roadmap (Gantt, milestones, budget, risks) →
          </a>
        </p>
        <Alert tone="info" className="mt-4">
          Status is computed from the planned dates as of {formatDate(today)} — it says where the
          calendar is, not that work was delivered. “What BI-Rem Lite already does” lists what this
          application implements today; “Still on the roadmap” is what only the full platform will
          deliver.
        </Alert>

        <ol className="mt-8 space-y-4">
          {phases.map((phase) => {
            const status = statuses.get(phase.id) ?? 'PLANNED';
            return (
              <li key={phase.id} id={`phase-${phase.id}`} className="scroll-mt-6">
                <Card>
                  <CardBody>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="text-lg font-semibold text-fg">
                        <span className="text-accent">Phase {phase.id}</span> · {phase.name}
                      </h2>
                      <StatusBadge status={status} label={STATUS_LABELS[status]} />
                    </div>
                    <p className="mt-1 text-sm text-fg-muted">
                      <time dateTime={phase.start}>{formatDate(phase.start)}</time> →{' '}
                      <time dateTime={phase.end}>{formatDate(phase.end)}</time> ·{' '}
                      {plural(phase.weeks, 'week')} · {relativeToToday(phase, status, today)}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-fg-muted">
                      <Badge tone="brand">
                        {TRACK_LABELS[phase.team] ?? `${phase.team} track`}
                      </Badge>
                      {phase.dependsOn.length === 0 ? (
                        <span>No dependency — the programme starts here.</span>
                      ) : (
                        <>
                          <span>Depends on</span>
                          {phase.dependsOn.map((id) => (
                            <a
                              key={id}
                              href={`#phase-${id}`}
                              className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-fg hover:border-border-strong hover:underline"
                            >
                              {id} · {names.get(id) ?? 'Unknown phase'}
                            </a>
                          ))}
                        </>
                      )}
                    </p>
                    <h3 className="mt-4 text-sm font-semibold text-fg">
                      What BI-Rem Lite already does
                    </h3>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-fg-muted">
                      {phase.lite.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    {phase.later ? (
                      <p className="mt-3 text-sm text-fg-muted">
                        <span className="font-semibold text-fg">Still on the roadmap: </span>
                        {phase.later}
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ol>
      </div>
    </PublicShell>
  );
}
