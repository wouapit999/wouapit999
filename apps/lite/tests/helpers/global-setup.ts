import { randomBytes } from 'node:crypto';

import type { TestProject } from 'vitest/node';

import {
  applyMigrations,
  createDatabase,
  dropDatabasesWithPrefix,
  urlForDatabase,
} from './pg-admin';

/**
 * Runs once per `vitest` invocation: creates a uniquely named template database, applies the
 * migrations and seeds the reference data. Integration test files clone it (see `./db.ts`).
 * Everything created by this run is dropped at the end.
 */

declare module 'vitest' {
  export interface ProvidedContext {
    testDbPrefix: string;
    testDbTemplate: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
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

  project.provide('testDbPrefix', prefix);
  project.provide('testDbTemplate', template);

  return async () => {
    await dropDatabasesWithPrefix(prefix);
  };
}
