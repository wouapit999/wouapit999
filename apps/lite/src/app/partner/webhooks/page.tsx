import type { Metadata } from 'next';
import Link from 'next/link';

import { PartnerActionButton } from '@/components/partner/action-button';
import { DeliveryButton } from '@/components/partner/delivery-button';
import { type EventOption, WebhookEndpointForm } from '@/components/partner/webhook-endpoint-form';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { WEBHOOK_EVENTS } from '@/app/api/v1/_lib/reference';
import { formatDateTime } from '@/lib/format';
import { getEnv } from '@/server/env';
import { listWebhookDeliveries, listWebhookEndpoints } from '@/server/partners';

import { getPartnerPage } from '../_lib/partner';
import {
  createWebhookEndpointAction,
  deleteWebhookEndpointAction,
  redeliverWebhookAction,
  sendTestWebhookAction,
  setWebhookEndpointActiveAction,
} from '../actions';

export const metadata: Metadata = { title: 'Webhooks' };

const EVENT_OPTIONS: readonly EventOption[] = WEBHOOK_EVENTS.filter(
  (event) => event.type !== 'webhook.test',
).map((event) => ({ value: event.type, description: event.when }));

/** Senders care about their transfers; merchants and agents about what lands in their wallet. */
const defaultEventsFor = (type: string): string[] =>
  EVENT_OPTIONS.map((event) => event.value).filter((value) =>
    type === 'PARTNER' ? value.startsWith('transfer.') : !value.startsWith('transfer.'),
  );

const MAX_ENDPOINTS = 5;

/** Webhook endpoints (create with secret shown once, pause, test, delete) and the delivery log. */
export default async function PartnerWebhooksPage() {
  const { ctx, partner } = await getPartnerPage();
  const [endpoints, deliveries] = await Promise.all([
    listWebhookEndpoints(ctx),
    listWebhookDeliveries(ctx, { limit: 50 }),
  ]);
  const isActive = partner.status === 'ACTIVE';
  const atLimit = endpoints.length >= MAX_ENDPOINTS;
  // An event that reached an endpoint on a later attempt no longer needs a retry button.
  const deliveredKey = (delivery: { endpointId: string; eventId: string }) =>
    `${delivery.endpointId}:${delivery.eventId}`;
  const delivered = new Set(
    deliveries.filter((delivery) => delivery.status === 'DELIVERED').map(deliveredKey),
  );

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="BI-Rem POSTs a signed JSON event to your endpoints when a transfer changes state. Deliveries are attempted once, inline, with a 3-second timeout; a failed delivery stays in the log below until you retry it."
      />

      <Card>
        <CardHeader
          title="Endpoints"
          description={`${endpoints.length} of ${MAX_ENDPOINTS} endpoints`}
        />
        {endpoints.length === 0 ? (
          <EmptyState
            title="No endpoint yet"
            description="Add the URL of your server below to start receiving events."
          />
        ) : (
          <ul className="divide-y divide-border">
            {endpoints.map((endpoint) => (
              <li
                key={endpoint.id}
                className="flex flex-col gap-3 px-5 py-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between"
              >
                <div className="min-w-0 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-sm font-medium text-fg">
                      {endpoint.url}
                    </span>
                    <Badge tone={endpoint.active ? 'success' : 'neutral'}>
                      {endpoint.active ? 'Active' : 'Paused'}
                    </Badge>
                  </p>
                  {endpoint.description ? (
                    <p className="text-sm text-fg-muted">{endpoint.description}</p>
                  ) : null}
                  <p className="flex flex-wrap gap-1">
                    {endpoint.events.map((event) => (
                      <Badge key={event}>{event}</Badge>
                    ))}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    Added {formatDateTime(endpoint.createdAt)} · signing secret set (write-only)
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-start gap-2">
                  <DeliveryButton action={sendTestWebhookAction} fields={{ id: endpoint.id }}>
                    Send test event
                  </DeliveryButton>
                  <PartnerActionButton
                    action={setWebhookEndpointActiveAction}
                    fields={{ id: endpoint.id, active: endpoint.active ? 'false' : 'true' }}
                  >
                    {endpoint.active ? 'Pause' : 'Resume'}
                  </PartnerActionButton>
                  <PartnerActionButton
                    action={deleteWebhookEndpointAction}
                    fields={{ id: endpoint.id }}
                    variant="danger"
                    confirm="Delete this endpoint and its delivery log? This cannot be undone."
                    pendingLabel="Deleting…"
                  >
                    Delete
                  </PartnerActionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-5">
        <CardHeader
          title="Add an endpoint"
          description="The signing secret is generated for you and displayed once."
        />
        <CardBody>
          {!isActive ? (
            <Alert tone="info" className="mb-4">
              Webhooks are available once your partner account is active.
            </Alert>
          ) : atLimit ? (
            <Alert tone="warning" className="mb-4">
              You have {MAX_ENDPOINTS} endpoints, the maximum. Delete one to add another.
            </Alert>
          ) : null}
          <WebhookEndpointForm
            action={createWebhookEndpointAction}
            events={EVENT_OPTIONS}
            defaultEvents={defaultEventsFor(partner.type)}
            disabled={!isActive || atLimit}
            httpsOnly={getEnv().isProduction}
          />
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardHeader
          title="Delivery log"
          description="The last 50 deliveries, newest first. Retrying sends the same event again with a fresh signature."
          action={
            <Link
              href="/partner/docs#webhooks"
              className="text-sm font-medium text-accent hover:underline"
            >
              How to verify signatures →
            </Link>
          }
        />
        {deliveries.length === 0 ? (
          <EmptyState
            title="No delivery yet"
            description="Send a test event to an endpoint to see it here."
          />
        ) : (
          <Table caption="Webhook deliveries">
            <THead>
              <Tr>
                <Th>Time</Th>
                <Th>Event</Th>
                <Th>Endpoint</Th>
                <Th>Status</Th>
                <Th>Response</Th>
                <Th align="right">Duration</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {deliveries.map((delivery) => (
                <Tr key={delivery.id}>
                  <Td className="whitespace-nowrap text-fg-muted">
                    {formatDateTime(delivery.createdAt)}
                  </Td>
                  <Td>
                    <code className="font-mono text-[0.8125rem]">{delivery.eventType}</code>
                    <span className="block font-mono text-[0.6875rem] text-fg-subtle">
                      {delivery.eventId.slice(0, 8)}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="block max-w-56 truncate font-mono text-xs"
                      title={delivery.endpoint.url}
                    >
                      {delivery.endpoint.url}
                    </span>
                  </Td>
                  <Td>
                    <StatusBadge status={delivery.status} />
                  </Td>
                  <Td className="text-fg-muted">
                    {delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : '—'}
                    {delivery.error ? (
                      <span
                        className="block max-w-56 truncate text-xs text-danger"
                        title={delivery.error}
                      >
                        {delivery.error}
                      </span>
                    ) : null}
                  </Td>
                  <Td align="right" className="text-fg-muted">
                    {delivery.durationMs === null ? '—' : `${delivery.durationMs} ms`}
                  </Td>
                  <Td align="right">
                    {delivery.status === 'DELIVERED' ? null : delivered.has(
                        deliveredKey(delivery),
                      ) ? (
                      <Badge tone="neutral">Retried</Badge>
                    ) : (
                      <DeliveryButton
                        action={redeliverWebhookAction}
                        fields={{ deliveryId: delivery.id }}
                        pendingLabel="Retrying…"
                      >
                        Retry
                        <span className="sr-only"> delivery of {delivery.eventType}</span>
                      </DeliveryButton>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
