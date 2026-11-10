import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminUrlSource, describeServer, probeTestDatabaseServer } from './pg-admin';

/**
 * Decides, once per `vitest` invocation, whether the database-backed test files can run.
 *
 * - A PostgreSQL server is reachable → everything runs.
 * - None is reachable and none was asked for → the database-backed files are left out and the
 *   run says so, loudly, at the start and at the end. Unit tests still run, so `pnpm test` works
 *   on a machine without Postgres.
 * - A server was named explicitly (`TEST_DATABASE_ADMIN_URL`, `TEST_DATABASE_URL` or
 *   `DATABASE_URL`) or `REQUIRE_TEST_DATABASE=1` is set, and it cannot be used → the run fails.
 *   A CI job that expects a database must never turn green by skipping.
 */

const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));

export type TestDatabaseState =
  | { available: true; server: string }
  | { available: false; server: string; reason: string; skippedFiles: string[] };

function walk(directory: string): string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'e2e' ? [] : walk(path);
    return entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** Test files that call `withTestDatabase()`, relative to the app directory. */
export function databaseBackedTestFiles(): string[] {
  return [...walk(join(APP_DIR, 'tests')), ...walk(join(APP_DIR, 'src'))]
    .filter((file) => /^\s*withTestDatabase\(\)/m.test(readFileSync(file, 'utf8')))
    .map((file) => relative(APP_DIR, file).split('\\').join('/'))
    .sort();
}

export async function resolveTestDatabase(): Promise<TestDatabaseState> {
  const source = adminUrlSource();
  const server = describeServer(source.url);
  const probe = await probeTestDatabaseServer();
  if (probe.available) return { available: true, server };

  const required = process.env.REQUIRE_TEST_DATABASE === '1';
  if (source.variable !== null || required) {
    throw new Error(
      `[bi-rem-lite tests] PostgreSQL at ${server} ` +
        `(${source.variable ?? 'the local default — REQUIRE_TEST_DATABASE=1'}) cannot be used: ${probe.reason}. ` +
        'The integration tests need a role that may CREATE DATABASE. Fix the URL, or unset it to ' +
        'run the unit tests only.',
    );
  }
  return {
    available: false,
    server,
    reason: probe.reason,
    skippedFiles: databaseBackedTestFiles(),
  };
}

/** The notice printed when the database-backed files are skipped. */
export function skipNotice(state: Extract<TestDatabaseState, { available: false }>): string {
  const bar = '='.repeat(96);
  return [
    '',
    bar,
    `  SKIPPED: ${state.skippedFiles.length} database-backed test files were NOT run.`,
    `  No PostgreSQL server is reachable at ${state.server} (${state.reason}).`,
    '  Only the unit tests ran — the money-movement, AML, KYC and API integration suites did not.',
    '  To run them: start Postgres (docker compose -f infra/docker/docker-compose.yml up -d postgres)',
    '  or point TEST_DATABASE_URL (or DATABASE_URL) at a server whose role may CREATE DATABASE.',
    '  Set REQUIRE_TEST_DATABASE=1 to make a missing database an error instead of a skip.',
    bar,
    '',
  ].join('\n');
}
