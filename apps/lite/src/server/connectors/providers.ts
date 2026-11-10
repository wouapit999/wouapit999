import { z } from 'zod';

import { writeAudit } from '../audit';
import { encryptSecret, randomToken } from '../crypto';
import { type Prisma, type Tx, db } from '../db';
import { getEnv } from '../env';
import { AppError, isUniqueViolation } from '../errors';
import { isCurrencyCode } from '../money';
import { parseOutboundUrl } from '../net-guard';
import { type ActionContext, actorUserId, assertPermission } from '../rbac';
import { getConnectorForProvider, isKnownAdapter } from './registry';
import { ConnectorTimeoutError } from './types';

/**
 * Connectivity management (phase 3): the provider directory, encrypted credentials with
 * versioned rotation, webhook secrets, connectivity tests and health history.
 *
 * Secrets are write-only: they are encrypted before they reach the database and no function in
 * this module ever returns a plaintext or ciphertext — only version numbers, hints and dates.
 * The single exception is a freshly generated webhook secret, returned once to be copied.
 */

export interface ProviderView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly operator: string;
  readonly countryCode: string;
  readonly currency: string;
  readonly adapter: string;
  readonly environment: 'SANDBOX' | 'PRODUCTION';
  readonly baseUrl: string | null;
  readonly callbackUrl: string | null;
  readonly config: Prisma.JsonValue;
  readonly status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
  readonly healthStatus: 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'DOWN';
  readonly lastHealthCheckAt: Date | null;
  readonly lastLatencyMs: number | null;
  readonly supportsPayout: boolean;
  readonly supportsCollection: boolean;
  readonly hasCredentials: boolean;
  readonly credentialsVersion: number;
  readonly hasWebhookSecret: boolean;
  readonly webhookSecretVersion: number;
  /** True when the adapter never contacts a real operator. */
  readonly simulated: boolean;
  /** Path of the inbound webhook endpoint for this provider. */
  readonly webhookPath: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

type ProviderRow = Awaited<ReturnType<typeof db.provider.findFirstOrThrow>>;

const toView = (provider: ProviderRow): ProviderView => ({
  id: provider.id,
  code: provider.code,
  name: provider.name,
  operator: provider.operator,
  countryCode: provider.countryCode,
  currency: provider.currency,
  adapter: provider.adapter,
  environment: provider.environment,
  baseUrl: provider.baseUrl,
  callbackUrl: provider.callbackUrl,
  config: provider.config,
  status: provider.status,
  healthStatus: provider.healthStatus,
  lastHealthCheckAt: provider.lastHealthCheckAt,
  lastLatencyMs: provider.lastLatencyMs,
  supportsPayout: provider.supportsPayout,
  supportsCollection: provider.supportsCollection,
  hasCredentials: provider.credentialsVersion > 0,
  credentialsVersion: provider.credentialsVersion,
  hasWebhookSecret: provider.webhookSecretVersion > 0,
  webhookSecretVersion: provider.webhookSecretVersion,
  simulated: provider.adapter === 'simulator',
  webhookPath: `/api/webhooks/providers/${provider.code}`,
  createdAt: provider.createdAt,
  updatedAt: provider.updatedAt,
});

