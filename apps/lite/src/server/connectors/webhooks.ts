import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { WEBHOOK_SIGNATURE_HEADER, verifyWebhookSignature } from '../crypto';
import { db } from '../db';
import { AppError } from '../errors';
import { RATE_LIMITS, hitRateLimit } from '../rate-limit';
import { type ActionContext, assertPermission } from '../rbac';
import { applyProviderOutcome } from '../transfers/engine';
import { loadWebhookSecrets } from './registry';

/**
 * Inbound provider webhooks (phase 4): `POST /api/webhooks/providers/<providerCode>`.
 *
 * Security: the raw body must carry `x-birem-signature: t=<unix>,v1=<hmac>` computed with the
 * provider's webhook secret (current, or the previous one for 24 h after a rotation); the
 * timestamp must be within ±5 minutes; and `(provider, eventId)` is unique in the database, so a
 * replayed event is acknowledged without being applied twice.
 */

export { WEBHOOK_SIGNATURE_HEADER };

export const providerWebhookSchema = z.object({
  /** Unique id of the event at the provider — the replay-protection key. */
  eventId: z.string().min(1).max(200),
  type: z.string().min(1).max(100).default('transfer.status'),
  /** BI-Rem transfer reference and/or the provider's own reference. */
  reference: z.string().max(100).optional(),
  providerRef: z.string().max(200).optional(),
  status: z.enum(['SUCCESS', 'FAILED', 'PENDING']),
  failureCode: z.string().max(100).optional(),
  failureReason: z.string().max(500).optional(),
});
export type ProviderWebhookPayload = z.infer<typeof providerWebhookSchema>;

export type ProviderWebhookResult =
  | { outcome: 'PROCESSED'; transferId: string; transferStatus: string }
  | { outcome: 'DUPLICATE' }
  | { outcome: 'IGNORED'; reason: string };

/**
 * Verifies, de-duplicates and applies one provider webhook. Throws `AppError`:
 * NOT_FOUND (unknown provider), UNAUTHENTICATED (bad/missing/expired signature, or no secret
 * configured), VALIDATION (malformed body), RATE_LIMITED.
 */
