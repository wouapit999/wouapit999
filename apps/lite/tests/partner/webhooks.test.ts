import { createHmac } from 'node:crypto';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as providerWebhook } from '@/app/api/webhooks/providers/[code]/route';
import { rotateWebhookSecret } from '@/server/connectors/providers';
import {
  WEBHOOK_SIGNATURE_HEADER,
  signWebhookPayload,
  verifyWebhookSignature,
} from '@/server/crypto';
import { db } from '@/server/db';
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  dispatchPartnerEvent,
  listWebhookDeliveries,
  listWebhookEndpoints,
  redeliverWebhook,
  sendTestWebhook,
} from '@/server/partners';
import { createTransfer } from '@/server/transfers';

import { withTestDatabase } from '../helpers/db';
import {
  createCustomer,
  createPartner,
  createStaff,
  idem,
  providerId,
  systemBalance,
  walletBalance,
} from '../helpers/factories';

withTestDatabase();

// ---------------------------------------------------------------------------
// Signature scheme (shared by inbound provider webhooks and outbound partner webhooks)
// ---------------------------------------------------------------------------

describe('webhook signature', () => {
  const secret = 'whsec_unit_test_secret_value';
  const body = JSON.stringify({ eventId: 'evt_1', status: 'SUCCESS', reference: 'BRTEST000001' });
  const now = new Date('2026-11-10T12:00:00Z');

  it('is t=<unix>,v1=<hex hmac-sha256("<t>.<body>")>', () => {
    const header = signWebhookPayload(secret, body, now);
    const timestamp = Math.floor(now.getTime() / 1000);
    const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    expect(header).toBe(`t=${timestamp},v1=${expected}`);
    expect(verifyWebhookSignature(secret, body, header, { now })).toEqual({ ok: true, timestamp });
  });

  it('rejects a tampered body, a wrong secret and a signature for another timestamp', () => {
    const header = signWebhookPayload(secret, body, now);
    expect(
      verifyWebhookSignature(secret, body.replace('SUCCESS', 'FAILED'), header, { now }),
    ).toEqual({ ok: false, reason: 'MISMATCH' });
    expect(verifyWebhookSignature('whsec_another_secret_value', body, header, { now })).toEqual({
      ok: false,
      reason: 'MISMATCH',
    });
    // Re-stamping an old signature with a fresh timestamp does not make it valid.
    const [, v1] = header.split(',');
    const restamped = `t=${Math.floor(now.getTime() / 1000) + 30},${v1}`;
    expect(verifyWebhookSignature(secret, body, restamped, { now })).toEqual({
      ok: false,
      reason: 'MISMATCH',
    });
  });

  it('rejects a replay outside the ±5 minute window, in both directions', () => {
    const header = signWebhookPayload(secret, body, now);
    const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
    expect(verifyWebhookSignature(secret, body, header, { now: at(299) }).ok).toBe(true);
    expect(verifyWebhookSignature(secret, body, header, { now: at(301) })).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
    expect(verifyWebhookSignature(secret, body, header, { now: at(-301) })).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['no timestamp', `v1=${'a'.repeat(64)}`],
    ['no signature', 't=1794312000'],
    ['short signature', 't=1794312000,v1=abcd'],
    ['non-numeric timestamp', `t=soon,v1=${'a'.repeat(64)}`],
    ['uppercase hex', `t=1794312000,v1=${'A'.repeat(64)}`],
  ])('treats a %s header as malformed', (_label, header) => {
    expect(verifyWebhookSignature(secret, body, header, { now })).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
  });

  it('accepts the previous secret during a rotation', () => {
    const header = signWebhookPayload('whsec_previous_secret_value', body, now);
    expect(
      verifyWebhookSignature(
        ['whsec_current_secret_value', 'whsec_previous_secret_value'],
        body,
        header,
        {
          now,
        },
      ).ok,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inbound: POST /api/webhooks/providers/[code]
// ---------------------------------------------------------------------------

describe('inbound provider webhook route', () => {
  const PROVIDER = 'mtn-momo-cm';

  const post = (code: string, rawBody: string, signature?: string | null): Promise<Response> =>
    providerWebhook(
      new Request(`http://lite.test/api/webhooks/providers/${code}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(signature ? { [WEBHOOK_SIGNATURE_HEADER]: signature } : {}),
        },
        body: rawBody,
      }),
      { params: Promise.resolve({ code }) },
    );

  /** A payout to an account ending 0006: PROCESSING until a provider webhook arrives. */
  async function pendingPayout() {
    const sender = await createCustomer({ balance: 200_000n });
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: {
        kind: 'MOBILE_MONEY',
        providerId: await providerId(PROVIDER),
        accountNumber: '+237670000006',
        name: 'Pending Until Webhook',
      },
      amount: 10_000n,
      idempotencyKey: idem('payout'),
    });
    expect(transfer.status).toBe('PROCESSING');
    return { sender, transfer };
  }

  async function signingSecret(): Promise<string> {
    const admin = await createStaff('ADMIN');
    const { generatedSecret } = await rotateWebhookSecret(admin.ctx, await providerId(PROVIDER));
    if (!generatedSecret) throw new Error('no secret generated');
    return generatedSecret;
  }

  it('rejects an unsigned or forged webhook and leaves the transfer untouched', async () => {
    const secret = await signingSecret();
    const { sender, transfer } = await pendingPayout();
    const balance = await walletBalance(sender.walletId);
    const body = JSON.stringify({
      eventId: idem('evt'),
      reference: transfer.reference,
      status: 'SUCCESS',
    });

    const unsigned = await post(PROVIDER, body);
    expect(unsigned.status).toBe(401);
    const forged = await post(
      PROVIDER,
      body,
      `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
    );
    expect(forged.status).toBe(401);
    const wrongSecret = await post(
      PROVIDER,
      body,
      signWebhookPayload('whsec_not_the_right_one', body),
    );
    expect(wrongSecret.status).toBe(401);
    // Signed for a different body (the attacker flips the status of a captured event).
    const tampered = await post(
      PROVIDER,
      body,
      signWebhookPayload(secret, body.replace('SUCCESS', 'FAILED')),
    );
    expect(tampered.status).toBe(401);
    const stale = await post(
      PROVIDER,
      body,
      signWebhookPayload(secret, body, new Date(Date.now() - 10 * 60_000)),
    );
    expect(stale.status).toBe(401);

    expect((await db.transfer.findUniqueOrThrow({ where: { id: transfer.id } })).status).toBe(
      'PROCESSING',
    );
    expect(await walletBalance(sender.walletId)).toBe(balance);
    expect(await db.providerWebhookEvent.count({ where: { transferId: transfer.id } })).toBe(0);
    // A rejected call must not reveal whether the secret, the timestamp or the body was wrong
    // beyond the generic reason, and never echoes the secret.
    expect(JSON.stringify(await unsigned.json())).not.toContain(secret);
  });

  it('applies a correctly signed webhook through the engine, exactly once', async () => {
    const secret = await signingSecret();
    const { sender, transfer } = await pendingPayout();
    const suspenseBefore = await systemBalance('SUSPENSE', 'XAF');
    const eventId = idem('evt');
    const body = JSON.stringify({
      eventId,
      reference: transfer.reference,
      providerRef: 'OP-778899',
      status: 'SUCCESS',
    });

    const first = await post(PROVIDER, body, signWebhookPayload(secret, body));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      data: { outcome: 'PROCESSED', transferId: transfer.id, transferStatus: 'COMPLETED' },
    });
    const completed = await db.transfer.findUniqueOrThrow({ where: { id: transfer.id } });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.providerRef).toBe('OP-778899');
    const suspenseAfter = await systemBalance('SUSPENSE', 'XAF');
    expect(suspenseBefore - suspenseAfter).toBe(transfer.totalDebit);
    const journals = await db.journal.count({ where: { transferId: transfer.id } });

    // Replay 1: the very same request again (captured and re-sent within the window).
    const replay = await post(PROVIDER, body, signWebhookPayload(secret, body));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ data: { outcome: 'DUPLICATE' } });
    // Replay 2: same event id, freshly signed, now claiming a failure — must not refund.
    const flipped = JSON.stringify({ eventId, reference: transfer.reference, status: 'FAILED' });
    const second = await post(PROVIDER, flipped, signWebhookPayload(secret, flipped));
    expect(await second.json()).toEqual({ data: { outcome: 'DUPLICATE' } });
    // A new event for an already settled transfer is acknowledged but ignored.
    const late = JSON.stringify({
      eventId: idem('evt'),
      reference: transfer.reference,
      status: 'FAILED',
    });
    const third = await post(PROVIDER, late, signWebhookPayload(secret, late));
    expect(((await third.json()) as { data: { outcome: string } }).data.outcome).toBe('IGNORED');

    expect((await db.transfer.findUniqueOrThrow({ where: { id: transfer.id } })).status).toBe(
      'COMPLETED',
    );
    expect(await db.journal.count({ where: { transferId: transfer.id } })).toBe(journals);
    expect(await systemBalance('SUSPENSE', 'XAF')).toBe(suspenseAfter);
    expect(await walletBalance(sender.walletId)).toBe(200_000n - transfer.totalDebit);
  });

  it('refunds the sender on a signed FAILED webhook', async () => {
    const secret = await signingSecret();
    const { sender, transfer } = await pendingPayout();
    const body = JSON.stringify({
      eventId: idem('evt'),
      reference: transfer.reference,
      status: 'FAILED',
      failureCode: 'RECIPIENT_BLOCKED',
      failureReason: 'Recipient account is blocked',
    });
    const response = await post(PROVIDER, body, signWebhookPayload(secret, body));
    expect(response.status).toBe(200);
    const failed = await db.transfer.findUniqueOrThrow({ where: { id: transfer.id } });
    expect(failed).toMatchObject({ status: 'FAILED', failureCode: 'RECIPIENT_BLOCKED' });
    expect(await walletBalance(sender.walletId)).toBe(200_000n);
  });

  it('answers 404 for an unknown provider and 400 for a signed but malformed body', async () => {
    const secret = await signingSecret();
    const body = JSON.stringify({ eventId: 'x', status: 'SUCCESS' });
    expect((await post('no-such-provider', body, signWebhookPayload(secret, body))).status).toBe(
      404,
    );
    expect((await post('../etc/passwd', body, signWebhookPayload(secret, body))).status).toBe(404);
    const notJson = 'status=SUCCESS';
    expect((await post(PROVIDER, notJson, signWebhookPayload(secret, notJson))).status).toBe(400);
    const wrongShape = JSON.stringify({ eventId: 'evt', status: 'MAYBE' });
    expect((await post(PROVIDER, wrongShape, signWebhookPayload(secret, wrongShape))).status).toBe(
      400,
    );
  });

  it('refuses every webhook for a provider that has no secret configured', async () => {
    const body = JSON.stringify({
      eventId: idem('evt'),
      status: 'SUCCESS',
      reference: 'BRNOPE000000',
    });
    const response = await post(
      'orange-money-cm',
      body,
      signWebhookPayload('whsec_guess_guess_guess', body),
    );
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Outbound: signed partner webhooks, delivery log, retry
// ---------------------------------------------------------------------------

describe('outbound partner webhooks', () => {
  interface Received {
    signature: string | undefined;
    event: string | undefined;
    delivery: string | undefined;
    rawBody: string;
  }
  const received: Received[] = [];
  let failing = false;
  let server: Server;
  let url = '';

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({
          signature: request.headers[WEBHOOK_SIGNATURE_HEADER] as string | undefined,
          event: request.headers['x-birem-event'] as string | undefined,
          delivery: request.headers['x-birem-delivery'] as string | undefined,
          rawBody: Buffer.concat(chunks).toString('utf8'),
        });
        response.statusCode = failing ? 503 : 204;
        response.end(failing ? 'down for maintenance' : undefined);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('shows the signing secret once and stores it encrypted', async () => {
    const partner = await createPartner({ type: 'PARTNER' });
    const { endpoint, secret } = await createWebhookEndpoint(partner.ctx, {
      url,
      events: ['transfer.completed'],
    });
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{20,}$/);
    expect(endpoint).not.toHaveProperty('secretEnc');
    const row = await db.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
    expect(row.secretEnc).not.toContain(secret);
    expect(JSON.stringify(await listWebhookEndpoints(partner.ctx))).not.toContain(secret);
    expect(
      JSON.stringify(await db.auditLog.findMany({ where: { resourceId: endpoint.id } })),
    ).not.toContain(secret);
  });

  it('delivers a signed event when a transfer completes, and logs the delivery', async () => {
    const partner = await createPartner({ type: 'PARTNER', balance: 90_000n });
    const customer = await createCustomer();
    const { endpoint, secret } = await createWebhookEndpoint(partner.ctx, {
      url,
      events: ['transfer.completed', 'transfer.failed'],
    });
    received.length = 0;
    const { transfer } = await createTransfer(partner.ctx, {
      senderWalletId: partner.walletId,
      recipient: { kind: 'WALLET', identifier: customer.phone },
      amount: 12_000n,
      idempotencyKey: idem('hook'),
    });

    expect(received).toHaveLength(1);
    const [delivery] = received;
    expect(delivery?.event).toBe('transfer.completed');
    expect(verifyWebhookSignature(secret, delivery?.rawBody ?? '', delivery?.signature).ok).toBe(
      true,
    );
    expect(
      verifyWebhookSignature(
        'whsec_someone_elses_secret',
        delivery?.rawBody ?? '',
        delivery?.signature,
      ).ok,
    ).toBe(false);
    const payload = JSON.parse(delivery?.rawBody ?? '{}') as {
      id: string;
      type: string;
      data: { reference: string; status: string; sendAmount: string };
    };
    expect(payload).toMatchObject({
      type: 'transfer.completed',
      data: { reference: transfer.reference, status: 'COMPLETED', sendAmount: '12000' },
    });

    const log = await listWebhookDeliveries(partner.ctx, { endpointId: endpoint.id });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      id: delivery?.delivery,
      eventId: payload.id,
      eventType: 'transfer.completed',
      status: 'DELIVERED',
      responseStatus: 204,
      attempts: 1,
      signature: delivery?.signature,
    });
  });

  it('does not send events the endpoint did not subscribe to', async () => {
    const partner = await createPartner({ type: 'MERCHANT' });
    await createWebhookEndpoint(partner.ctx, { url, events: ['settlement.paid'] });
    received.length = 0;
    expect(await dispatchPartnerEvent(partner.id, 'payment.received', { reference: 'BRX' })).toBe(
      0,
    );
    expect(received).toHaveLength(0);
  });

  it('logs a failed delivery and lets the partner retry it with a fresh signature', async () => {
    const partner = await createPartner({ type: 'PARTNER' });
    const { endpoint, secret } = await createWebhookEndpoint(partner.ctx, {
      url,
      events: ['transfer.completed'],
    });
    received.length = 0;
    failing = true;
    const failed = await sendTestWebhook(partner.ctx, endpoint.id);
    failing = false;
    expect(failed).toMatchObject({ status: 'FAILED', responseStatus: 503, error: 'HTTP 503' });
    expect(failed.deliveredAt).toBeNull();

    const retried = await redeliverWebhook(partner.ctx, failed.id);
    expect(retried).toMatchObject({
      status: 'DELIVERED',
      eventId: failed.eventId,
      eventType: 'webhook.test',
    });
    expect(retried.id).not.toBe(failed.id);
    expect(received).toHaveLength(2);
    // Same event (the stored JSON may come back with its keys in another order).
    expect(JSON.parse(received[1]?.rawBody ?? '{}')).toEqual(
      JSON.parse(received[0]?.rawBody ?? '{}'),
    );
    expect(
      verifyWebhookSignature(secret, received[1]?.rawBody ?? '', received[1]?.signature).ok,
    ).toBe(true);

    const log = await listWebhookDeliveries(partner.ctx, { endpointId: endpoint.id });
    expect(log.map((row) => row.status).sort()).toEqual(['DELIVERED', 'FAILED']);
  });

  it('records an unreachable endpoint as failed without throwing into the transfer', async () => {
    const partner = await createPartner({ type: 'PARTNER', balance: 30_000n });
    const customer = await createCustomer();
    const { endpoint } = await createWebhookEndpoint(partner.ctx, {
      url: 'http://127.0.0.1:9/closed-port',
      events: ['transfer.completed'],
    });
    const { transfer } = await createTransfer(partner.ctx, {
      senderWalletId: partner.walletId,
      recipient: { kind: 'WALLET', identifier: customer.phone },
      amount: 5_000n,
      idempotencyKey: idem('down'),
    });
    expect(transfer.status).toBe('COMPLETED');
    const log = await listWebhookDeliveries(partner.ctx, { endpointId: endpoint.id });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ status: 'FAILED', responseStatus: null });
    expect(log[0]?.error).toBeTruthy();
  });

  it('keeps endpoints and deliveries private to their partner', async () => {
    const owner = await createPartner({ type: 'PARTNER' });
    const intruder = await createPartner({ type: 'PARTNER' });
    const { endpoint } = await createWebhookEndpoint(owner.ctx, {
      url,
      events: ['transfer.completed'],
    });
    const delivery = await sendTestWebhook(owner.ctx, endpoint.id);

    expect(await listWebhookEndpoints(intruder.ctx)).toEqual([]);
    expect(await listWebhookDeliveries(intruder.ctx)).toEqual([]);
    await expect(sendTestWebhook(intruder.ctx, endpoint.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(redeliverWebhook(intruder.ctx, delivery.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(deleteWebhookEndpoint(intruder.ctx, endpoint.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await listWebhookEndpoints(owner.ctx)).toHaveLength(1);
  });

  it('refuses malformed endpoint URLs and URLs carrying credentials', async () => {
    const partner = await createPartner({ type: 'PARTNER' });
    for (const bad of [
      'not a url',
      'ftp://example.com/hook',
      'https://user:pass@example.com/hook',
    ]) {
      await expect(
        createWebhookEndpoint(partner.ctx, { url: bad, events: ['transfer.completed'] }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });
});