/** Provider directory for the back office. Requires `providers:read`. */
export async function listProviders(
  ctx: ActionContext,
  filter: { countryCode?: string; status?: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' } = {},
): Promise<ProviderView[]> {
  assertPermission(ctx, 'providers:read');
  const providers = await db.provider.findMany({
    where: {
      ...(filter.countryCode ? { countryCode: filter.countryCode } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: [{ countryCode: 'asc' }, { name: 'asc' }],
  });
  return providers.map(toView);
}

export async function getProvider(ctx: ActionContext, id: string): Promise<ProviderView> {
  assertPermission(ctx, 'providers:read');
  const provider = await db.provider.findUnique({ where: { id } });
  if (!provider) throw new AppError('NOT_FOUND', 'Provider not found');
  return toView(provider);
}

export interface PayoutProviderOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly operator: string;
  readonly countryCode: string;
  readonly currency: string;
  readonly simulated: boolean;
  readonly supportsPayout: boolean;
  readonly supportsCollection: boolean;
}

/**
 * ACTIVE providers of enabled countries — what customers and partners can pick as a payout or
 * cash-in channel. No permission needed (public catalogue, no configuration details).
 */
export async function listAvailableProviders(
  filter: { countryCode?: string; currency?: string } = {},
): Promise<PayoutProviderOption[]> {
  const providers = await db.provider.findMany({
    where: {
      status: 'ACTIVE',
      country: { enabled: true },
      ...(filter.countryCode ? { countryCode: filter.countryCode } : {}),
      ...(filter.currency ? { currency: filter.currency } : {}),
    },
    orderBy: [{ countryCode: 'asc' }, { name: 'asc' }],
  });
  return providers.map((provider) => ({
    id: provider.id,
    code: provider.code,
    name: provider.name,
    operator: provider.operator,
    countryCode: provider.countryCode,
    currency: provider.currency,
    simulated: provider.adapter === 'simulator',
    supportsPayout: provider.supportsPayout,
    supportsCollection: provider.supportsCollection,
  }));
}

const urlField = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => (value ? value : undefined));

export const providerSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,40}$/, 'Lowercase letters, digits and dashes (3–41 characters)'),
  name: z.string().trim().min(2).max(120),
  operator: z.string().trim().min(2).max(120),
  countryCode: z.string().trim().toUpperCase().length(2),
  currency: z.string().trim().toUpperCase().refine(isCurrencyCode, 'Unsupported currency'),
  adapter: z.string().trim().refine(isKnownAdapter, 'Unknown adapter'),
  environment: z.enum(['SANDBOX', 'PRODUCTION']),
  baseUrl: urlField,
  callbackUrl: urlField,
  /** Non-secret adapter configuration as a JSON object. */
  config: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']).default('ACTIVE'),
  supportsPayout: z.boolean().default(true),
  supportsCollection: z.boolean().default(true),
});
export type ProviderInput = z.input<typeof providerSchema>;

function validateProviderShape(data: z.output<typeof providerSchema>): void {
  if (data.baseUrl) parseOutboundUrl(data.baseUrl);
  if (data.callbackUrl) parseOutboundUrl(data.callbackUrl);
  if (data.adapter === 'http' && !data.baseUrl) {
    throw new AppError('VALIDATION', 'The HTTP adapter needs a base URL', {
      fieldErrors: { baseUrl: ['Required for the HTTP adapter'] },
    });
  }
  if (data.environment === 'PRODUCTION' && data.adapter === 'simulator') {
    throw new AppError('VALIDATION', 'The simulator cannot be used in the production environment', {
      fieldErrors: { adapter: ['Choose a real adapter for production'] },
    });
  }
}

const auditable = (provider: ProviderRow) => ({
  code: provider.code,
  name: provider.name,
  operator: provider.operator,
  countryCode: provider.countryCode,
  currency: provider.currency,
  adapter: provider.adapter,
  environment: provider.environment,
  baseUrl: provider.baseUrl,
  callbackUrl: provider.callbackUrl,
  status: provider.status,
  supportsPayout: provider.supportsPayout,
  supportsCollection: provider.supportsCollection,
});

