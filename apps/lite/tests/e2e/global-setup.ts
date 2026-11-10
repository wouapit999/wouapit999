import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

import { createDatabase, dropDatabase } from '../helpers/pg-admin';

import { APP_DIR, AUTH_DIR, BASE_URL, E2E_DATABASE_NAME, E2E_EXTERNAL, SERVER_ENV } from './env';

/**
 * Runs once before the suite. Self-contained mode: a brand-new database, migrated the way a
 * deployment migrates it (`prisma migrate deploy`) and seeded with the demo data by the real
 * seed (`prisma/seed.ts`). Then, in both modes, waits until the app answers `/api/health` with
 * the database up.
 */

function run(label: string, command: string, args: string[]): void {
  console.log(`[e2e] ${label}…`);
  try {
    execFileSync(command, args, {
      cwd: APP_DIR,
      // The seed must behave as it does outside production: demo accounts, default password.
      env: { ...process.env, ...SERVER_ENV, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const output = error as { stdout?: Buffer; stderr?: Buffer };
    process.stderr.write(output.stdout?.toString() ?? '');
    process.stderr.write(output.stderr?.toString() ?? '');
    throw new Error(`[e2e] ${label} failed`);
  }
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = 'no answer';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      const body = (await response.json()) as { status?: string };
      if (response.ok && body.status === 'ok') return;
      last = `${response.status} ${JSON.stringify(body)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`[e2e] ${BASE_URL}/api/health is not healthy: ${last}`);
}

export default async function globalSetup(): Promise<void> {
  rmSync(AUTH_DIR, { recursive: true, force: true });
  mkdirSync(AUTH_DIR, { recursive: true });

  if (!E2E_EXTERNAL) {
    console.log(`[e2e] creating database ${E2E_DATABASE_NAME}`);
    await dropDatabase(E2E_DATABASE_NAME);
    await createDatabase(E2E_DATABASE_NAME);
    run('prisma migrate deploy', 'pnpm', ['exec', 'prisma', 'migrate', 'deploy']);
    run('seed (reference + demo data)', 'pnpm', ['exec', 'tsx', 'prisma/seed.ts']);
  }
  await waitForHealth(E2E_EXTERNAL ? 30_000 : 120_000);
}
