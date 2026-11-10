import { randomBytes } from 'node:crypto';

import type { TestProject } from 'vitest/node';

import {
  adminUrl,
  applyMigrations,
  createDatabase,
  dropDatabasesWithPrefix,
  urlForDatabase,
} from './pg-admin';
import { resolveTestDatabase, skipNotice } from './test-database';

/**
 * Runs once per `vitest` invocation: creates a uniquely named template database, applies the
 * migrations and seeds the reference data. Integration test files clone it (see `./db.ts`).
 * Everything created by this run is dropped at the end.
 *
 * Without a reachable PostgreSQL server nothing is created: `vitest.config.ts` has already left
 * the database-backed files out, and the notice explaining it is printed again at the end of
 * the run (see `./test-database.ts`).
 */

declare module 'vitest' {
  export interface ProvidedContext {
    /** Server the test databases live on (resolved once, so every worker uses the same one). */
    testDbAdminUrl: string;
    testDbPrefix: string;
    testDbTemplate: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const state = await resolveTestDatabase();
  if (!state.available) {
    project.provide('testDbAdminUrl', '');
    project.provide('testDbPrefix', '');
    project.provide('testDbTemplate', '');
    return () => {
      console.warn(skipNotice(state));
      return Promise.resolve();
    };
  }

  // Pin the server for the rest of the run: tests repoint DATABASE_URL at their own database.
  const admin = adminUrl();
  process.env.TEST_DATABASE_ADMIN_URL = admin;

  const prefix = `birem_lite_t_${randomBytes(4).toString('hex')}_`;
  const template = `${prefix}tpl`;
  await createDatabase(template);
  const url = urlForDatabase(template);
  await applyMigrations(url);

  // Seed reference data through the application's own code, then release every connection so
  // the template can be cloned.
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  const { resetEnvCache } = await import('@/server/env');
  const { db, disconnectDb } = await import('@/server/db');
  const { seedReferenceData } = await import('@/server/seed/reference');
  resetEnvCache();
  await seedReferenceData(db);
  await disconnectDb();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  resetEnvCache();

  project.provide('testDbAdminUrl', admin);
  project.provide('testDbPrefix', prefix);
  project.provide('testDbTemplate', template);

  return async () => {
    await dropDatabasesWithPrefix(prefix);
  };
}