/** Adds a provider — "adding a provider = one database row". Requires `providers:write`. */
export async function createProvider(
  ctx: ActionContext,
  input: ProviderInput,
): Promise<ProviderView> {
  assertPermission(ctx, 'providers:write');
  const data = providerSchema.parse(input);
  validateProviderShape(data);
  const country = await db.country.findUnique({ where: { code: data.countryCode } });
  if (!country) {
    throw new AppError('VALIDATION', 'Unknown country', {
      fieldErrors: { countryCode: ['Unknown country'] },
    });
  }
  try {
    return await db.$transaction(async (tx) => {
      const provider = await tx.provider.create({
        data: { ...data, config: (data.config ?? {}) as Prisma.InputJsonValue },
      });
      await writeAudit(tx, ctx, {
        action: 'provider.create',
        resourceType: 'provider',
        resourceId: provider.id,
        after: auditable(provider),
      });
      return toView(provider);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('CONFLICT', 'A provider with this code already exists', {
        fieldErrors: { code: ['Already in use'] },
      });
    }
    throw error;
  }
}

/** Updates non-secret provider settings. `code` cannot change. Requires `providers:write`. */
export async function updateProvider(
  ctx: ActionContext,
  id: string,
  input: Omit<ProviderInput, 'code'>,
): Promise<ProviderView> {
  assertPermission(ctx, 'providers:write');
  return db.$transaction(async (tx) => {
    const before = await tx.provider.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Provider not found');
    const data = providerSchema.parse({ ...input, code: before.code });
    validateProviderShape(data);
    const { code: _code, ...values } = data;
    const after = await tx.provider.update({
      where: { id },
      data: { ...values, config: (data.config ?? {}) as Prisma.InputJsonValue },
    });
    await writeAudit(tx, ctx, {
      action: 'provider.update',
      resourceType: 'provider',
      resourceId: id,
      before: auditable(before),
      after: auditable(after),
    });
    return toView(after);
  });
}

export async function setProviderStatus(
  ctx: ActionContext,
  id: string,
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE',
): Promise<ProviderView> {
  assertPermission(ctx, 'providers:write');
  return db.$transaction(async (tx) => {
    const before = await tx.provider.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Provider not found');
    const after = await tx.provider.update({ where: { id }, data: { status } });
    await writeAudit(tx, ctx, {
      action: 'provider.status',
      resourceType: 'provider',
      resourceId: id,
      before: { status: before.status },
      after: { status },
    });
    return toView(after);
  });
}

// ---------------------------------------------------------------------------
// Secrets — write-only, versioned
// ---------------------------------------------------------------------------

async function rotateSecret(
  tx: Tx,
  ctx: ActionContext,
  providerId: string,
  kind: 'CREDENTIALS' | 'WEBHOOK_SECRET',
  plaintext: string,
  hint: string,
): Promise<number> {
  // Serialise rotations of the same provider.
  await tx.$queryRaw`SELECT id FROM providers WHERE id = ${providerId}::uuid FOR UPDATE`;
  const provider = await tx.provider.findUnique({ where: { id: providerId } });
  if (!provider) throw new AppError('NOT_FOUND', 'Provider not found');
  const current =
    kind === 'CREDENTIALS' ? provider.credentialsVersion : provider.webhookSecretVersion;
  const version = current + 1;
  const now = new Date();
  await tx.providerSecret.updateMany({
    where: { providerId, kind, retiredAt: null },
    data: { retiredAt: now },
  });
  await tx.providerSecret.create({
    data: {
      providerId,
      kind,
      version,
      ciphertext: encryptSecret(plaintext),
      keyVersion: getEnv().encryptionKeyVersion,
      hint,
      createdById: actorUserId(ctx),
    },
  });
  await tx.provider.update({
    where: { id: providerId },
    data:
      kind === 'CREDENTIALS' ? { credentialsVersion: version } : { webhookSecretVersion: version },
  });
  await writeAudit(tx, ctx, {
    action:
      kind === 'CREDENTIALS' ? 'provider.credentials.rotate' : 'provider.webhook_secret.rotate',
    resourceType: 'provider',
    resourceId: providerId,
    // Only the version and the hint — never the value.
    metadata: { version, previousVersion: current, hint },
  });
  return version;
}

export const credentialsSchema = z
  .record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,40}$/, 'Field names: letters, digits, underscore'),
    z.string().min(1).max(4000),
  )
  .refine((value) => Object.keys(value).length > 0, 'Enter at least one credential field')
  .refine((value) => Object.keys(value).length <= 12, 'At most 12 credential fields');

/**
 * Stores new provider credentials (rotation): the previous version is retired and kept as
 * ciphertext history. Returns only the new version number. Requires `providers:write`.
 */
export async function setProviderCredentials(
  ctx: ActionContext,
  providerId: string,
  credentials: Record<string, string>,
): Promise<{ version: number }> {
  assertPermission(ctx, 'providers:write');
  const data = credentialsSchema.parse(credentials);
  const hint = `fields: ${Object.keys(data).sort().join(', ')}`;
  const version = await db.$transaction((tx) =>
    rotateSecret(tx, ctx, providerId, 'CREDENTIALS', JSON.stringify(data), hint),
  );
  return { version };
}

