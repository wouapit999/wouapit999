import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { BarChart, BarList, SegmentBar } from '@/components/admin/charts';
import { ExportButtons } from '@/components/admin/export-buttons';
import { Tabs } from '@/components/admin/filter-bar';
import {
  type SearchParams,
  dateParam,
  enumParam,
  flattenParams,
  formatDuration,
  hrefWith,
  percentBps,
  positionInUse,
  usd,
} from '@/components/admin/helpers';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  Input,
  Money,
  PageHeader,
  SimulatedBadge,
  Stat,
  StatGrid,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  buttonClasses,
} from '@/components/ui';
import { formatDateTime, humanize } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { listCountries } from '@/server/countries';
import { type ActionContext, type Permission, STAFF_ROLES, roleHasPermission } from '@/server/rbac';
import {
  REPORT_LABELS,
  type ReportName,
  type ReportRange,
  getComplianceDashboard,
  getExecutiveDashboard,
  getOperationalDashboard,
  getRevenueDashboard,
  getTreasuryDashboard,
  resolveRange,
} from '@/server/reports';

export const metadata: Metadata = { title: 'Reports' };

const DASHBOARDS = ['executive', 'operational', 'revenue', 'compliance', 'treasury'] as const;
type Dashboard = (typeof DASHBOARDS)[number];

/** Datasets offered for download on each dashboard, with the extra permission some need. */
const EXPORTS: Record<Dashboard, ReadonlyArray<{ name: ReportName; needs?: Permission }>> = {
  executive: [{ name: 'transfers' }, { name: 'corridors' }],
  operational: [{ name: 'transfers' }, { name: 'providers' }],
  revenue: [
    { name: 'revenue' },
    { name: 'corridors' },
    { name: 'commissions', needs: 'partners:read' },
  ],
  compliance: [
    { name: 'compliance', needs: 'aml:read' },
    { name: 'audit', needs: 'audit:read' },
  ],
  treasury: [{ name: 'treasury' }, { name: 'revenue' }],
};

const querySchema = z.object({
  view: enumParam(DASHBOARDS),
  from: dateParam,
  to: dateParam,
  days: enumParam(['7', '30', '90', '365']),
});

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** Reporting & BI (phase 10): five dashboards over a date range, each with CSV / Excel / PDF. */
export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const query = querySchema.parse(flattenParams(await searchParams));
  const canTreasury = roleHasPermission(user.role, 'treasury:read');
  const requested = query.view ?? 'executive';
  const view: Dashboard = requested === 'treasury' && !canTreasury ? 'executive' : requested;
  const custom = query.from !== undefined && query.to !== undefined;
  const range = resolveRange(
    custom ? { from: query.from, to: query.to } : { days: query.days ?? '30' },
  );
  const rangeParams = custom ? { from: query.from, to: query.to } : { days: query.days ?? '30' };
  const canExport = roleHasPermission(user.role, 'reports:export');
  const exports = EXPORTS[view].filter(
    (entry) => !entry.needs || roleHasPermission(user.role, entry.needs),
  );

  return (
    <>
      <PageHeader
        title="Reports"
        description="Executive, operational, revenue, compliance and treasury dashboards, computed live from the database for the period you choose."
      />
      <Tabs
        label="Dashboards"
        active={view}
        tabs={DASHBOARDS.filter((key) => key !== 'treasury' || canTreasury).map((key) => ({
          key,
          label: humanize(key),
          href: hrefWith('/admin/reports', { view: key, ...rangeParams }),
        }))}
      />

      <Card className="mb-5">
        <form
          method="get"
          action="/admin/reports"
          aria-label="Reporting period"
          className="flex flex-wrap items-end gap-3 px-5 py-4 sm:px-6"
        >
          <input type="hidden" name="view" value={view} />
          <Input
            name="from"
            type="date"
            label="From"
            required
            defaultValue={isoDay(range.from)}
            max={isoDay(new Date())}
          />
          <Input
            name="to"
            type="date"
            label="To"
            required
            defaultValue={isoDay(range.to)}
            max={isoDay(new Date())}
          />
          <button type="submit" className={buttonClasses('primary', 'sm', 'mb-0.5')}>
            Apply range
          </button>
          <span className="mb-0.5 flex flex-wrap gap-1.5" role="group" aria-label="Quick ranges">
            {(['7', '30', '90', '365'] as const).map((days) => (
              <Link
                key={days}
                href={hrefWith('/admin/reports', { view, days })}
                aria-current={!custom && (query.days ?? '30') === days ? 'true' : undefined}
                className={buttonClasses(
                  'secondary',
                  'sm',
                  'aria-[current]:border-accent aria-[current]:text-accent',
                )}
              >
                {days === '365' ? '1 year' : `${days} days`}
              </Link>
            ))}
          </span>
        </form>
        <p className="border-t border-border px-5 py-2 text-xs text-fg-muted sm:px-6" role="status">
          Period: {formatDateTime(range.from)} → {formatDateTime(range.to)}
        </p>
      </Card>

      {view === 'executive' ? <Executive ctx={ctx} range={range} /> : null}
      {view === 'operational' ? <Operational ctx={ctx} range={range} /> : null}
      {view === 'revenue' ? <Revenue ctx={ctx} range={range} /> : null}
      {view === 'compliance' ? <Compliance ctx={ctx} range={range} /> : null}
      {view === 'treasury' ? <Treasury ctx={ctx} range={range} /> : null}

      <Card className="mt-5" id="exports">
        <CardHeader
          title="Export this period"
          description="Every export is recorded in the audit log with the format, the period and the number of rows."
        />
        <CardBody className="divide-y divide-border py-2">
          {!canExport ? (
            <p className="py-2 text-sm text-fg-muted">
              Your role can view the dashboards but cannot export data.
            </p>
          ) : (
            exports.map((entry) => (
              <ExportButtons
                key={entry.name}
                name={entry.name}
                label={REPORT_LABELS[entry.name]}
                from={custom ? query.from : undefined}
                to={custom ? query.to : undefined}
                days={custom ? undefined : Number(query.days ?? '30')}
              />
            ))
          )}
        </CardBody>
      </Card>
    </>
  );
}