export async function handleProviderWebhook(input: {
  providerCode: string;
  rawBody: string;
  signature: string | null;
  now?: Date;
}): Promise<ProviderWebhookResult> {
  const now = input.now ?? new Date();
  const provider = await db.provider.findUnique({
    where: { code: input.providerCode.toLowerCase() },
    select: { id: true, webhookSecretVersion: true },
  });
  if (!provider) throw new AppError('NOT_FOUND', 'Unknown provider');

  // Authenticate first. Unsigned or badly signed calls are throttled in their own bucket, so a
  // flood of forged requests can never use up the allowance of the provider's real webhooks.
  const reject = async (message: string): Promise<never> => {
    const rejected = await hitRateLimit(
      `webhook:rejected:${provider.id}`,
      RATE_LIMITS.webhookPerProvider,
      now,
    );
    if (!rejected.allowed) throw new AppError('RATE_LIMITED', 'Too many webhook calls');
    throw new AppError('UNAUTHENTICATED', message);
  };
  const secrets =
    provider.webhookSecretVersion > 0 ? await loadWebhookSecrets(provider.id, now) : [];
  if (secrets.length === 0) {
    return reject('No webhook secret is configured for this provider');
  }
  const verification = verifyWebhookSignature(secrets, input.rawBody, input.signature, { now });
  if (!verification.ok) {
    return reject(`Webhook signature rejected (${verification.reason.toLowerCase()})`);
  }

  const limit = await hitRateLimit(
    `webhook:provider:${provider.id}`,
    RATE_LIMITS.webhookPerProvider,
    now,
  );
  if (!limit.allowed) throw new AppError('RATE_LIMITED', 'Too many webhook calls');

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    throw new AppError('VALIDATION', 'Body must be JSON');
  }
  const parsed = providerWebhookSchema.safeParse(json);
  if (!parsed.success) throw new AppError('VALIDATION', 'Unexpected webhook payload');
  const payload = parsed.data;

  // Replay protection: `(provider, eventId)` is unique. The insert uses ON CONFLICT DO NOTHING,
  // so a replay is an ordinary zero-row result rather than a failed statement in the logs.
  let eventRowId: string = randomUUID();
  const inserted = await db.providerWebhookEvent.createMany({
    data: [
      {
        id: eventRowId,
        providerId: provider.id,
        eventId: payload.eventId,
        eventType: payload.type,
        payload,
        receivedAt: now,
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 0) {
    // A redelivery. If the first attempt FAILED on our side (the provider got a 5xx and is
    // retrying), claim the event again — atomically, so two retries cannot both process it.
    // Anything already processed, ignored or still in progress stays a duplicate.
    const where = { providerId_eventId: { providerId: provider.id, eventId: payload.eventId } };
    const reclaimed = await db.providerWebhookEvent.updateMany({
      where: { providerId: provider.id, eventId: payload.eventId, status: 'FAILED' },
      data: {
        status: 'RECEIVED',
        error: null,
        payload,
        eventType: payload.type,
        processedAt: null,
      },
    });
    if (reclaimed.count === 0) return { outcome: 'DUPLICATE' };
    eventRowId = (await db.providerWebhookEvent.findUniqueOrThrow({ where, select: { id: true } }))
      .id;
  }

  const finish = async (
    status: 'PROCESSED' | 'IGNORED' | 'FAILED',
    extra: { error?: string; transferId?: string } = {},
  ): Promise<void> => {
    await db.providerWebhookEvent.update({
      where: { id: eventRowId },
      data: {
        status,
        error: extra.error ?? null,
        transferId: extra.transferId ?? null,
        processedAt: new Date(),
      },
    });
  };

  const transfer = await db.transfer.findFirst({
    where: {
      providerId: provider.id,
      OR: [
        ...(payload.reference ? [{ reference: payload.reference }] : []),
        ...(payload.providerRef ? [{ providerRef: payload.providerRef }] : []),
      ],
    },
    select: { id: true, status: true },
  });
  if (!transfer || (!payload.reference && !payload.providerRef)) {
    await finish('IGNORED', { error: 'No matching transfer' });
    return { outcome: 'IGNORED', reason: 'No matching transfer' };
  }
  if (transfer.status !== 'PROCESSING') {
    await finish('IGNORED', { error: `Transfer is ${transfer.status}`, transferId: transfer.id });
    return { outcome: 'IGNORED', reason: `Transfer is already ${transfer.status}` };
  }

  try {
    const updated = await applyProviderOutcome(
      transfer.id,
      payload.status === 'SUCCESS'
        ? { status: 'SUCCESS', providerRef: payload.providerRef ?? null }
        : payload.status === 'FAILED'
          ? {
              status: 'FAILED',
              providerRef: payload.providerRef ?? null,
              failureCode: payload.failureCode ?? 'PROVIDER_FAILED',
              failureReason: payload.failureReason ?? 'The provider declined the transaction',
            }
          : { status: 'PENDING', providerRef: payload.providerRef ?? null },
      { source: 'WEBHOOK', now },
    );
    await finish('PROCESSED', { transferId: transfer.id });
    return { outcome: 'PROCESSED', transferId: updated.id, transferStatus: updated.status };
  } catch (error) {
    await finish('FAILED', {
      error: error instanceof Error ? error.message.slice(0, 500) : 'unknown error',
      transferId: transfer.id,
    });
    throw error;
  }
}

/** Recent inbound webhook events of a provider (admin connectivity page). `providers:read`. */
export async function listProviderWebhookEvents(
  ctx: ActionContext,
  providerId: string,
  limit = 50,
) {
  assertPermission(ctx, 'providers:read');
  return db.providerWebhookEvent.findMany({
    where: { providerId },
    orderBy: { receivedAt: 'desc' },
    take: Math.min(limit, 200),
  });
}
