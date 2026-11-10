'use server';

import { z } from 'zod';

import { checkbox } from '@/components/admin/helpers';
import { createAction } from '@/lib/server-action';
import {
  createProvider,
  rotateWebhookSecret,
  setProviderCredentials,
  setProviderStatus,
  testProviderConnectivity,
  updateProvider,
} from '@/server/connectors';
import { AppError } from '@/server/errors';

/**
 * Provider administration. Secrets only ever travel browser → server: credential values and
 * webhook secrets are encrypted by the service and are never echoed back, logged or audited
 * (the one exception is a freshly generated webhook secret, returned once to be copied).
 */

/** Non-secret adapter configuration typed as JSON text. */
const configField = z
  .string()
  .max(4000)
  .optional()
  .transform((text, context) => {
    if (!text) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to the issue below
    }
    context.addIssue({ code: 'custom', message: 'Enter a JSON object, e.g. {"timeoutMs": 8000}' });
    return z.NEVER;
  });

// The service's `providerSchema` is the authority; this only shapes the form.
const providerFields = {
  name: z.string().max(200).default(''),
  operator: z.string().max(200).default(''),
  countryCode: z.string().max(10).default(''),
  currency: z.string().max(10).default(''),
  adapter: z.string().max(40).default(''),
  environment: z.enum(['SANDBOX', 'PRODUCTION'], 'Choose an environment'),
  baseUrl: z.string().max(500).optional(),
  callbackUrl: z.string().max(500).optional(),
  config: configField,
  status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']).default('INACTIVE'),
  supportsPayout: checkbox,
  supportsCollection: checkbox,
};

export const createProviderAction = createAction({
  schema: z.object({ code: z.string().max(60).default(''), ...providerFields }),
  permission: 'providers:write',
  handler: async (input, ctx) => {
    const provider = await createProvider(ctx, input);
    return { id: provider.id };
  },
  revalidate: ['/admin/providers'],
  redirectTo: (result) => `/admin/providers/${result.id}?created=1`,
});

export const updateProviderAction = createAction({
  schema: z.object({ providerId: z.uuid(), ...providerFields }),
  permission: 'providers:write',
  handler: async ({ providerId, ...input }, ctx) => {
    const provider = await updateProvider(ctx, providerId, input);
    return { id: provider.id };
  },
  successMessage: 'Provider settings saved',
  revalidate: (result) => ['/admin/providers', `/admin/providers/${result.id}`],
});

export const setProviderStatusAction = createAction({
  schema: z.object({
    providerId: z.uuid(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']),
  }),
  permission: 'providers:write',
  handler: async (input, ctx) => {
    const provider = await setProviderStatus(ctx, input.providerId, input.status);
    return { id: provider.id, status: provider.status };
  },
  revalidate: (result) => ['/admin/providers', `/admin/providers/${result.id}`, '/status'],
  // The clicked button is replaced by its opposite, so confirm on the reloaded page.
  redirectTo: (result) =>
    `/admin/providers/${result.id}?notice=provider-${result.status.toLowerCase()}`,
});

/**
 * Stores a new credentials version. Field names and values are read pairwise from the raw
 * form so an empty row never shifts a value onto the wrong name.
 */
export const setProviderCredentialsAction = createAction({
  schema: z.object({ providerId: z.uuid() }),
  permission: 'providers:write',
  handler: async (input, ctx, formData) => {
    const names = formData.getAll('credentialName[]');
    const values = formData.getAll('credentialValue[]');
    const credentials: Record<string, string> = {};
    names.forEach((rawName, index) => {
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      const value = values[index];
      if (name === '' && (typeof value !== 'string' || value === '')) return;
      if (name === '' || typeof value !== 'string' || value === '') {
        throw new AppError('VALIDATION', 'Every credential needs both a field name and a value');
      }
      if (Object.hasOwn(credentials, name)) {
        throw new AppError('VALIDATION', `The field "${name}" is entered twice`);
      }
      credentials[name] = value;
    });
    const { version } = await setProviderCredentials(ctx, input.providerId, credentials);
    return { id: input.providerId, version };
  },
  successMessage: (result) =>
    `Credentials stored as version ${result.version}. They cannot be displayed again.`,
  revalidate: (result) => ['/admin/providers', `/admin/providers/${result.id}`],
});

export const rotateWebhookSecretAction = createAction({
  schema: z
    .object({
      providerId: z.uuid(),
      mode: z.enum(['GENERATE', 'CUSTOM']),
      webhookSecret: z.string().max(500).optional(),
    })
    .refine((value) => value.mode === 'GENERATE' || Boolean(value.webhookSecret), {
      message: "Paste the operator's signing secret",
      path: ['webhookSecret'],
    }),
  permission: 'providers:write',
  handler: async (input, ctx) => {
    const { version, generatedSecret } = await rotateWebhookSecret(
      ctx,
      input.providerId,
      input.mode === 'CUSTOM' ? input.webhookSecret : undefined,
    );
    return { id: input.providerId, version, generatedSecret };
  },
  successMessage: (result) => `Webhook secret rotated to version ${result.version}`,
  revalidate: (result) => [`/admin/providers/${result.id}`],
});

export const testProviderConnectivityAction = createAction({
  schema: z.object({ providerId: z.uuid() }),
  permission: 'providers:test',
  handler: async (input, ctx) => {
    const result = await testProviderConnectivity(ctx, input.providerId);
    return {
      id: input.providerId,
      status: result.status,
      latencyMs: result.latencyMs,
      message: result.message,
      simulated: result.simulated,
      checkedAt: result.checkedAt.toISOString(),
    };
  },
  revalidate: (result) => ['/admin/providers', `/admin/providers/${result.id}`, '/status'],
});
