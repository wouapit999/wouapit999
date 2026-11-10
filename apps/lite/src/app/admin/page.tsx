import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { BarChart, BarList, SegmentBar } from '@/components/admin/charts';
import { Tabs } from '@/components/admin/filter-bar';
import {
  type SearchParams,
  enumParam,
  flattenParams,
  formatDuration,
  percentBps,
  usd,
} from '@/components/admin/helpers';
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
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
} from '@/components/ui';
import { formatCompact } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { listCountries } from '@/server/countries';
import { ROLE_LABELS, STAFF_ROLES, roleHasPermission } from '@/server/rbac';
import {
  getComplianceDashboard,
  getExecutiveDashboard,
  getOperationalDashboard,
  getRevenueDashboard,
  resolveRange,
} from '@/server/reports';
export const metadata: Metadata = { title: 'Executive dashboard' };

const PERIODS = ['7', '30', '90'] as const;
const querySchema = z.object({ days: enumParam(PERIODS) });

/** Executive dashboard: the programme's KPIs computed live from Postgres. */
export default async function AdminDashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const { days = '30' } = querySchema.parse(flattenParams(await searchParams));
  const range = resolveRange({ days });

  const [executive, operational, revenue, compliance, countries] = await Promise.all([
    getExecutiveDashboard(ctx, range),
    getOperationalDashboard(ctx, range),
    getRevenueDashboard(ctx, range),
    getComplianceDashboard(ctx, range),
    listCountries(),
  ]);
  const { totals } = executive;
  const countryName = new Map(countries.map((country) => [country.code, country.name]));
  const peak = executive.daily.reduce(
    (best, point) => (point.valueUsd > best.valueUsd ? point : best),
    executive.daily[0] ?? { date: '', valueUsd: 0n },
  );
  const activeProviders = operational.providers.filter((provider) => provider.total > 0);
  const canSeeCompliance = roleHasPermission(user.role, 'aml:read');
  const canSeeKyc = roleHasPermission(user.role, 'kyc:read');

  return (
    <>
      <PageHeader
        title="Executive dashboard"
        description={`Signed in as ${ROLE_LABELS[user.role].toLowerCase()}. Figures are computed live; USD values use the mid rate captured on each transfer.`}
      />

      <Tabs
        label="Period"
        active={days}
        tabs={PERIODS.map((period) => ({
          key: period,
          label: `Last ${period} days`,
          href: period === '30' ? '/admin' : `/admin?days=${period}`,
        }))}
      />

      {compliance.held.count > 0 || compliance.kyc.queue > 0 ? (
        <Alert tone="warning" title="Work waiting" className="mb-5">
          <ul className="list-disc space-y-0.5 pl-5">
            {compliance.held.count > 0 ? (
              <li>
                {compliance.held.count} transfer{compliance.held.count === 1 ? '' : 's'} on hold (
                {usd(compliance.held.valueUsd)}) —{' '}
                {canSeeCompliance ? (
                  <Link href="/admin/compliance?tab=cases" className="font-medium underline">
                    open the compliance cases
                  </Link>
                ) : (
                  'waiting for compliance'
                )}
              </li>
            ) : null}
            {compliance.kyc.queue > 0 ? (
              <li>
                {compliance.kyc.queue} KYC case{compliance.kyc.queue === 1 ? '' : 's'} to review
                {canSeeKyc ? (
                  <>
                    {' — '}
                    <Link href="/admin/kyc" className="font-medium underline">
                      open the verification queue
                    </Link>
                  </>
                ) : null}
              </li>
            ) : null}
          </ul>
        </Alert>
      ) : null}

      <StatGrid>
        <Stat
          label="Volume"
          value={formatCompact(totals.transfers)}
          hint={`${totals.completed} completed · ${totals.processing} in flight`}
        />
        <Stat label="Value" value={usd(totals.valueUsd)} hint="Completed transfers" />
        <Stat
          label="Revenue"
          value={usd(revenue.totals.revenueUsd)}
          hint={`Fees ${usd(revenue.totals.feeUsd)}`}
        />
        <Stat
          label="FX profit"
          value={usd(revenue.totals.fxMarginUsd)}
          hint="Margin on cross-currency transfers"
        />
        <Stat
          label="Failed rate"
          value={percentBps(totals.failureRateBps)}
          hint={`${totals.failed} failed or rejected`}
          tone={
            totals.failureRateBps >= 1000
              ? 'danger'
              : totals.failureRateBps >= 500
                ? 'warning'
                : 'default'
          }
        />
        <Stat label="Active users (DAU)" value={executive.activeUsers.dau} hint="Last 24 hours" />
        <Stat label="Active users (MAU)" value={executive.activeUsers.mau} hint="Last 30 days" />
        <Stat
          label="Customers"
          value={formatCompact(executive.customers.total)}
          hint={`${executive.customers.new} new in this period`}
        />
      </StatGrid>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Value per day" description="Completed transfers, USD" />
          <CardBody>
            <BarChart
              title="Completed value per day"
              seriesLabel="Value"
              summary={
                peak.date
                  ? `${usd(totals.valueUsd)} over ${executive.daily.length} days; the busiest day was ${peak.date} with ${usd(peak.valueUsd)}.`
                  : 'No completed transfers.'
              }
              points={executive.daily.map((point) => ({
                label: point.date,
                value: Number(point.valueUsd),
                display: usd(point.valueUsd),
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Revenue per day" description="Fees and FX margin, USD" />
          <CardBody>
            <BarChart
              title="Revenue per day"
              seriesLabel="Fees"
              series2Label="FX margin"
              summary={`${usd(revenue.totals.revenueUsd)} in total: ${usd(revenue.totals.feeUsd)} fees and ${usd(revenue.totals.fxMarginUsd)} FX margin.`}
              points={executive.daily.map((point) => {
                const row = revenue.daily.find((entry) => entry.date === point.date);
                return {
                  label: point.date,
                  value: Number(row?.feeUsd ?? 0n),
                  display: usd(row?.feeUsd ?? 0n),
                  value2: Number(row?.fxMarginUsd ?? 0n),
                  display2: usd(row?.fxMarginUsd ?? 0n),
                };
              })}
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Outcome mix" description="All transfers in the period" />
          <CardBody>
            <SegmentBar
              title="Transfers by outcome"
              segments={[
                { key: 'completed', label: 'Completed', value: totals.completed, tone: 'success' },
                { key: 'processing', label: 'In flight', value: totals.processing, tone: 'info' },
                { key: 'hold', label: 'On hold', value: totals.onHold, tone: 'warning' },
                { key: 'failed', label: 'Failed / rejected', value: totals.failed, tone: 'danger' },
                { key: 'reversed', label: 'Reversed', value: totals.reversed, tone: 'neutral' },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Country activity" description="Completed value sent, by country" />
          <CardBody>
            <BarList
              items={executive.countries.map((row) => ({
                key: row.country,
                label: `${countryName.get(row.country) ?? row.country} (${row.country})`,
                value: Number(row.sentUsd),
                display: usd(row.sentUsd),
                hint: `${row.sent} transfer${row.sent === 1 ? '' : 's'}`,
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="FX profit by corridor" description="Margin earned, USD" />
          <CardBody>
            <BarList
              tone="gold"
              emptyLabel="No cross-currency transfers in this period."
              items={revenue.corridors
                .filter((corridor) => corridor.fxMarginUsd > 0n)
                .slice(0, 6)
                .map((corridor) => ({
                  key: `${corridor.sourceCountry}-${corridor.targetCountry}-${corridor.targetCurrency}`,
                  label: `${corridor.sourceCountry} → ${corridor.targetCountry} (${corridor.sourceCurrency}/${corridor.targetCurrency})`,
                  value: Number(corridor.fxMarginUsd),
                  display: usd(corridor.fxMarginUsd),
                  hint: `${corridor.count} transfers`,
                }))}
            />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Provider performance"
          description="Mobile-money payouts and cash-ins routed through each provider"
          action={
            <Link href="/admin/providers" className="text-sm font-medium text-accent underline">
              Provider directory
            </Link>
          }
        />
        {activeProviders.length === 0 ? (
          <CardBody>
            <p className="text-sm text-fg-muted">No provider traffic in this period.</p>
          </CardBody>
        ) : (
          <Table caption="Provider performance">
            <THead>
              <Tr>
                <Th>Provider</Th>
                <Th>Health</Th>
                <Th align="right">Transfers</Th>
                <Th align="right">Success rate</Th>
                <Th align="right">Failed</Th>
                <Th align="right">Pending</Th>
                <Th align="right">Avg. completion</Th>
                <Th align="right">Value</Th>
              </Tr>
            </THead>
            <TBody>
              {activeProviders.map((provider) => (
                <Tr key={provider.providerId}>
                  <Td>
                    <Link
                      href={`/admin/providers/${provider.providerId}`}
                      className="font-medium text-fg underline-offset-2 hover:underline"
                    >
                      {provider.name}
                    </Link>{' '}
                    {provider.simulated ? <SimulatedBadge /> : null}
                    <p className="text-xs text-fg-subtle">{provider.code}</p>
                  </Td>
                  <Td>
                    <StatusBadge status={provider.healthStatus} />
                  </Td>
                  <Td align="right">{provider.total}</Td>
                  <Td align="right">{percentBps(provider.successRateBps)}</Td>
                  <Td align="right">{provider.failed}</Td>
                  <Td align="right">{provider.pending}</Td>
                  <Td align="right">{formatDuration(provider.avgCompletionSeconds)}</Td>
                  <Td align="right">{usd(provider.valueUsd)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card className="mt-5">
        <CardHeader title="Top corridors" description="Completed transfers by route" />
        {executive.corridors.length === 0 ? (
          <CardBody>
            <p className="text-sm text-fg-muted">No completed transfers in this period.</p>
          </CardBody>
        ) : (
          <Table caption="Top corridors">
            <THead>
              <Tr>
                <Th>Corridor</Th>
                <Th>Currencies</Th>
                <Th align="right">Transfers</Th>
                <Th align="right">Value</Th>
                <Th align="right">Revenue</Th>
                <Th align="right">of which FX</Th>
              </Tr>
            </THead>
            <TBody>
              {executive.corridors.map((corridor) => (
                <Tr
                  key={`${corridor.sourceCountry}-${corridor.targetCountry}-${corridor.sourceCurrency}-${corridor.targetCurrency}`}
                >
                  <Td>
                    {countryName.get(corridor.sourceCountry) ?? corridor.sourceCountry} →{' '}
                    {countryName.get(corridor.targetCountry) ?? corridor.targetCountry}
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

      <Alert tone="info" className="mt-5">
        Mobile-money operators and KYC vendors are simulated in BI-Rem Lite: every figure above
        comes from real ledger postings, but no real operator was contacted.
      </Alert>
    </>
  );
}
