'use server';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import { AppError } from '@/server/errors';
import { markAllNotificationsRead } from '@/server/notifications';
import {
  API_KEY_SCOPES,
  PARTNER_EVENT_TYPES,
  createApiKey,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getPartner,
  redeliverWebhook,
  revokeApiKey,
  sendTestWebhook,
  setWebhookEndpointActive,
} from '@/server/partners';
import type { ActionContext } from '@/server/rbac';
import { refreshTransferStatus } from '@/server/transfers';

import { CASH_IN_KEY_PATTERN, executeCashIn, planCashIn } from './_lib/cash-in';

/**
 * Server actions of the partner portal. Each one authenticates from the session, requires role
 * PARTNER and calls a service that scopes to the actor's own partner and writes the audit row —
 * no partner id is ever read from the form. Schemas are module-private (a `'use server'` file
 * may only export async functions).
 */

const ROLES = ['PARTNER'] as const;

/** The actor's own partner, which must be ACTIVE to change integrations or move money. */
async function requireActivePartner(ctx: ActionContext) {
  const partner = await getPartner(ctx);
  if (partner.status !== 'ACTIVE') {
    throw new AppError('INVALID_STATE', 'This is available once your partner account is active');
  }
  return partner;
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export const createApiKeyAction = createAction({
  schema: z.object({
    name: z.string().trim().min(2, 'Name the key').max(80),
    scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, 'Choose at least one scope').prefault([]),
  }),
  roles: ROLES,
  handler: async (input, ctx) => {
    const { apiKey, secret } = await createApiKey(ctx, input);
    // `secret` is the only time the full key exists outside the caller's browser.
    return { id: apiKey.id, name: apiKey.name, prefix: apiKey.prefix, secret };
  },
  revalidate: ['/partner/api-keys', '/partner'],
});

export const revokeApiKeyAction = createAction({
  schema: z.object({ id: z.uuid() }),
  roles: ROLES,
  handler: (input, ctx) => revokeApiKey(ctx, input.id),
  successMessage: 'API key revoked',
  revalidate: ['/partner/api-keys', '/partner'],
});

// ---------------------------------------------------------------------------
// Webhook endpoints and deliveries
// ---------------------------------------------------------------------------

export const createWebhookEndpointAction = createAction({
  schema: z.object({
    url: z.string().trim().min(8, 'Enter the endpoint URL').max(500),
    description: z.string().trim().max(200).optional(),
    events: z.array(z.enum(PARTNER_EVENT_TYPES)).min(1, 'Choose at least one event').prefault([]),
  }),
  roles: ROLES,
  handler: async (input, ctx) => {
    await requireActivePartner(ctx);
    const { endpoint, secret } = await createWebhookEndpoint(ctx, input);
    return { id: endpoint.id, url: endpoint.url, secret };
  },
  revalidate: ['/partner/webhooks', '/partner'],
});

export const setWebhookEndpointActiveAction = createAction({
  schema: z.object({ id: z.uuid(), active: z.enum(['true', 'false']) }),
  roles: ROLES,
  handler: async (input, ctx) => {
    await setWebhookEndpointActive(ctx, input.id, input.active === 'true');
  },
  revalidate: ['/partner/webhooks', '/partner'],
});

export const deleteWebhookEndpointAction = createAction({
  schema: z.object({ id: z.uuid() }),
  roles: ROLES,
  handler: (input, ctx) => deleteWebhookEndpoint(ctx, input.id),
  successMessage: 'Endpoint deleted',
  revalidate: ['/partner/webhooks', '/partner'],
});

const deliveryOutcome = (delivery: {
  status: string;
  responseStatus: number | null;
  error: string | null;
}): { delivered: boolean; message: string } =>
  delivery.status === 'DELIVERED'
    ? { delivered: true, message: `Delivered (HTTP ${delivery.responseStatus ?? 200})` }
    : { delivered: false, message: `Not delivered: ${delivery.error ?? 'unknown error'}` };

/** Sends a `webhook.test` event. A failed delivery is a result (it is logged), not an error. */
export const sendTestWebhookAction = createAction({
  schema: z.object({ id: z.uuid() }),
  roles: ROLES,
  handler: async (input, ctx) => {
    await requireActivePartner(ctx);
    return deliveryOutcome(await sendTestWebhook(ctx, input.id));
  },
  revalidate: ['/partner/webhooks'],
});

/** Retries a logged delivery: same payload, fresh signature, new row in the log. */
export const redeliverWebhookAction = createAction({
  schema: z.object({ deliveryId: z.uuid() }),
  roles: ROLES,
  handler: async (input, ctx) => {
    await requireActivePartner(ctx);
    return deliveryOutcome(await redeliverWebhook(ctx, input.deliveryId));
  },
  revalidate: ['/partner/webhooks'],
});

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export const refreshTransferAction = createAction({
  schema: z.object({ id: z.uuid() }),
  roles: ROLES,
  handler: async (input, ctx) => {
    const transfer = await refreshTransferStatus(ctx, input.id);
    return transfer.status;
  },
  successMessage: (status) =>
    status === 'PROCESSING' ? 'Still processing at the provider' : 'Status updated',
  revalidate: ['/partner/transactions', '/partner'],
});

// ---------------------------------------------------------------------------
// Agent cash-in (float → customer wallet, through the transfer engine)
// ---------------------------------------------------------------------------

const cashInFields = {
  customer: z.string().trim().min(3, 'Enter the customer’s phone number or e-mail').max(254),
  amount: z.string().trim().min(1, 'Enter the amount').max(24),
};

/** Step 1: who will be credited and what it costs. Nothing moves. */
export const previewCashInAction = createAction({
  schema: z.object(cashInFields),
  roles: ROLES,
  handler: async (input, ctx) => {
    const { float, preview } = await planCashIn(ctx, input);
    return {
      customer: input.customer,
      amountText: input.amount,
      customerName: preview.plan.recipient.name,
      customerAccount: preview.plan.recipient.account,
      currency: float.currency,
      amount: preview.pricing.sendAmount.toString(),
      fee: preview.pricing.feeAmount.toString(),
      totalDebit: preview.pricing.totalDebit.toString(),
      floatBalance: float.balance.toString(),
      sufficient: float.balance >= preview.pricing.totalDebit,
      // Minted once per preview: confirming twice (double click, retry) can only pay once.
      idempotencyKey: `cashin-${crypto.randomUUID()}`,
    };
  },
});

/** Step 2: the cash is in the agent's hand — credit the customer from the float. */
export const confirmCashInAction = createAction({
  schema: z.object({
    ...cashInFields,
    idempotencyKey: z.string().regex(CASH_IN_KEY_PATTERN, 'Review the cash-in again'),
  }),
  roles: ROLES,
  handler: async (input, ctx) => {
    const { transfer } = await executeCashIn(ctx, input);
    return {
      id: transfer.id,
      reference: transfer.reference,
      status: transfer.status,
      customerName: transfer.recipientName,
      currency: transfer.sourceCurrency,
      amount: transfer.receiveAmount.toString(),
      totalDebit: transfer.totalDebit.toString(),
    };
  },
  revalidate: ['/partner/float', '/partner', '/partner/transactions'],
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const markNotificationsReadAction = createAction({
  schema: z.object({}),
  roles: ROLES,
  handler: async (_input, ctx) => {
    await markAllNotificationsRead(ctx);
  },
  revalidate: ['/partner'],
});
