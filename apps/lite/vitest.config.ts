import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig } from 'vitest/config';

import { resolveTestDatabase, skipNotice } from './tests/helpers/test-database';

/**
 * `pnpm test` works with and without PostgreSQL:
 *
 * - with a reachable server (the local default, or `TEST_DATABASE_URL` / `DATABASE_URL`) every
 *   file runs, the database-backed ones against throw-away databases of their own;
 * - without one, the files that call `withTestDatabase()` are left out and a notice says so at
 *   the start and at the end of the run. A server that was named explicitly but cannot be used
 *   is an error, never a skip. See `tests/helpers/test-database.ts`.
 */
export default defineConfig(async () => {
  const database = await resolveTestDatabase();
  if (!database.available) console.warn(skipNotice(database));

  return {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // `server-only` throws outside a React Server environment; tests run in plain Node.
        'server-only': fileURLToPath(new URL('./tests/helpers/server-only.ts', import.meta.url)),
      },
    },
    test: {
      environment: 'node',
      include: [
        'tests/unit/**/*.test.ts',
        'tests/integration/**/*.test.ts',
        'tests/customer/**/*.test.ts',
        'tests/admin/**/*.test.ts',
        'tests/partner/**/*.test.ts',
        'src/**/*.test.ts',
      ],
      exclude: [...configDefaults.exclude, ...(database.available ? [] : database.skippedFiles)],
      globalSetup: ['./tests/helpers/global-setup.ts'],
      setupFiles: ['./tests/helpers/setup.ts'],
      testTimeout: 30_000,
      hookTimeout: 60_000,
      pool: 'forks',
      reporters: process.env.CI ? ['default', 'junit'] : ['default'],
      outputFile: { junit: 'coverage/junit.xml' },
    },
  };
});
