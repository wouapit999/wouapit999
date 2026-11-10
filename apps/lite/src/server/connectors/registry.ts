import { decryptSecret } from '../crypto';
import { type DbOrTx, db } from '../db';
import { AppError } from '../errors';
import { HttpConnector } from './http';
import { SimulatorConnector } from './simulator';
import type { ConnectorFactory, ProviderRuntime, WalletConnector } from './types';

/**
 * Adapter registry and provider runtime loader. The only place where encrypted provider
 * credentials are decrypted; the plaintext lives for the duration of one call and is never
 * logged, audited or returned to the UI.
 */

const adapters = new Map<string, ConnectorFactory>([
  ['simulator', (provider) => new SimulatorConnector(provider)],
  ['http', (provider) => new HttpConnector(provider)],
]);

/** Adapter keys an admin can choose from, with honest labels. */
export const ADAPTER_OPTIONS: ReadonlyArray<{ key: string; label: string; description: string }> = [
  {
    key: 'simulator',
    label: 'Simulator (sandbox)',
    description: 'Deterministic in-process simulator. No real operator is contacted.',
  },
  {
    key: 'http',
    label: 'Generic HTTP (production)',
    description:
      'Config-driven JSON connector for an operator gateway. Not yet tested against real operators.',
  },
];

/** Registers an additional adapter (tests, future operator-specific adapters). */
export function registerAdapter(key: string, factory: ConnectorFactory): void {
  adapters.set(key, factory);
}

export const isKnownAdapter = (key: string): boolean => adapters.has(key);

export function createConnector(provider: ProviderRuntime): WalletConnector {
  const factory = adapters.get(provider.adapter);
  if (!factory)
    throw new AppError('UNSUPPORTED', `No connector adapter named "${provider.adapter}"`);
  return factory(provider);
}

function parseCredentials(plaintext: string): Record<string, string> {
  const parsed: unknown = JSON.parse(plaintext);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** Loads a provider with its current credentials decrypted. Internal use only. */
export async function loadProviderRuntime(
  providerId: string,
  client: DbOrTx = db,
): Promise<ProviderRuntime> {
  const provider = await client.provider.findUnique({ where: { id: providerId } });
  if (!provider) throw new AppError('NOT_FOUND', 'Provider not found');
  let credentials: Record<string, string> | null = null;
  if (provider.credentialsVersion > 0) {
    const secret = await client.providerSecret.findUnique({
      where: {
        providerId_kind_version: {
          providerId,
          kind: 'CREDENTIALS',
          version: provider.credentialsVersion,
        },
      },
    });
    if (secret) credentials = parseCredentials(decryptSecret(secret.ciphertext));
  }
  return {
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
    config:
      typeof provider.config === 'object' &&
      provider.config !== null &&
      !Array.isArray(provider.config)
        ? provider.config
        : {},
    credentials,
  };
}

/** The connector for a provider row. Throws `UNSUPPORTED` when the provider is not ACTIVE. */
export async function getConnectorForProvider(
  providerId: string,
  options: { allowInactive?: boolean; client?: DbOrTx } = {},
): Promise<{ connector: WalletConnector; provider: ProviderRuntime }> {
  const client = options.client ?? db;
  const status = await client.provider.findUnique({
    where: { id: providerId },
    select: { status: true, name: true },
  });
  if (!status) throw new AppError('NOT_FOUND', 'Provider not found');
  if (status.status !== 'ACTIVE' && !options.allowInactive) {
    throw new AppError('UNSUPPORTED', `${status.name} is currently unavailable`);
  }
  const provider = await loadProviderRuntime(providerId, client);
  return { connector: createConnector(provider), provider };
}

/** Webhook secrets accepted for a provider: the current one plus the previous during 24 h. */
export async function loadWebhookSecrets(
  providerId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const graceStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = await db.providerSecret.findMany({
    where: {
      providerId,
      kind: 'WEBHOOK_SECRET',
      OR: [{ retiredAt: null }, { retiredAt: { gte: graceStart } }],
    },
    orderBy: { version: 'desc' },
    take: 2,
  });
  return rows.map((row) => decryptSecret(row.ciphertext));
}
