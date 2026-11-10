import { defineConfig, devices } from '@playwright/test';

import { APP_DIR, BASE_URL, E2E_EXTERNAL, SERVER_ENV } from './env';

/**
 * End-to-end suite of BI-Rem Lite (see `./env.ts` for the two modes and their variables).
 *
 *   pnpm --filter @bi-rem/lite test:e2e                 # build, start, migrate, seed, run
 *   E2E_SKIP_BUILD=1 pnpm --filter @bi-rem/lite test:e2e # reuse the existing `.next` build
 *
 * The specs tell one story (a customer's first week on the platform) and share one database, so
 * they run in file order on a single worker. Every role signs in exactly once (`auth.setup.ts`)
 * and the session is reused: the app runs with its production rate limits.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  outputDir: '../../test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI
    ? [['list'], ['junit', { outputFile: '../../test-results/e2e-junit.xml' }]]
    : [['list']],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: E2E_EXTERNAL
    ? undefined
    : {
        command: 'node tests/e2e/start-server.mjs',
        cwd: APP_DIR,
        // A static asset: ready as soon as the server listens. The database is prepared by the
        // global setup, which then waits for /api/health.
        url: `${BASE_URL}/manifest.webmanifest`,
        reuseExistingServer: false,
        timeout: 360_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: SERVER_ENV,
      },
});
