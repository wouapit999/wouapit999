import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

/**
 * Low-level helpers for the integration-test databases. Every vitest run creates its own
 * template database (migrated + reference data) and every test file clones it, so runs and files
 * never share state and can execute in parallel — also alongside other people's runs.
 *
 * Connection: `TEST_DATABASE_ADMIN_URL`, else the local dev default
 * (`postgresql://birem:birem@localhost:5432/postgres`). The role must be allowed to CREATE
 * DATABASE; the database part of the URL is ignored.
 */

const DEFAULT_ADMIN_URL = 'postgresql://birem:birem@localhost:5432/postgres';

export function adminUrl(): string {
  return process.env.TEST_DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL;
}

export function urlForDatabase(name: string): string {
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  url.search = '';
  return url.toString();
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = new URL(adminUrl());
  url.pathname = '/postgres';
  url.search = '';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
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
