import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '@/generated/prisma/client';

import { getEnv } from './env';

/**
 * Database access for BI-Rem Lite.
 *
 * One `PrismaClient` (pg driver adapter) per process, stored on `globalThis` so that Next.js hot
 * reloads and warm Vercel serverless invocations reuse the same small pool. Use the Neon *pooled*
 * URL at runtime; the pool here is deliberately small (default 5) because every serverless
 * instance owns its own.
 */

export type Db = PrismaClient;
/** Interactive-transaction client passed to every `tx`-taking service function. */
export type Tx = Prisma.TransactionClient;
/** Anything that can run queries: the root client or a transaction. */
export type DbOrTx = Db | Tx;

interface GlobalWithPrisma {
  __biremLitePrisma?: { url: string; client: PrismaClient };
}

const globalForPrisma = globalThis as unknown as GlobalWithPrisma;

const SSL_MODES_VERIFIED_BY_PG = new Set(['prefer', 'require', 'verify-ca']);

/**
 * Makes the TLS mode of a connection string explicit for the `pg` driver.
 *
 * Neon hands out URLs with `sslmode=require`. `pg` 8 treats `prefer`, `require` and `verify-ca`
 * as `verify-full` (certificate and host name are checked) and prints a warning on every cold
 * start that the next major version will stop doing so. Rewriting them to `verify-full` keeps
 * today's behaviour — the strict one — silences the warning and survives the `pg` upgrade.
 * A URL that opts into libpq semantics (`uselibpqcompat=true`) or has no `sslmode` (local
 * Postgres) is returned unchanged, as is anything that is not a parsable URL.
 */
export function withExplicitSslMode(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }
  const mode = url.searchParams.get('sslmode');
  if (!mode || !SSL_MODES_VERIFIED_BY_PG.has(mode)) return connectionString;
  if (url.searchParams.get('uselibpqcompat') === 'true') return connectionString;
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

function createClient(url: string): PrismaClient {
  const env = getEnv();
  const adapter = new PrismaPg({
    connectionString: withExplicitSslMode(url),
    max: env.databasePoolMax,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
  });
  return new PrismaClient({
    adapter,
    // Tests assert on rejected queries; keep their output quiet.
    log: env.nodeEnv === 'test' ? [] : ['warn', 'error'],
    // Transfers serialise on row locks; give queued transactions time instead of failing fast.
    transactionOptions: { maxWait: 15_000, timeout: 30_000 },
  });
}

function getClient(): PrismaClient {
  const url = getEnv().databaseUrl;
  const existing = globalForPrisma.__biremLitePrisma;
  if (existing?.url === url) return existing.client;
  const client = createClient(url);
  globalForPrisma.__biremLitePrisma = { url, client };
  return client;
}

/**
 * Lazy singleton: the client is only created on first property access, so importing this module
 * never requires `DATABASE_URL` (important for `next build` and unit tests).
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value: unknown = Reflect.get(client, property, client);
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
});

/** Closes the pool (tests, seed script). The next access creates a fresh client. */
export async function disconnectDb(): Promise<void> {
  const existing = globalForPrisma.__biremLitePrisma;
  if (existing) {
    globalForPrisma.__biremLitePrisma = undefined;
    await existing.client.$disconnect();
  }
}

const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

function isRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  if (candidate.code === 'P2034') return true;
  if (typeof candidate.code === 'string' && RETRYABLE_SQLSTATES.has(candidate.code)) return true;
  if (typeof candidate.meta?.code === 'string' && RETRYABLE_SQLSTATES.has(candidate.meta.code)) {
    return true;
  }
  return (
    typeof candidate.message === 'string' &&
    /deadlock detected|could not serialize access/i.test(candidate.message)
  );
}

/**
 * Runs `fn` in one interactive transaction (READ COMMITTED + explicit row locks). Deadlocks and
 * serialisation failures are retried a few times; everything else propagates and rolls back.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await db.$transaction(fn);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
  throw lastError;
}

export { Prisma };
