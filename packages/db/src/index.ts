/**
 * @bi-rem/db — public entry point.
 *
 * Re-exports the generated Prisma client (types, enums, `Prisma` namespace), the RBAC
 * catalogue and a `createPrismaClient` factory wired to the `pg` driver adapter, which is
 * mandatory in Prisma 7 and works for local Postgres as well as Neon.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';

import { PrismaClient } from '../generated/client/client.js';
import type { Prisma } from '../generated/client/client.js';

export * from '../generated/client/client.js';
export * from './permissions.js';

/** Thrown when no database URL can be resolved from arguments or the environment. */
export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigurationError';
  }
}

export interface CreatePrismaClientOptions {
  /**
   * Maximum number of pooled connections. Keep this low (≤ 10) when connecting to a Neon
   * pooled endpoint or running many serverless instances. Defaults to `pg`'s 10.
   */
  readonly maxConnections?: number;
  /** Milliseconds a connection may sit idle before being closed. Defaults to 30 000. */
  readonly idleTimeoutMs?: number;
  /** Milliseconds to wait for a connection before failing. Defaults to 10 000. */
  readonly connectionTimeoutMs?: number;
  /** Prisma log configuration. Defaults to `['warn', 'error']`. */
  readonly log?: ReadonlyArray<Prisma.LogLevel | Prisma.LogDefinition>;
  /** Extra `pg` pool settings (SSL, application_name…) merged after the defaults. */
  readonly pool?: Omit<PoolConfig, 'connectionString' | 'max'>;
}

export interface ResolvedDatabaseUrl {
  /** Connection string with the Prisma-only `schema` query parameter removed. */
  readonly connectionString: string;
  /** Postgres schema to use as `search_path` (from `?schema=`), if any. */
  readonly schema: string | undefined;
}

/**
 * Splits the `?schema=` parameter Prisma 6 URLs commonly carry from the connection string,
 * because the `pg` driver does not understand it and the adapter takes it as an option.
 */
export function resolveDatabaseUrl(databaseUrl: string): ResolvedDatabaseUrl {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new DatabaseConfigurationError('DATABASE_URL is not a valid URL');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new DatabaseConfigurationError(
      `DATABASE_URL must use the postgresql:// scheme (got ${parsed.protocol})`,
    );
  }
  const schema = parsed.searchParams.get('schema') ?? undefined;
  parsed.searchParams.delete('schema');
  return { connectionString: parsed.toString(), schema };
}

/**
 * Creates a `PrismaClient` backed by a `pg` pool.
 *
 * @param databaseUrl Connection string; falls back to `process.env.DATABASE_URL`.
 *                    Pass the Neon *pooled* URL at runtime and keep the direct URL for migrations.
 */
export function createPrismaClient(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
  options: CreatePrismaClientOptions = {},
): PrismaClient {
  if (!databaseUrl) {
    throw new DatabaseConfigurationError(
      'No database URL provided: pass one to createPrismaClient() or set DATABASE_URL',
    );
  }
  const { connectionString, schema } = resolveDatabaseUrl(databaseUrl);

  const poolConfig: PoolConfig = {
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 10_000,
    ...options.pool,
    connectionString,
    max: options.maxConnections ?? 10,
  };

  const adapter = new PrismaPg(poolConfig, schema ? { schema } : undefined);

  return new PrismaClient({
    adapter,
    log: [...(options.log ?? ['warn', 'error'])],
  });
}

/** Convenience alias for the concrete client type used across the monorepo. */
export type DbClient = PrismaClient;
