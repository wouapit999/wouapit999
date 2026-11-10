import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

/**
 * Low-level helpers for the integration-test databases. Every vitest run creates its own
 * template database (migrated + reference data) and every test file clones it, so runs and files
 * never share state and can execute in parallel — also alongside other people's runs.
 *
 * Which server: the first of `TEST_DATABASE_ADMIN_URL`, `TEST_DATABASE_URL`, `DATABASE_URL`,
 * else the local development default (`postgresql://birem:birem@localhost:5432/postgres`). The
 * URL only locates the server and the role: the suite creates and drops databases of its own
 * (`birem_lite_t_…`) and never reads or writes the database the URL names. The role must be
 * allowed to CREATE DATABASE.
 */

export const DEFAULT_ADMIN_URL = 'postgresql://birem:birem@localhost:5432/postgres';

/** Marker of the placeholder `DATABASE_URL` that `./setup.ts` gives unit tests. */
export const PLACEHOLDER_DATABASE = 'unit-tests';

const CONFIGURABLE = ['TEST_DATABASE_ADMIN_URL', 'TEST_DATABASE_URL', 'DATABASE_URL'] as const;

export interface AdminUrlSource {
  readonly url: string;
  /** The environment variable the URL came from; `null` for the built-in local default. */
  readonly variable: (typeof CONFIGURABLE)[number] | null;
}

/** Where the test databases live, and which setting said so. */
export function adminUrlSource(
  env: Record<string, string | undefined> = process.env,
): AdminUrlSource {
  for (const variable of CONFIGURABLE) {
    const value = env[variable]?.trim();
    if (!value || value.endsWith(`/${PLACEHOLDER_DATABASE}`)) continue;
    return { url: value, variable };
  }
  return { url: DEFAULT_ADMIN_URL, variable: null };
}

export function adminUrl(): string {
  return adminUrlSource().url;
}

/** Same server, role and connection options (`sslmode`…) as the admin URL, other database. */
export function urlForDatabase(name: string): string {
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

/** `host:port` of the admin URL, for messages (never the credentials). */
export function describeServer(url: string = adminUrl()): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}`;
  } catch {
    return 'an unparsable URL';
  }
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = new URL(adminUrl());
  // Administrative statements run from the database the URL names (any database will do).
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/postgres';
  const client = new pg.Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export type DatabaseProbe = { available: true } | { available: false; reason: string };

/**
 * Can the test suite use this server? Connects and checks that the role may create databases.
 * Never throws: an unreachable server is an answer, not an error.
 */
export async function probeTestDatabaseServer(): Promise<DatabaseProbe> {
  try {
    return await withAdmin(async (client) => {
      const result = await client.query<{ can_create: boolean }>(
        'SELECT (rolcreatedb OR rolsuper) AS can_create FROM pg_roles WHERE rolname = current_user',
      );
      return result.rows[0]?.can_create
        ? { available: true as const }
        : { available: false as const, reason: 'the role is not allowed to CREATE DATABASE' };
    });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return {
      available: false,
      reason:
        typeof code === 'string'
          ? `${code}${message ? ` — ${message}` : ''}`
          : message || 'no answer',
    };
  }
}

const assertSafeName = (name: string): void => {
  if (!/^[a-z0-9_]{1,60}$/.test(name)) throw new Error(`Unsafe database name: ${name}`);
};

export async function createDatabase(name: string, template?: string): Promise<void> {
  assertSafeName(name);
  if (template) assertSafeName(template);
  await withAdmin(async (client) => {
    // Cloning needs the template to have no open connections; retry briefly if a pool lingers.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await client.query(`CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ''}`);
        return;
      } catch (error) {
        const busy = (error as { code?: string }).code === '55006';
        if (!busy || attempt >= 20) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  });
}

export async function dropDatabase(name: string): Promise<void> {
  assertSafeName(name);
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
}

export async function dropDatabasesWithPrefix(prefix: string): Promise<void> {
  assertSafeName(prefix);
  await withAdmin(async (client) => {
    const result = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`${prefix.replace(/_/g, '\\_')}%`],
    );
    for (const row of result.rows) {
      await client.query(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`);
    }
  });
}

/** Applies every `prisma/migrations/<name>/migration.sql` in order (no Prisma CLI needed). */
export async function applyMigrations(databaseUrl: string): Promise<void> {
  const directory = fileURLToPath(new URL('../../prisma/migrations', import.meta.url));
  const migrations = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const migration of migrations) {
      await client.query(readFileSync(`${directory}/${migration}/migration.sql`, 'utf8'));
    }
  } finally {
    await client.end();
  }
}
