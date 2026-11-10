import type { Metadata } from 'next';

import { PublicShell } from '@/components/shell/public-shell';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  SimulatedBadge,
  Stat,
  StatusBadge,
} from '@/components/ui';
import schedule from '@/data/roadmap-schedule.json';
import { formatDateTime, humanize } from '@/lib/format';
import { getPublicProviderStatus } from '@/server/connectors/providers';
import { db } from '@/server/db';
import { getSetting } from '@/server/settings';

import { getBuildInfo, getRepositoryLinks } from './build-info';

export const metadata: Metadata = {
  title: 'System status',
  description:
    'Live availability of BI-Rem Lite: application, database and mobile-money providers.',
};
export const dynamic = 'force-dynamic';

type ProviderStatus = Awaited<ReturnType<typeof getPublicProviderStatus>>[number];

async function loadStatus() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - started;
    const [providers, maintenance] = await Promise.all([
      getPublicProviderStatus(),
      getSetting('platform.maintenance'),
    ]);
    return { database: 'up' as const, latencyMs, providers, maintenance };
  } catch (error) {
    // The cause stays in the server log; the public page only says the database is down.
    console.error('[status] database check failed', error instanceof Error ? error.message : error);
    return {
      database: 'down' as const,
      latencyMs: null,
      providers: [] as ProviderStatus[],
      maintenance: { enabled: false, message: '' },
    };
  }
}

/** Counts of the providers customers can use right now, by last recorded health. */
function summarise(providers: readonly ProviderStatus[]) {
  const active = providers.filter((provider) => provider.status === 'ACTIVE');
  const by = (health: string): number =>
    active.filter((provider) => provider.healthStatus === health).length;
  return {
    total: providers.length,
    active: active.length,
    inactive: providers.length - active.length,
    healthy: by('HEALTHY'),
    degraded: by('DEGRADED'),
    down: by('DOWN'),
    untested: by('UNKNOWN'),
    simulated: providers.filter((provider) => provider.simulated).length,
  };
}

/** "All 15 providers on this deployment are sandbox simulators", with the grammar of each case. */
function simulatedSentence(simulated: number, total: number): string {
  if (simulated === total) {
    return total === 1
      ? 'The only provider on this deployment is a sandbox simulator'
      : `All ${total} providers on this deployment are sandbox simulators`;
  }
  return simulated === 1
    ? `1 of the ${total} providers on this deployment is a sandbox simulator`
    : `${simulated} of the ${total} providers on this deployment are sandbox simulators`;
}