interface SectionProps {
  ctx: ActionContext;
  range: ReportRange;
}

async function Executive({ ctx, range }: SectionProps) {
  const data = await getExecutiveDashboard(ctx, range);
  const { totals } = data;
  return (
    <>
      <StatGrid>
        <Stat label="Volume" value={totals.transfers} hint={`${totals.completed} completed`} />
        <Stat label="Value" value={usd(totals.valueUsd)} />
        <Stat label="Revenue" value={usd(totals.revenueUsd)} />
        <Stat
          label="Failed rate"
          value={percentBps(totals.failureRateBps)}
          hint={`${totals.failed} failed or rejected`}
        />
        <Stat
          label="DAU"
          value={data.activeUsers.dau}
          hint="Active in the last 24 h of the period"
        />
        <Stat
          label="MAU"
          value={data.activeUsers.mau}
          hint="Active in the last 30 days of the period"
        />
        <Stat label="Customers" value={data.customers.total} hint={`${data.customers.new} new`} />
        <Stat label="On hold" value={totals.onHold} hint={`${totals.processing} in flight`} />
      </StatGrid>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Transfers per day" />
          <CardBody>
            <BarChart
              title="Transfers per day"
              seriesLabel="Transfers"
              summary={`${totals.transfers} transfers over ${data.daily.length} days.`}
              points={data.daily.map((point) => ({
                label: point.date,
                value: point.count,
                display: String(point.count),
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Country activity" description="Completed value sent" />
          <CardBody>
            <BarList
              items={data.countries.map((row) => ({
                key: row.country,
                label: row.country,
                value: Number(row.sentUsd),
                display: usd(row.sentUsd),
                hint: `${row.sent} transfer${row.sent === 1 ? '' : 's'}`,
              }))}
            />
          </CardBody>
        </Card>
      </div>
      <CorridorTable title="Top corridors" corridors={data.corridors} />
    </>
  );
}

function CorridorTable({
  title,
  corridors,
}: {
  title: string;
  corridors: Awaited<ReturnType<typeof getExecutiveDashboard>>['corridors'];
}) {
  return (
    <Card className="mt-5">
      <CardHeader title={title} />
      {corridors.length === 0 ? (
        <CardBody>
          <p className="text-sm text-fg-muted">No completed transfer in this period.</p>
        </CardBody>
      ) : (
        <Table caption={title}>
          <THead>
            <Tr>
              <Th>Corridor</Th>
              <Th>Currencies</Th>
              <Th align="right">Transfers</Th>
              <Th align="right">Value</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">FX margin</Th>
            </Tr>
          </THead>
          <TBody>
            {corridors.map((corridor) => (
              <Tr
                key={`${corridor.sourceCountry}-${corridor.targetCountry}-${corridor.sourceCurrency}-${corridor.targetCurrency}`}
              >
                <Td className="whitespace-nowrap">
                  {corridor.sourceCountry} → {corridor.targetCountry}
                </Td>
                <Td>
                  {corridor.sourceCurrency} → {corridor.targetCurrency}
                </Td>
                <Td align="right">{corridor.count}</Td>
                <Td align="right">{usd(corridor.valueUsd)}</Td>
                <Td align="right">{usd(corridor.revenueUsd)}</Td>
                <Td align="right">{usd(corridor.fxMarginUsd)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

const STATUS_TONE = {
  COMPLETED: 'success',
  PROCESSING: 'info',
  ON_HOLD: 'warning',
  FAILED: 'danger',
  REJECTED: 'danger',
  REVERSED: 'neutral',
} as const;

async function Operational({ ctx, range }: SectionProps) {
  const data = await getOperationalDashboard(ctx, range);
  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Status mix"
            description="Transfers and top-ups created in the period"
          />
          <CardBody>
            <SegmentBar
              title="Transfers by status"
              segments={data.byStatus.map((row) => ({
                key: row.status,
                label: row.status === 'ON_HOLD' ? 'On hold' : humanize(row.status),
                value: row.count,
                tone: STATUS_TONE[row.status],
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Type mix" />
          <CardBody>
            <BarList
              items={data.byType.map((row) => ({
                key: row.type,
                label: humanize(row.type),
                value: row.count,
                display: `${row.count} · ${usd(row.valueUsd)}`,
              }))}
            />
          </CardBody>
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader title="Provider performance" />
        <Table caption="Provider performance">
          <THead>
            <Tr>
              <Th>Provider</Th>
              <Th>Health</Th>
              <Th align="right">Transfers</Th>
              <Th align="right">Completed</Th>
              <Th align="right">Failed</Th>
              <Th align="right">Pending</Th>
              <Th align="right">Success rate</Th>
              <Th align="right">Avg. completion</Th>
            </Tr>
          </THead>
          <TBody>
            {data.providers
              .filter((provider) => provider.total > 0)
              .map((provider) => (
                <Tr key={provider.providerId}>
                  <Td>
                    {provider.name} {provider.simulated ? <SimulatedBadge /> : null}
                  </Td>
                  <Td>
                    <StatusBadge status={provider.healthStatus} />
                  </Td>
                  <Td align="right">{provider.total}</Td>
                  <Td align="right">{provider.completed}</Td>
                  <Td align="right">{provider.failed}</Td>
                  <Td align="right">{provider.pending}</Td>
                  <Td align="right">{percentBps(provider.successRateBps)}</Td>
                  <Td align="right">{formatDuration(provider.avgCompletionSeconds)}</Td>
                </Tr>
              ))}
          </TBody>
        </Table>
      </Card>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Stuck with a provider"
            description="Processing for more than 15 minutes"
          />
          <CardBody>
            {data.stuck.length === 0 ? (
              <p className="text-sm text-fg-muted">Nothing is stuck.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.stuck.map((transfer) => (
                  <li key={transfer.id} className="flex items-start justify-between gap-3">
                    <span>
                      <Link
                        href={`/admin/transfers/${transfer.id}`}
                        className="tabular font-medium underline"
                      >
                        {transfer.reference}
                      </Link>
                      <span className="block text-xs text-fg-muted">
                        {transfer.recipientName} · since {formatDateTime(transfer.createdAt)}
                      </span>
                    </span>
                    <Money amount={transfer.sendAmount} currency={transfer.sourceCurrency} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent failures" />
          <CardBody>
            {data.recentFailures.length === 0 ? (
              <p className="text-sm text-fg-muted">No failure in this period.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.recentFailures.map((transfer) => (
                  <li key={transfer.id}>
                    <Link
                      href={`/admin/transfers/${transfer.id}`}
                      className="tabular font-medium underline"
                    >
                      {transfer.reference}
                    </Link>{' '}
                    <Badge tone="danger">
                      {transfer.status === 'REJECTED' ? 'Rejected' : 'Failed'}
                    </Badge>
                    <span className="block text-xs text-fg-muted">
                      {transfer.failureReason ?? transfer.failureCode ?? 'No reason recorded'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      {data.webhookEvents.length > 0 ? (
        <p className="mt-3 text-xs text-fg-muted">
          Provider webhooks in the period:{' '}
          {data.webhookEvents
            .map((row) => `${row.count} ${humanize(row.status).toLowerCase()}`)
            .join(', ')}
          .
        </p>
      ) : null}
    </>
  );
}

async function Revenue({ ctx, range }: SectionProps) {
  const data = await getRevenueDashboard(ctx, range);
  return (
    <>
      <StatGrid className="lg:grid-cols-3">
        <Stat label="Revenue" value={usd(data.totals.revenueUsd)} hint="Fees + FX margin" />
        <Stat label="Fees" value={usd(data.totals.feeUsd)} />
        <Stat label="FX margin" value={usd(data.totals.fxMarginUsd)} />
      </StatGrid>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue per day" description="USD" />
          <CardBody>
            <BarChart
              title="Revenue per day"
              seriesLabel="Fees"
              series2Label="FX margin"
              summary={`${usd(data.totals.revenueUsd)} in total over ${data.daily.length} days with activity.`}
              points={data.daily.map((day) => ({
                label: day.date,
                value: Number(day.feeUsd),
                display: usd(day.feeUsd),
                value2: Number(day.fxMarginUsd),
                display2: usd(day.fxMarginUsd),
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Revenue by transfer type" />
          <CardBody>
            <BarList
              tone="gold"
              items={data.byType.map((row) => ({
                key: row.type,
                label: humanize(row.type),
                value: Number(row.revenueUsd),
                display: usd(row.revenueUsd),
                hint: `${row.count} transfer${row.count === 1 ? '' : 's'}`,
              }))}
            />
          </CardBody>
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader
          title="Revenue by source currency"
          description="Exact ledger amounts, before conversion"
        />
        <Table caption="Revenue by source currency">
          <THead>
            <Tr>
              <Th>Currency</Th>
              <Th align="right">Transfers</Th>
              <Th align="right">Fees</Th>
              <Th align="right">FX margin</Th>
              <Th align="right">Partner commissions</Th>
            </Tr>
          </THead>
          <TBody>
            {data.byCurrency.map((row) => (
              <Tr key={row.currency}>
                <Td className="font-medium">{row.currency}</Td>
                <Td align="right">{row.count}</Td>
                <Td align="right">
                  <Money amount={row.fees} currency={row.currency} />
                </Td>
                <Td align="right">
                  <Money amount={row.fxMargin} currency={row.currency} />
                </Td>
                <Td align="right">
                  <Money amount={row.commissions} currency={row.currency} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
      <CorridorTable title="Revenue by corridor" corridors={data.corridors} />
    </>
  );
}

async function Compliance({ ctx, range }: SectionProps) {
  const data = await getComplianceDashboard(ctx, range);
  const sum = (rows: ReadonlyArray<{ count: number }>) =>
    rows.reduce((total, row) => total + row.count, 0);
  return (
    <>
      <StatGrid>
        <Stat label="Alerts raised" value={sum(data.alerts.byStatus)} hint="In the period" />
        <Stat
          label="Transfers on hold"
          value={data.held.count}
          hint={`${usd(data.held.valueUsd)} reserved now`}
        />
        <Stat label="Cases" value={sum(data.cases)} hint="All time" />
        <Stat label="KYC queue" value={data.kyc.queue} hint="Waiting for review now" />
      </StatGrid>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Alerts by rule" />
          <CardBody>
            <BarList
              tone="danger"
              emptyLabel="No alert in this period."
              items={data.alerts.byRule.map((row) => ({
                key: `${row.ruleCode}-${row.severity}`,
                label: `${row.ruleCode} · ${humanize(row.severity)}`,
                value: row.count,
                display: String(row.count),
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Cases and SARs" />
          <CardBody className="space-y-5">
            <BarList
              emptyLabel="No case."
              items={data.cases.map((row) => ({
                key: row.status,
                label: row.status === 'REJECTED' ? 'Rejected' : humanize(row.status),
                value: row.count,
                display: String(row.count),
              }))}
            />
            <p className="text-sm text-fg-muted">
              SARs:{' '}
              {data.sars.length === 0
                ? 'none'
                : data.sars
                    .map((row) => `${row.count} ${humanize(row.status).toLowerCase()}`)
                    .join(', ')}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Customers" />
          <CardBody className="space-y-5">
            <SegmentBar
              title="Risk level"
              segments={[
                { key: 'LOW', label: 'Low', tone: 'success' as const },
                { key: 'MEDIUM', label: 'Medium', tone: 'warning' as const },
                { key: 'HIGH', label: 'High', tone: 'danger' as const },
              ].map((segment) => ({
                ...segment,
                value: data.risk.find((row) => row.level === segment.key)?.count ?? 0,
              }))}
            />
            <SegmentBar
              title="KYC status"
              segments={[
                { key: 'VERIFIED', label: 'Verified', tone: 'success' as const },
                { key: 'PENDING', label: 'Pending', tone: 'info' as const },
                { key: 'NONE', label: 'Not started', tone: 'neutral' as const },
                { key: 'REJECTED', label: 'Rejected', tone: 'danger' as const },
              ].map((segment) => ({
                ...segment,
                value: data.kyc.byStatus.find((row) => row.status === segment.key)?.count ?? 0,
              }))}
            />
            <p className="text-sm text-fg-muted">
              {data.flaggedCustomers} customer{data.flaggedCustomers === 1 ? '' : 's'} match the
              demo screening list.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

async function Treasury({ ctx, range }: SectionProps) {
  const [data, liveCountries] = await Promise.all([
    getTreasuryDashboard(ctx, range),
    listCountries({ enabled: true }),
  ]);
  const liveCurrencies = new Set(liveCountries.map((country) => country.currency));
  const positions = data.positions.filter((position) => positionInUse(position, liveCurrencies));
  const alerts = data.alerts.filter((position) => positionInUse(position, liveCurrencies));
  return (
    <>
      {alerts.length > 0 ? (
        <Alert tone="warning" title="Low liquidity" className="mb-5">
          {alerts
            .map((alert) => `${alert.currency} (${humanize(alert.liquidity).toLowerCase()})`)
            .join(', ')}{' '}
          —{' '}
          <Link href="/admin/treasury" className="font-medium underline">
            open treasury
          </Link>
        </Alert>
      ) : null}
      <Card>
        <CardHeader
          title="Positions"
          description="Current balances per currency in use (live markets or funded)"
        />
        <Table caption="Treasury positions">
          <THead>
            <Tr>
              <Th>Currency</Th>
              <Th>Liquidity</Th>
              <Th align="right">Float</Th>
              <Th align="right">Wallet liabilities</Th>
              <Th align="right">Suspense</Th>
              <Th align="right">Fee revenue</Th>
              <Th align="right">FX revenue</Th>
            </Tr>
          </THead>
          <TBody>
            {positions.map((position) => (
              <Tr key={position.currency}>
                <Td className="font-medium">{position.currency}</Td>
                <Td>
                  <StatusBadge
                    status={position.liquidity}
                    label={position.liquidity === 'OK' ? 'OK' : humanize(position.liquidity)}
                  />
                </Td>
                <Td align="right">
                  <Money amount={position.float} currency={position.currency} withCode={false} />
                </Td>
                <Td align="right">
                  <Money
                    amount={position.walletLiabilities}
                    currency={position.currency}
                    withCode={false}
                  />
                </Td>
                <Td align="right">
                  <Money amount={position.suspense} currency={position.currency} withCode={false} />
                </Td>
                <Td align="right">
                  <Money
                    amount={position.feeRevenue}
                    currency={position.currency}
                    withCode={false}
                  />
                </Td>
                <Td align="right">
                  <Money
                    amount={position.fxRevenue}
                    currency={position.currency}
                    withCode={false}
                  />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
      <Card className="mt-5">
        <CardHeader title="FX profitability" description="Cross-currency transfers in the period" />
        <CardBody>
          <BarList
            tone="gold"
            emptyLabel="No cross-currency transfer in this period."
            items={data.fxPairs.map((pair) => ({
              key: `${pair.sourceCurrency}-${pair.targetCurrency}`,
              label: `${pair.sourceCurrency}/${pair.targetCurrency}`,
              value: Number(pair.fxMarginUsd),
              display: usd(pair.fxMarginUsd),
              hint: `${pair.count} transfer${pair.count === 1 ? '' : 's'}`,
            }))}
          />
        </CardBody>
      </Card>
      <p className="mt-3 text-xs text-fg-muted">
        Ledger integrity:{' '}
        {data.integrity.every((row) => row.balanced)
          ? `balanced in ${data.integrity.length} currencies.`
          : 'out of balance — open Treasury → Reconciliation.'}
      </p>
    </>
  );
}
