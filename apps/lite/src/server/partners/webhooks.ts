import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { writeAudit } from '../audit';
import {
  WEBHOOK_SIGNATURE_HEADER,
  decryptSecret,
  encryptSecret,
  randomToken,
  signWebhookPayload,
} from '../crypto';
import { type Prisma, db } from '../db';
import { AppError } from '../errors';
import { assertSafeOutboundUrl, parseOutboundUrl } from '../net-guard';
import { type ActionContext, actorPartnerId, actorUserId, hasPermission } from '../rbac';

/**
 * Outbound partner webhooks (phase 9): endpoints with an encrypted signing secret, HMAC-signed
 * deliveries sent inline (no queue in Lite) with a short timeout, and a delivery log.
 *
 * Signature header `x-birem-signature: t=<unix>,v1=<hex hmac-sha256("<t>.<body>")>`.
 */

export const PARTNER_EVENT_TYPES = [
  'transfer.completed',
  'transfer.failed',
  'transfer.on_hold',
  'transfer.rejected',
  'transfer.reversed',
  'payment.received',
  'payment.reversed',
  'settlement.paid',
  'webhook.test',
] as const;
export type PartnerEventType = (typeof PARTNER_EVENT_TYPES)[number];

const DELIVERY_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BODY = 500;

/** Partner the actor may manage: their own, or `partnerId` for staff with `partners:write`. */
export function resolvePartnerScope(ctx: ActionContext, partnerId?: string, write = false): string {
  const own = actorPartnerId(ctx);
  if (own && (!partnerId || partnerId === own)) return own;
  if (
    partnerId &&
    (ctx.actor.type === 'SYSTEM' || hasPermission(ctx, write ? 'partners:write' : 'partners:read'))
  ) {
    return partnerId;
  }
  throw new AppError('FORBIDDEN', 'You cannot access this partner');
}

export const webhookEndpointSchema = z.object({
  url: z.string().trim().min(8).max(500),
  description: z.string().trim().max(200).optional(),
  events: z
    .array(z.enum(PARTNER_EVENT_TYPES))
    .min(1, 'Choose at least one event')
    .max(PARTNER_EVENT_TYPES.length),
});

const ENDPOINT_SELECT = {
  id: true,
  partnerId: true,
  url: true,
  description: true,
  events: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Registers an endpoint. The signing secret is generated here, stored encrypted and returned
 * ONCE in `secret`; it cannot be read again.
 */
export async function createWebhookEndpoint(
  ctx: ActionContext,
  input: z.infer<typeof webhookEndpointSchema>,
  partnerId?: string,
) {
  const scope = resolvePartnerScope(ctx, partnerId, true);
  const data = webhookEndpointSchema.parse(input);
  parseOutboundUrl(data.url);
  const count = await db.webhookEndpoint.count({ where: { partnerId: scope } });
  if (count >= 5) throw new AppError('CONFLICT', 'A partner can have at most 5 webhook endpoints');
  const secret = `whsec_${randomToken(32)}`;
  return db.$transaction(async (tx) => {
    const endpoint = await tx.webhookEndpoint.create({
      data: {
        partnerId: scope,
        url: data.url,
        description: data.description ?? null,
        events: [...new Set(data.events)],
        secretEnc: encryptSecret(secret),
        createdById: actorUserId(ctx),
      },
      select: ENDPOINT_SELECT,
    });
    await writeAudit(tx, ctx, {
      action: 'webhook_endpoint.create',
      resourceType: 'webhook_endpoint',
      resourceId: endpoint.id,
      after: { partnerId: scope, url: endpoint.url, events: endpoint.events },
    });
    return { endpoint, secret };
  });
}

export async function listWebhookEndpoints(ctx: ActionContext, partnerId?: string) {
  const scope = resolvePartnerScope(ctx, partnerId);
  return db.webhookEndpoint.findMany({
    where: { partnerId: scope },
    orderBy: { createdAt: 'asc' },
    select: ENDPOINT_SELECT,
  });
}

async function loadOwnedEndpoint(ctx: ActionContext, endpointId: string, write: boolean) {
  const endpoint = await db.webhookEndpoint.findUnique({ where: { id: endpointId } });
  if (!endpoint) throw new AppError('NOT_FOUND', 'Webhook endpoint not found');
  try {
    resolvePartnerScope(ctx, endpoint.partnerId, write);
  } catch {
    throw new AppError('NOT_FOUND', 'Webhook endpoint not found');
  }
  return endpoint;
}

export async function setWebhookEndpointActive(
  ctx: ActionContext,
  endpointId: string,
  active: boolean,
) {
  const endpoint = await loadOwnedEndpoint(ctx, endpointId, true);
  return db.$transaction(async (tx) => {
    const updated = await tx.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { active },
      select: ENDPOINT_SELECT,
    });
    await writeAudit(tx, ctx, {
      action: active ? 'webhook_endpoint.enable' : 'webhook_endpoint.disable',
      resourceType: 'webhook_endpoint',
      resourceId: endpoint.id,
    });
    return updated;
  });
}

export async function deleteWebhookEndpoint(ctx: ActionContext, endpointId: string): Promise<void> {
  const endpoint = await loadOwnedEndpoint(ctx, endpointId, true);
  await db.$transaction(async (tx) => {
    await tx.webhookEndpoint.delete({ where: { id: endpoint.id } });
    await writeAudit(tx, ctx, {
      action: 'webhook_endpoint.delete',
      resourceType: 'webhook_endpoint',
      resourceId: endpoint.id,
      before: { partnerId: endpoint.partnerId, url: endpoint.url },
    });
  });
}