/** Public status page (phase 12): platform, database, providers, build and availability target. */
export default async function StatusPage() {
  const status = await loadStatus();
  const build = getBuildInfo();
  const links = getRepositoryLinks();
  const summary = summarise(status.providers);
  const target = schedule.targetScale;
  const databaseUp = status.database === 'up';
  const providerTrouble = summary.down > 0 || summary.degraded > 0;
  const headline = !databaseUp
    ? { tone: 'danger' as const, title: 'The platform is currently unavailable' }
    : status.maintenance.enabled
      ? { tone: 'warning' as const, title: 'Scheduled maintenance' }
      : providerTrouble
        ? { tone: 'warning' as const, title: 'Operational — some providers are degraded' }
        : { tone: 'success' as const, title: 'All systems operational' };

  return (
    <PublicShell>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">System status</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Checked live at <time>{formatDateTime(new Date())}</time>. Reload to refresh.
        </p>

        <Alert tone={headline.tone} title={headline.title} className="mt-6">
          {status.maintenance.enabled && status.maintenance.message
            ? status.maintenance.message
            : !databaseUp
              ? 'The database did not answer. Transfers and sign-in are unavailable until it is back.'
              : null}
        </Alert>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <Stat
            label="Database"
            value={databaseUp ? 'Operational' : 'Down'}
            hint={status.latencyMs === null ? 'No answer' : `Answered in ${status.latencyMs} ms`}
            tone={databaseUp ? 'success' : 'danger'}
          />
          <Stat
            label="Providers available"
            value={databaseUp ? `${summary.active - summary.down} / ${summary.active}` : '—'}
            hint={
              databaseUp
                ? `${summary.healthy} healthy · ${summary.degraded} degraded · ${summary.down} down · ${summary.untested} not tested yet`
                : 'Unknown while the database is down'
            }
            tone={summary.down > 0 ? 'danger' : summary.degraded > 0 ? 'warning' : 'default'}
          />
          <Stat
            label="Availability target"
            value={target.availability}
            hint={`Programme objective · RPO ${target.rpoMinutes} min · RTO ${target.rtoMinutes} min`}
          />
        </div>

        <Card className="mt-6">
          <CardHeader title="Core services" />
          <ul className="divide-y divide-border">
            {[
              {
                name: 'Web application and API',
                detail: 'Answered this request',
                status: 'HEALTHY',
                label: 'Operational',
              },
              {
                name: 'Database (PostgreSQL)',
                detail:
                  status.latencyMs === null ? 'No answer' : `Answered in ${status.latencyMs} ms`,
                status: databaseUp ? 'HEALTHY' : 'DOWN',
                label: databaseUp ? 'Operational' : 'Down',
              },
              {
                name: 'Maintenance mode',
                detail: status.maintenance.enabled
                  ? 'Transfers may be paused by the operator'
                  : 'No maintenance announced',
                status: status.maintenance.enabled ? 'MAINTENANCE' : 'OK',
                label: status.maintenance.enabled ? 'On' : 'Off',
              },
            ].map((service) => (
              <li
                key={service.name}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-3 sm:px-6"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{service.name}</p>
                  <p className="text-xs text-fg-subtle">{service.detail}</p>
                </div>
                <StatusBadge status={service.status} label={service.label} />
              </li>
            ))}
          </ul>
        </Card>

        <Card className="mt-6">
          <CardHeader
            title="Mobile-money providers"
            description={
              summary.total === 0
                ? 'No provider information is available right now.'
                : `${summary.active} active, ${summary.inactive} inactive. Health is recorded when an administrator runs a connectivity test.`
            }
            action={
              summary.total > 0 && summary.simulated === summary.total ? (
                <SimulatedBadge />
              ) : undefined
            }
          />
          {summary.simulated > 0 ? (
            <p className="border-b border-border px-5 py-3 text-sm text-fg-muted sm:px-6">
              {simulatedSentence(summary.simulated, summary.total)}: “healthy” means the simulator
              answered, not that a live operator is reachable.
            </p>
          ) : null}
          {status.providers.length > 0 ? (
            <ul className="divide-y divide-border">
              {status.providers.map((provider) => (
                <li
                  key={provider.code}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-3 sm:px-6"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                      {provider.name}
                      <Badge>{provider.countryCode}</Badge>
                      {provider.simulated ? <SimulatedBadge /> : null}
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {provider.lastHealthCheckAt
                        ? `Last check ${formatDateTime(provider.lastHealthCheckAt)}`
                        : 'No connectivity test recorded yet'}
                    </p>
                  </div>
                  {provider.status === 'ACTIVE' ? (
                    <StatusBadge
                      status={provider.healthStatus}
                      label={
                        provider.healthStatus === 'UNKNOWN'
                          ? 'Available · not tested yet'
                          : undefined
                      }
                    />
                  ) : (
                    <StatusBadge status={provider.status} />
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card>
            <CardHeader title="Build" description="What is running here" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Version', value: <span className="font-mono">{build.version}</span> },
                  {
                    label: 'Commit',
                    value: build.commit ? (
                      <span className="font-mono">{build.commit}</span>
                    ) : (
                      'Not a Git deployment'
                    ),
                  },
                  ...(build.branch ? [{ label: 'Branch', value: build.branch }] : []),
                  { label: 'Environment', value: humanize(build.environment) },
                  ...(build.region ? [{ label: 'Region', value: build.region }] : []),
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Availability" description="Target and what this page measures" />
            <CardBody className="space-y-2 text-sm text-fg-muted">
              <p>
                <strong className="text-fg">{target.availability}</strong> is the availability
                objective of the production BI-Rem platform (recovery point {target.rpoMinutes}{' '}
                minutes, recovery time {target.rtoMinutes} minutes), reached at go-live in phase 12.
              </p>
              <p>
                BI-Rem Lite runs on Vercel and Neon without an SLA and keeps no uptime history: the
                checks above are made at the moment you load the page.
              </p>
            </CardBody>
          </Card>
        </div>

        <Card className="mt-6">
          <CardHeader
            title="Go-live"
            description="Before a deployment of BI-Rem Lite carries anything real"
          />
          <CardBody className="space-y-3 text-sm text-fg-muted">
            <p>
              BI-Rem Lite is a demonstration: operators and KYC vendors are simulated and there is
              no licence, operator contract or regulator reporting behind it. The guides below are
              kept in the repository, next to the code they describe.
            </p>
            <ul className="space-y-2">
              {[
                {
                  href: links.deployGuide,
                  label: 'Deploy guide',
                  detail: 'GitHub, Vercel and Neon, step by step, with troubleshooting',
                },
                {
                  href: links.goLiveChecklist,
                  label: 'Go-live checklist',
                  detail: 'what the production platform must pass before launch (phase 12)',
                },
                {
                  href: links.liteDocs,
                  label: 'Lite and the roadmap',
                  detail: 'what is verified for each of the 13 phases, and the limits',
                },
                {
                  href: links.ciWorkflow,
                  label: 'CI pipeline',
                  detail: 'deploy rehearsal, lint, typecheck, tests and end-to-end runs',
                },
              ].map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    rel="noreferrer"
                    className="font-medium text-accent underline underline-offset-2 hover:no-underline"
                  >
                    {link.label}
                    <span className="sr-only"> (opens the repository on GitHub)</span>
                  </a>{' '}
                  — {link.detail}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <p className="mt-6 text-sm text-fg-muted">
          Machine-readable health:{' '}
          <a href="/api/health" className="font-mono text-accent hover:underline">
            /api/health
          </a>
        </p>
      </div>
    </PublicShell>
  );
}
