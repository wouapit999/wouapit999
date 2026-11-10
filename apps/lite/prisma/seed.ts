import 'dotenv/config';

import { hashPassword } from '@/server/crypto';
import { db, disconnectDb } from '@/server/db';
import { getEnv, resetEnvCache } from '@/server/env';
import { verifyLedgerIntegrity } from '@/server/ledger';
import { seedDemoData } from '@/server/seed/demo';
import { seedAdminUser, seedReferenceData } from '@/server/seed/reference';

/**
 * BI-Rem Lite seed — idempotent, safe on every deploy (`vercel-build` runs it after
 * `prisma migrate deploy`).
 *
 *   1. Reference data: countries, rails, providers, FX rates, fee rules, system ledger accounts
 *      and thresholds, AML rules, the (fictional) demo screening list.
 *   2. The initial administrator from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (created once; an
 *      existing account is never modified).
 *   3. Demo data when SEED_DEMO_DATA is true (default outside production).
 *
 * Uses the direct connection (DATABASE_URL_UNPOOLED) when provided.
 */

const DEMO_PASSWORD = 'ChangeMe123!';

async function main(): Promise<void> {
  // Seed over the direct (non-pooled) connection when the platform provides one.
  if (process.env.DATABASE_URL_UNPOOLED) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
    resetEnvCache();
  }
  const env = getEnv();
  if (env.isProduction && !env.seedAdminPasswordProvided) {
    throw new Error(
      'SEED_ADMIN_PASSWORD must be set in production (the default password is public).',
    );
  }

  console.log('[seed] reference data…');
  await seedReferenceData(db);

  const admin = await seedAdminUser(db, {
    email: env.seedAdminEmail,
    passwordHash: await hashPassword(env.seedAdminPassword),
  });
  console.log(
    `[seed] administrator ${env.seedAdminEmail}: ${admin.created ? 'created' : 'already exists (unchanged)'}`,
  );

  if (env.seedDemoData) {
    console.log('[seed] demo data…');
    const result = await seedDemoData(db, {
      passwordHash: await hashPassword(DEMO_PASSWORD),
      adminEmail: env.seedAdminEmail,
      log: (message) => console.log(`[seed] ${message}`),
    });
    for (const failure of result.failures) console.warn(`[seed] skipped — ${failure}`);
  } else {
    console.log('[seed] demo data disabled (SEED_DEMO_DATA is not true)');
  }

  const integrity = await verifyLedgerIntegrity();
  const broken = integrity.filter((row) => !row.balanced);
  if (broken.length > 0) {
    throw new Error(
      `Ledger integrity check failed for: ${broken.map((row) => row.currency).join(', ')}`,
    );
  }
  console.log(
    `[seed] ledger balanced in ${integrity.length} currenc${integrity.length === 1 ? 'y' : 'ies'} — done`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