/** Delivery log of the actor's partner (optionally one endpoint), newest first. */
export async function listWebhookDeliveries(
  ctx: ActionContext,
  options: { partnerId?: string; endpointId?: string; limit?: number } = {},
) {
  const scope = resolvePartnerScope(ctx, options.partnerId);
  return db.webhookDelivery.findMany({
    where: {
      endpoint: { partnerId: scope },
      ...(options.endpointId ? { endpointId: options.endpointId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.limit ?? 50, 200),
    include: { endpoint: { select: { url: true } } },
  });
}

interface DeliveryTarget {
  id: string;
  url: string;
  secretEnc: string;
}

async function deliver(
  endpoint: DeliveryTarget,
  eventId: string,
  eventType: string,
  payload: Prisma.InputJsonValue,
): Promise<{ deliveryId: string; status: 'DELIVERED' | 'FAILED' }> {
  const body = JSON.stringify(payload);
  const signature = signWebhookPayload(decryptSecret(endpoint.secretEnc), body);
  const delivery = await db.webhookDelivery.create({
    data: { endpointId: endpoint.id, eventId, eventType, payload, signature, attempts: 1 },
    select: { id: true },
  });
  const started = Date.now();
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;
  try {
    const url = await assertSafeOutboundUrl(endpoint.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'BI-Rem-Lite-Webhooks/1.0',
          [WEBHOOK_SIGNATURE_HEADER]: signature,
          'x-birem-event': eventType,
          'x-birem-delivery': delivery.id,
        },
        body,
        signal: controller.signal,
        redirect: 'error',
      });
      responseStatus = response.status;
      responseBody = (await response.text()).slice(0, MAX_RESPONSE_BODY);
    } finally {
      clearTimeout(timer);
    }
  } catch (cause) {
    error =
      cause instanceof AppError
        ? cause.message
        : cause instanceof Error && cause.name === 'AbortError'
          ? `Timed out after ${DELIVERY_TIMEOUT_MS} ms`
          : 'Endpoint could not be reached';
  }
  const delivered = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;
  await db.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: delivered ? 'DELIVERED' : 'FAILED',
      responseStatus,
      responseBody,
      error: delivered ? null : (error ?? `HTTP ${responseStatus}`),
      durationMs: Date.now() - started,
      deliveredAt: delivered ? new Date() : null,
    },
  });
  return { deliveryId: delivery.id, status: delivered ? 'DELIVERED' : 'FAILED' };
}

/**
 * Sends an event to every active endpoint of a partner subscribed to `eventType`. Never throws:
 * failures are recorded in the delivery log. Call AFTER the triggering transaction commits.
 */
export async function dispatchPartnerEvent(
  partnerId: string,
  eventType: PartnerEventType,
  data: Record<string, unknown>,
): Promise<number> {
  try {
    const endpoints = await db.webhookEndpoint.findMany({
      where: { partnerId, active: true, events: { has: eventType } },
      select: { id: true, url: true, secretEnc: true },
    });
    if (endpoints.length === 0) return 0;
    const eventId = randomUUID();
    const payload = {
      id: eventId,
      type: eventType,
      createdAt: new Date().toISOString(),
      data,
    } as Prisma.InputJsonValue;
    const results = await Promise.allSettled(
      endpoints.map((endpoint) => deliver(endpoint, eventId, eventType, payload)),
    );
    return results.filter(
      (result) => result.status === 'fulfilled' && result.value.status === 'DELIVERED',
    ).length;
  } catch (error) {
    console.error('[webhooks] dispatch failed', error instanceof Error ? error.message : error);
    return 0;
  }
}

/** Sends a `webhook.test` event to one endpoint and returns the logged delivery. */
export async function sendTestWebhook(ctx: ActionContext, endpointId: string) {
  const endpoint = await loadOwnedEndpoint(ctx, endpointId, true);
  const eventId = randomUUID();
  const result = await deliver(endpoint, eventId, 'webhook.test', {
    id: eventId,
    type: 'webhook.test',
    createdAt: new Date().toISOString(),
    data: { message: 'Test event from BI-Rem Lite' },
  });
  await writeAudit(db, ctx, {
    action: 'webhook_endpoint.test',
    resourceType: 'webhook_endpoint',
    resourceId: endpoint.id,
    outcome: result.status === 'DELIVERED' ? 'SUCCESS' : 'FAILURE',
  });
  return db.webhookDelivery.findUniqueOrThrow({ where: { id: result.deliveryId } });
}

/** Re-sends a logged delivery (same payload, fresh signature) as a new delivery row. */
export async function redeliverWebhook(ctx: ActionContext, deliveryId: string) {
  const previous = await db.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!previous) throw new AppError('NOT_FOUND', 'Delivery not found');
  await loadOwnedEndpoint(ctx, previous.endpointId, true);
  const result = await deliver(
    previous.endpoint,
    previous.eventId,
    previous.eventType,
    previous.payload as Prisma.InputJsonValue,
  );
  return db.webhookDelivery.findUniqueOrThrow({ where: { id: result.deliveryId } });
}