/**
 * Rotates the inbound webhook signing secret. Pass `secret` to store the operator's own secret,
 * or omit it to generate one — the generated value is returned ONCE and cannot be read again.
 * The previous secret keeps verifying for 24 hours.
 */
export async function rotateWebhookSecret(
  ctx: ActionContext,
  providerId: string,
  secret?: string,
): Promise<{ version: number; generatedSecret: string | null }> {
  assertPermission(ctx, 'providers:write');
  if (secret !== undefined && (secret.length < 16 || secret.length > 500)) {
    throw new AppError('VALIDATION', 'A webhook secret must be 16–500 characters');
  }
  const value = secret ?? `whsec_${randomToken(32)}`;
  const hint = `••••${value.slice(-4)}`;
  const version = await db.$transaction((tx) =>
    rotateSecret(tx, ctx, providerId, 'WEBHOOK_SECRET', value, hint),
  );
  return { version, generatedSecret: secret === undefined ? value : null };
}

/** Rotation history (metadata only — no ciphertext). Requires `providers:read`. */
export async function listProviderSecretVersions(ctx: ActionContext, providerId: string) {
  assertPermission(ctx, 'providers:read');
  return db.providerSecret.findMany({
    where: { providerId },
    orderBy: [{ kind: 'asc' }, { version: 'desc' }],
    select: {
      id: true,
      kind: true,
      version: true,
      keyVersion: true,
      hint: true,
      createdById: true,
      createdAt: true,
      retiredAt: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Connectivity test & health
// ---------------------------------------------------------------------------

export interface ConnectivityTestResult {
  readonly status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  readonly latencyMs: number;
  readonly message: string;
  readonly simulated: boolean;
  readonly checkedAt: Date;
}

const DEGRADED_LATENCY_MS = 2_000;

/**
 * Pings the provider through its connector and records the result in the health history.
 * Requires `providers:test`.
 */
export async function testProviderConnectivity(
  ctx: ActionContext,
  providerId: string,
): Promise<ConnectivityTestResult> {
  assertPermission(ctx, 'providers:test');
  const started = Date.now();
  let ok = false;
  let latencyMs = 0;
  let message: string;
  let simulated = false;
  try {
    const { connector } = await getConnectorForProvider(providerId, { allowInactive: true });
    simulated = connector.simulated;
    const ping = await connector.ping();
    ok = ping.ok;
    latencyMs = ping.latencyMs;
    message = ping.message;
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') throw error;
    latencyMs = Date.now() - started;
    message =
      error instanceof ConnectorTimeoutError
        ? 'Timed out'
        : error instanceof Error
          ? error.message
          : 'Connectivity test failed';
  }
  const status = !ok ? 'DOWN' : latencyMs > DEGRADED_LATENCY_MS ? 'DEGRADED' : 'HEALTHY';
  const checkedAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.providerHealthCheck.create({
      data: {
        providerId,
        status,
        latencyMs,
        message: message.slice(0, 500),
        checkedById: actorUserId(ctx),
        createdAt: checkedAt,
      },
    });
    await tx.provider.update({
      where: { id: providerId },
      data: { healthStatus: status, lastHealthCheckAt: checkedAt, lastLatencyMs: latencyMs },
    });
    await writeAudit(tx, ctx, {
      action: 'provider.connectivity_test',
      resourceType: 'provider',
      resourceId: providerId,
      outcome: ok ? 'SUCCESS' : 'FAILURE',
      metadata: { status, latencyMs },
    });
  });
  return { status, latencyMs, message, simulated, checkedAt };
}

export async function listProviderHealthChecks(ctx: ActionContext, providerId: string, limit = 50) {
  assertPermission(ctx, 'providers:read');
  return db.providerHealthCheck.findMany({
    where: { providerId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
}

/** Public health summary for the status page: name, country, status — no configuration. */
export async function getPublicProviderStatus() {
  const providers = await db.provider.findMany({
    where: { country: { enabled: true } },
    orderBy: [{ countryCode: 'asc' }, { name: 'asc' }],
    select: {
      code: true,
      name: true,
      countryCode: true,
      status: true,
      healthStatus: true,
      lastHealthCheckAt: true,
      adapter: true,
    },
  });
  return providers.map(({ adapter, ...provider }) => ({
    ...provider,
    simulated: adapter === 'simulator',
  }));
}
