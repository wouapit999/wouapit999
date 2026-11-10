import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, inject } from 'vitest';

import { db, disconnectDb } from '@/server/db';
import { resetEnvCache } from '@/server/env';

import { createDatabase, dropDatabase, urlForDatabase } from './pg-admin';

/**
 * Call at the top of an integration test file. Gives the file its own freshly cloned database
 * (migrated, with reference data: countries, providers, FX rates, fee rules, AML rules, system
 * accounts) and points `@/server/db` at it. Dropped when the file finishes.
 */
export function withTestDatabase(): void {
  let name: string | undefined;

  const admin = inject('testDbAdminUrl');
  if (admin === '') {
    // `vitest.config.ts` leaves database-backed files out when no server is reachable, so this
    // only happens when a file was named explicitly on the command line.
    throw new Error(
      'This test file needs PostgreSQL and no server is reachable. Start Postgres or set ' +
        'TEST_DATABASE_URL (see tests/helpers/test-database.ts).',
    );
  }
  // Same server for the whole run, whatever DATABASE_URL becomes below.
  process.env.TEST_DATABASE_ADMIN_URL = admin;

  beforeAll(async () => {
    name = `${inject('testDbPrefix')}${randomBytes(5).toString('hex')}`;
    await createDatabase(name, inject('testDbTemplate'));
    await disconnectDb();
    process.env.DATABASE_URL = urlForDatabase(name);
    resetEnvCache();
  });

  afterAll(async () => {
    await disconnectDb();
    if (name) await dropDatabase(name);
  });
}

/** Tables holding activity (not reference data), in an order TRUNCATE … CASCADE accepts. */
const TRANSACTIONAL_TABLES = [
  'audit_logs',
  'notifications',
  'webhook_deliveries',
  'webhook_endpoints',
  'api_keys',
  'commissions',
  'settlements',
  'sar_reports',
  'aml_case_notes',
  'aml_alerts',
  'aml_cases',
  'transfer_events',
  'ledger_entries',
  'journals',
  'transfers',
  'quotes',
  'provider_webhook_events',
  'provider_health_checks',
  'provider_secrets',
  'beneficiaries',
  'kyc_documents',
  'kyc_cases',
  'wallets',
  'sessions',
  'login_attempts',
  'rate_limit_buckets',
  'users',
  'partners',
] as const;

/**
 * Wipes all activity while keeping reference data, and zeroes the system account balances.
 * Most tests do not need this — create fresh users with the factories instead.
 */
export async function truncateActivity(): Promise<void> {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${TRANSACTIONAL_TABLES.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  await db.$executeRawUnsafe(`DELETE FROM ledger_accounts WHERE type = 'WALLET'`);
  await db.$executeRawUnsafe(`UPDATE ledger_accounts SET balance = 0`);
}
