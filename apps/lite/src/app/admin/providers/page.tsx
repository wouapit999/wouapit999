import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { FilterBar } from '@/components/admin/filter-bar';
import {
  type SearchParams,
  countryParam,
  enumOptions,
  enumParam,
  flattenParams,
} from '@/components/admin/helpers';
import { ConnectivityTest } from '@/components/admin/provider-widgets';
import { RailsRegistry } from '@/components/admin/rails-registry';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  Select,
  SimulatedBadge,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatRelative, humanize } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { SIMULATOR_SCENARIOS, listProviders } from '@/server/connectors';
import { listCountries } from '@/server/countries';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';

import { testProviderConnectivityAction } from './actions';

export const metadata: Metadata = { title: 'Providers' };

const STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE'] as const;
const querySchema = z.object({ country: countryParam, status: enumParam(STATUSES) });

/** Provider directory (phase 3): every mobile-money connection is one database row. */
export default async function ProvidersPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const query = querySchema.parse(flattenParams(await searchParams));
  const [providers, countries] = await Promise.all([
    listProviders(ctx, { countryCode: query.country, status: query.status }),
    listCountries(),
  ]);
  const canWrite = roleHasPermission(user.role, 'providers:write');
  const canTest = roleHasPermission(user.role, 'providers:test');
  const countryName = new Map(countries.map((country) => [country.code, country.name]));
  const simulated = providers.filter((provider) => provider.simulated).length;

  return (
    <>
      <PageHeader
        title="Providers & rails"
        description="Mobile-money operators BI-Rem can pay out to and collect from. Credentials live encrypted in the database — never in code — and are write-only."
        actions={
          canWrite ? <LinkButton href="/admin/providers/new">Add provider</LinkButton> : undefined
        }
      />
      {simulated > 0 ? (
        <Alert tone="info" className="mb-5">
          {simulated} of {providers.length} listed provider{providers.length === 1 ? '' : 's'} use
          the sandbox simulator: transfers behave realistically, but no real operator is contacted.
        </Alert>
      ) : null}

      <Card>
        <FilterBar action="/admin/providers">
          <Select
            name="country"
            label="Country"
            placeholder="All countries"
            defaultValue={query.country}
            options={countries.map((country) => ({
              value: country.code,
              label: `${country.name} (${country.code})`,
            }))}
          />
          <Select
            name="status"
            label="Status"
            placeholder="Any status"
            defaultValue={query.status}
            options={enumOptions(STATUSES, humanize)}
          />
        </FilterBar>
        {providers.length === 0 ? (
          <EmptyState title="No provider matches these filters" />
        ) : (
          <Table caption="Provider directory">
            <THead>
              <Tr>
                <Th>Provider</Th>
                <Th>Country</Th>
                <Th>Adapter</Th>
                <Th>Environment</Th>
                <Th>Status</Th>
                <Th>Health</Th>
                <Th>Secrets</Th>
                {canTest ? <Th>Connectivity</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {providers.map((provider) => (
                <Tr key={provider.id} data-provider={provider.code}>
                  <Td>
                    <Link
                      href={`/admin/providers/${provider.id}`}
                      className="font-medium text-fg underline-offset-2 hover:underline"
                    >
                      {provider.name}
                    </Link>
                    <p className="text-xs text-fg-subtle">{provider.code}</p>
                  </Td>
                  <Td>
                    {countryName.get(provider.countryCode) ?? provider.countryCode}
                    <p className="text-xs text-fg-muted">{provider.currency}</p>
                  </Td>
                  <Td>
                    <span className="whitespace-nowrap">
                      {provider.adapter} {provider.simulated ? <SimulatedBadge /> : null}
                    </span>
                  </Td>
                  <Td>
                    <StatusBadge status={provider.environment} />
                  </Td>
                  <Td>
                    <StatusBadge
                      status={provider.status}
                      label={provider.status === 'INACTIVE' ? 'Disabled' : undefined}
                    />
                  </Td>
                  <Td>
                    <StatusBadge status={provider.healthStatus} />
                    <p className="text-xs text-fg-muted">
                      {provider.lastHealthCheckAt
                        ? `${provider.lastLatencyMs ?? '—'} ms · ${formatRelative(provider.lastHealthCheckAt)}`
                        : 'Never tested'}
                    </p>
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={provider.hasCredentials ? 'success' : 'neutral'}>
                        {provider.hasCredentials
                          ? `Credentials v${provider.credentialsVersion}`
                          : 'No credentials'}
                      </Badge>
                      <Badge tone={provider.hasWebhookSecret ? 'success' : 'neutral'}>
                        {provider.hasWebhookSecret
                          ? `Webhook secret v${provider.webhookSecretVersion}`
                          : 'No webhook secret'}
                      </Badge>
                    </div>
                  </Td>
                  {canTest ? (
                    <Td className="min-w-44">
                      <ConnectivityTest
                        action={testProviderConnectivityAction}
                        providerId={provider.id}
                        label="Test"
                      />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RailsRegistry />
        </div>
        <Card>
          <CardHeader
            title="Sandbox cheat sheet"
            description="The simulator decides the outcome from the last four digits of the account number."
            action={<SimulatedBadge />}
          />
          <CardBody>
            <dl className="space-y-1.5 text-sm">
              {SIMULATOR_SCENARIOS.map((scenario) => (
                <div key={scenario.suffix} className="flex gap-3">
                  <dt className="tabular w-12 shrink-0 font-mono font-medium text-fg">
                    …{scenario.suffix}
                  </dt>
                  <dd className="text-fg-muted">{scenario.label}</dd>
                </div>
              ))}
              <div className="flex gap-3">
                <dt className="w-12 shrink-0 font-medium text-fg">other</dt>
                <dd className="text-fg-muted">Succeeds immediately</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
