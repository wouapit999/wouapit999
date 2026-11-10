import { rmSync } from 'node:fs';

import { dropDatabase } from '../helpers/pg-admin';

import { AUTH_DIR, E2E_DATABASE_NAME, E2E_EXTERNAL } from './env';

/** Drops the suite's database (keep it for a post-mortem with `E2E_KEEP_DATABASE=1`). */
export default async function globalTeardown(): Promise<void> {
  rmSync(AUTH_DIR, { recursive: true, force: true });
  if (E2E_EXTERNAL || process.env.E2E_KEEP_DATABASE === '1') return;
  await dropDatabase(E2E_DATABASE_NAME);
}
