import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ActionButton } from '@/components/admin/action-button';
import { BarChart } from '@/components/admin/charts';
import { type SearchParams, flattenParams } from '@/components/admin/helpers';
import { ProviderFields } from '@/components/admin/provider-form';
import { Notice } from '@/components/admin/notice';
import { ConnectivityTest, WebhookSecretForm } from '@/components/admin/provider-widgets';
import {
  ActionForm,
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  FormMessage,
  Input,
  PageHeader,
  SimulatedBadge,
  StatusBadge,
  SubmitButton,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatDateTime, humanize } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import {
  ADAPTER_OPTIONS,
  getProvider,
  listProviderHealthChecks,
  listProviderSecretVersions,
} from '@/server/connectors';
import { listProviderWebhookEvents } from '@/server/connectors/webhooks';
import { listCountries } from '@/server/countries';
import { isAppError } from '@/server/errors';
import { CURRENCY_CODES } from '@/server/money';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';

import {
  rotateWebhookSecretAction,
  setProviderCredentialsAction,
  setProviderStatusAction,
  testProviderConnectivityAction,
  updateProviderAction,
} from '../actions';

export const metadata: Metadata = { title: 'Provider' };

const CREDENTIAL_ROWS = [0, 1, 2, 3] as const;

/** One provider: settings, write-only secrets, connectivity test, health and webhook history. */
export default async function ProviderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const provider = await getProvider(ctx, id).catch((error: unknown) => {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  const [checks, secrets, events, countries, query] = await Promise.all([
    listProviderHealthChecks(ctx, id, 40),
    listProviderSecretVersions(ctx, id),
    listProviderWebhookEvents(ctx, id, 10),
    listCountries(),
    searchParams.then(flattenParams),
  ]);
  const canWrite = roleHasPermission(user.role, 'providers:write');
  const canTest = roleHasPermission(user.role, 'providers:test');
  const chronological = [...checks].reverse();

  return (
    <>
      <PageHeader
        back={{ href: '/admin/providers', label: 'Providers' }}
        title={provider.name}
        description={`${provider.operator} · ${provider.countryCode} · ${provider.currency} · code ${provider.code}`}
        actions={
          <>
            {provider.simulated ? <SimulatedBadge /> : null}
            <StatusBadge status={provider.environment} />
            <StatusBadge
              status={provider.status}
              label={provider.status === 'INACTIVE' ? 'Disabled' : undefined}
            />
          </>
        }
      />

      <Notice code={query.notice} />
      {query.created ? (
        <Alert tone="success" className="mb-5">
          Provider created. Store its credentials and webhook secret below, then test connectivity.
        </Alert>
      ) : null}
      {provider.simulated ? (
        <Alert tone="info" className="mb-5">
          This provider runs on the deterministic sandbox simulator. Connectivity tests, payouts and
          collections never reach a real operator.
        </Alert>
      ) : (
        <Alert tone="warning" title="Generic HTTP adapter" className="mb-5">
          Config-driven connector for an operator gateway. It has not been validated against a real
          operator: treat the first live calls as a pilot.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Connection settings"
              description={`Updated ${formatDateTime(provider.updatedAt)}`}
            />
            <CardBody>
              {canWrite ? (
                <ActionForm action={updateProviderAction} className="space-y-5">
                  <input type="hidden" name="providerId" value={provider.id} />
                  <ProviderFields
                    provider={provider}
                    countries={countries}
                    adapters={ADAPTER_OPTIONS}
                    currencies={CURRENCY_CODES}
                  />
                  <FormMessage />
                  <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
                </ActionForm>
              ) : (
                <DescriptionList
                  items={[
                    { label: 'Adapter', value: provider.adapter },
                    { label: 'Environment', value: humanize(provider.environment) },
                    { label: 'Base URL', value: provider.baseUrl ?? '—' },
                    { label: 'Callback URL', value: provider.callbackUrl ?? '—' },
                    { label: 'Payouts', value: provider.supportsPayout ? 'Supported' : 'No' },
                    {
                      label: 'Collections',
                      value: provider.supportsCollection ? 'Supported' : 'No',
                    },
                  ]}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Health history"
              description="Every connectivity test, newest first"
              action={<StatusBadge status={provider.healthStatus} />}
            />
            <CardBody>
              {checks.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  This provider has never been tested. Run a connectivity test to start its history.
                </p>
              ) : (
                <BarChart
                  title="Latency of the last connectivity tests"
                  seriesLabel="Latency"
                  axisLabels={false}
                  summary={`${checks.length} tests; the latest took ${checks[0]?.latencyMs ?? 0} ms and was ${humanize(checks[0]?.status ?? 'UNKNOWN').toLowerCase()}.`}
                  points={chronological.map((check, index) => ({
                    label: `${index + 1}. ${formatDateTime(check.createdAt)}`,
                    value: check.latencyMs ?? 0,
                    display: `${check.latencyMs ?? '—'} ms (${humanize(check.status)})`,
                  }))}
                />
              )}
            </CardBody>
            {checks.length > 0 ? (
              <Table caption="Health checks">
                <THead>
                  <Tr>
                    <Th>When</Th>
                    <Th>Result</Th>
                    <Th align="right">Latency</Th>
                    <Th>Message</Th>
                  </Tr>
                </THead>
                <TBody>
                  {checks.slice(0, 10).map((check) => (
                    <Tr key={check.id}>
                      <Td className="whitespace-nowrap">{formatDateTime(check.createdAt)}</Td>
                      <Td>
                        <StatusBadge status={check.status} />
                      </Td>
                      <Td align="right">
                        {check.latencyMs === null ? '—' : `${check.latencyMs} ms`}
                      </Td>
                      <Td className="text-fg-muted">{check.message ?? '—'}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Secret versions"
              description="Rotation history. Only metadata is stored in readable form — values are encrypted and never shown."
            />
            {secrets.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">
                  No secret has been stored for this provider.
                </p>
              </CardBody>
            ) : (
              <Table caption="Secret versions">
                <THead>
                  <Tr>
                    <Th>Kind</Th>
                    <Th align="right">Version</Th>
                    <Th>Hint</Th>
                    <Th>Stored</Th>
                    <Th>State</Th>
                  </Tr>
                </THead>
                <TBody>
                  {secrets.map((secret) => (
                    <Tr key={secret.id}>
                      <Td>{humanize(secret.kind)}</Td>
                      <Td align="right">v{secret.version}</Td>
                      <Td className="text-fg-muted">{secret.hint ?? '—'}</Td>
                      <Td className="whitespace-nowrap">{formatDateTime(secret.createdAt)}</Td>
                      <Td>
                        {secret.retiredAt ? (
                          <Badge>Retired {formatDateTime(secret.retiredAt)}</Badge>
                        ) : (
                          <Badge tone="success">Current</Badge>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Inbound webhooks"
              description={`Signed callbacks received at ${provider.webhookPath}`}
            />
            {events.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">No webhook received yet.</p>
              </CardBody>
            ) : (
              <Table caption="Recent webhook events">
                <THead>
                  <Tr>
                    <Th>Received</Th>
                    <Th>Event</Th>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th>Error</Th>
                  </Tr>
                </THead>
                <TBody>
                  {events.map((event) => (
                    <Tr key={event.id}>
                      <Td className="whitespace-nowrap">{formatDateTime(event.receivedAt)}</Td>
                      <Td className="font-mono text-xs">{event.eventId}</Td>
                      <Td>{event.eventType}</Td>
                      <Td>
                        <StatusBadge status={event.status} />
                      </Td>
                      <Td className="text-fg-muted">{event.error ?? '—'}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {canTest ? (
            <Card>
              <CardHeader
                title="Connectivity"
                description={
                  provider.lastHealthCheckAt
                    ? `Last test ${formatDateTime(provider.lastHealthCheckAt)} · ${provider.lastLatencyMs ?? '—'} ms`
                    : 'Never tested'
                }
              />
              <CardBody>
                <ConnectivityTest
                  action={testProviderConnectivityAction}
                  providerId={provider.id}
                  size="md"
                />
              </CardBody>
            </Card>
          ) : null}

          {canWrite ? (
            <Card>
              <CardHeader
                title="Availability"
                description="Disabled providers are hidden from customers and partners."
              />
              <CardBody className="flex flex-wrap gap-2">
                {provider.status === 'ACTIVE' ? null : (
                  <ActionButton
                    action={setProviderStatusAction}
                    fields={{ providerId: provider.id, status: 'ACTIVE' }}
                    variant="primary"
                  >
                    Enable
                  </ActionButton>
                )}
                {provider.status === 'MAINTENANCE' ? null : (
                  <ActionButton
                    action={setProviderStatusAction}
                    fields={{ providerId: provider.id, status: 'MAINTENANCE' }}
                  >
                    Maintenance
                  </ActionButton>
                )}
                {provider.status === 'INACTIVE' ? null : (
                  <ActionButton
                    action={setProviderStatusAction}
                    fields={{ providerId: provider.id, status: 'INACTIVE' }}
                    variant="danger"
                    confirm={`Disable ${provider.name}? Customers will no longer be able to use it.`}
                  >
                    Disable
                  </ActionButton>
                )}
              </CardBody>
            </Card>
          ) : null}

          {canWrite ? (
            <Card>
              <CardHeader
                title="Credentials"
                description={
                  provider.hasCredentials
                    ? `Version ${provider.credentialsVersion} is in use. Saving stores a new version and retires it.`
                    : 'None stored yet.'
                }
              />
              <CardBody>
                <ActionForm
                  action={setProviderCredentialsAction}
                  className="space-y-3"
                  autoComplete="off"
                >
                  <input type="hidden" name="providerId" value={provider.id} />
                  <p className="text-xs text-fg-muted">
                    Write-only: values are encrypted (AES-256-GCM) before they are stored and can
                    never be displayed again. Enter the complete set each time.
                  </p>
                  {CREDENTIAL_ROWS.map((row) => (
                    <div key={row} className="grid grid-cols-2 gap-2">
                      <Input
                        name="credentialName[]"
                        label={`Field ${row + 1} name`}
                        hideLabel
                        placeholder={row === 0 ? 'apiKey' : row === 1 ? 'apiSecret' : 'field name'}
                        autoCapitalize="none"
                        spellCheck={false}
                        maxLength={41}
                        pattern="[A-Za-z][A-Za-z0-9_]{0,40}"
                      />
                      <Input
                        name="credentialValue[]"
                        type="password"
                        label={`Field ${row + 1} value`}
                        hideLabel
                        placeholder="value"
                        autoComplete="new-password"
                        maxLength={4000}
                      />
                    </div>
                  ))}
                  <FormMessage />
                  <SubmitButton size="sm" variant="secondary" pendingLabel="Encrypting…">
                    {provider.hasCredentials ? 'Rotate credentials' : 'Store credentials'}
                  </SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          {canWrite ? (
            <Card>
              <CardHeader
                title="Webhook secret"
                description={
                  provider.hasWebhookSecret
                    ? `Version ${provider.webhookSecretVersion} verifies inbound callbacks.`
                    : 'Not set: inbound webhooks are rejected.'
                }
              />
              <CardBody>
                <WebhookSecretForm
                  action={rotateWebhookSecretAction}
                  providerId={provider.id}
                  hasSecret={provider.hasWebhookSecret}
                />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Endpoints" />
            <CardBody>
              <DescriptionList
                items={[
                  {
                    label: 'Webhook path',
                    value: <code className="break-all text-xs">{provider.webhookPath}</code>,
                  },
                  {
                    label: 'Signature header',
                    value: <code className="text-xs">x-birem-signature</code>,
                  },
                  {
                    label: 'Callback URL',
                    value: provider.callbackUrl ? (
                      <code className="break-all text-xs">{provider.callbackUrl}</code>
                    ) : (
                      '—'
                    ),
                  },
                  {
                    label: 'Base URL',
                    value: provider.baseUrl ? (
                      <code className="break-all text-xs">{provider.baseUrl}</code>
                    ) : (
                      '—'
                    ),
                  },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
