import { fileURLToPath } from 'node:url';

import { urlForDatabase } from '../helpers/pg-admin';

/**
 * Settings shared by the Playwright config, the global setup / teardown and the specs.
 *
 * Two modes:
 *
 * - **Self-contained (default).** The suite creates its own database (`E2E_DATABASE_NAME`,
 *   default `birem_lite_e2e`) on the server named by `TEST_DATABASE_ADMIN_URL` (default: the local
 *   development Postgres), applies the migrations with `prisma migrate deploy`, seeds the demo
 *   data, builds the app and serves it with `next start` on `E2E_PORT` (default 3210).
 * - **Against a running instance.** With `E2E_BASE_URL` set (a local server or a Vercel preview),
 *   nothing is built, started or created: the instance must already hold the demo data. The suite
 *   changes that data, so never point it at anything you care about.
 */

export const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));

/** Storage states (signed-in cookies) written by `auth.setup.ts`; git-ignored. */
export const AUTH_DIR = fileURLToPath(new URL('./.auth', import.meta.url));

const externalBaseUrl = process.env.E2E_BASE_URL?.replace(/\/$/, '');

export const E2E_EXTERNAL = externalBaseUrl !== undefined && externalBaseUrl !== '';

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3210);

export const BASE_URL = E2E_EXTERNAL ? (externalBaseUrl ?? '') : `http://localhost:${E2E_PORT}`;

export const E2E_DATABASE_NAME = process.env.E2E_DATABASE_NAME ?? 'birem_lite_e2e';

export const E2E_DATABASE_URL = urlForDatabase(E2E_DATABASE_NAME);

/** Password of every demo account (see SPEC.md "Seeded demo accounts"). */
export const DEMO_PASSWORD = process.env.E2E_PASSWORD ?? 'ChangeMe123!';

/**
 * Environment of the app under test and of the seed. The two secrets are fixed, public,
 * test-only values for a throw-away local database — never reuse them anywhere else.
 */
export const SERVER_ENV: Record<string, string> = {
  DATABASE_URL: E2E_DATABASE_URL,
  DATABASE_URL_UNPOOLED: E2E_DATABASE_URL,
  AUTH_SECRET: 'e2e-only-auth-secret-not-for-any-real-deployment-0123456789',
  ENCRYPTION_KEY: Buffer.alloc(32, 0x45).toString('base64'),
  SEED_DEMO_DATA: 'true',
  SEED_ADMIN_EMAIL: 'admin@bi-rem.local',
  SEED_ADMIN_PASSWORD: DEMO_PASSWORD,
  NEXT_PUBLIC_APP_NAME: 'BI-Rem Lite',
  NEXT_TELEMETRY_DISABLED: '1',
  PORT: String(E2E_PORT),
};

/** The demo accounts the suite signs in as (one sign-in each, reused through storage state). */
export const ACCOUNTS = {
  admin: 'admin@bi-rem.local',
  compliance: 'compliance@bi-rem.local',
  treasury: 'treasury@bi-rem.local',
  support: 'support@bi-rem.local',
  partner: 'partner@bi-rem.local',
  agent: 'agent@bi-rem.local',
  amina: 'amina@example.com',
  joao: 'joao@example.com',
} as const;

export type AccountName = keyof typeof ACCOUNTS;

export const storageStatePath = (name: string): string => `${AUTH_DIR}/${name}.json`;
