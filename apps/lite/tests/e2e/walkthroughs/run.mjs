#!/usr/bin/env node
/**
 * Area walk-throughs: four long scripted sessions (core shell, customer area, back office,
 * partner portal + public API) that go deeper than the Playwright suite next door — MFA, SAR
 * filing, provider webhooks, partner webhook deliveries, agent cash-in… about 370 checks.
 *
 *   pnpm --filter @bi-rem/lite test:e2e:walkthroughs              # all four
 *   pnpm --filter @bi-rem/lite test:e2e:walkthroughs -- customer  # one of them
 *
 * Self-contained by default: seeds a template database with the demo data, starts `next dev` on
 * its own port and dist dir, and gives every walk-through a fresh copy of the template (each one
 * changes the demo data and signs in many times, which the non-production rate limits allow).
 * Needs a Postgres role that may CREATE DATABASE: `TEST_DATABASE_ADMIN_URL`, default
 * `postgresql://birem:birem@localhost:5432/postgres`. To run two at once give each its own
 * `E2E_WALKTHROUGH_PORT`, `E2E_WALKTHROUGH_DATABASE` and `NEXT_DIST_DIR`.
 *
 * With `E2E_BASE_URL` set, nothing is provisioned: the walk-throughs run against that instance,
 * which must hold freshly seeded demo data and must not enforce the production rate limits.
 *
 * A walk-through is a file `<name>.e2e.mjs` here that default-exports
 *   async ({ browser, baseUrl, check, login }) => { … }
 * and calls `check(name, condition, detail?)` for every assertion.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..', '..', '..');
const appRequire = createRequire(join(appDir, 'package.json'));
const { chromium } = appRequire('@playwright/test');
const pg = appRequire('pg');

const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const specs = readdirSync(here)
  .filter((file) => file.endsWith('.e2e.mjs'))
  .filter((file) => wanted.length === 0 || wanted.some((name) => file.startsWith(`${name}.`)))
  .sort();
if (specs.length === 0) {
  console.error(`walk-throughs: nothing matches ${wanted.join(', ')}`);
  process.exit(1);
}

const DEMO_PASSWORD = process.env.E2E_PASSWORD ?? 'ChangeMe123!';
const external = process.env.E2E_BASE_URL?.replace(/\/$/, '');
const port = Number(process.env.E2E_WALKTHROUGH_PORT ?? 3220);
const baseUrl = external ?? `http://localhost:${port}`;

// ------------------------------------------------------------------ provisioning (own mode)

const adminUrl = new URL(
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://birem:birem@localhost:5432/postgres',
);
// Port, database and dist dir are all overridable, so two runs never collide.
const DATABASE = process.env.E2E_WALKTHROUGH_DATABASE ?? 'birem_lite_walk';
if (!/^[a-z0-9_]{1,50}$/.test(DATABASE)) {
  console.error(`walk-throughs: unsafe E2E_WALKTHROUGH_DATABASE "${DATABASE}"`);
  process.exit(1);
}
const TEMPLATE = `${DATABASE}_tpl`;
const DIST_DIR = process.env.NEXT_DIST_DIR ?? '.next-walkthroughs';
const urlFor = (name) =>
  Object.assign(new URL(adminUrl), { pathname: `/${name}`, search: '' }).toString();

async function sql(statement) {
  const client = new pg.Client({ connectionString: urlFor('postgres') });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/** Environment of the seed and of the dev server (development: fixed dev secrets, relaxed limits). */
const serverEnv = (database) => ({
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: urlFor(database),
  DATABASE_URL_UNPOOLED: urlFor(database),
  SEED_DEMO_DATA: 'true',
  SEED_ADMIN_EMAIL: 'admin@bi-rem.local',
  SEED_ADMIN_PASSWORD: DEMO_PASSWORD,
  NEXT_DIST_DIR: DIST_DIR,
  NEXT_TELEMETRY_DISABLED: '1',
});

let server;
// `next dev` with its own dist dir rewrites next-env.d.ts to point there; put it back afterwards.
const nextEnvPath = join(appDir, 'next-env.d.ts');
const nextEnvBefore = existsSync(nextEnvPath) ? readFileSync(nextEnvPath, 'utf8') : undefined;

async function provision() {
  console.log('walk-throughs: seeding the template database…');
  await sql(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);
  await sql(`DROP DATABASE IF EXISTS "${TEMPLATE}" WITH (FORCE)`);
  await sql(`CREATE DATABASE "${TEMPLATE}"`);
  const run = (args) =>
    execFileSync('pnpm', ['exec', ...args], {
      cwd: appDir,
      env: serverEnv(TEMPLATE),
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  run(['prisma', 'generate']);
  run(['prisma', 'migrate', 'deploy']);
  run(['tsx', 'prisma/seed.ts']);
  await freshDatabase();

  console.log(`walk-throughs: starting next dev on port ${port}…`);
  server = spawn(
    process.execPath,
    [appRequire.resolve('next/dist/bin/next'), 'dev', '-p', String(port)],
    { cwd: appDir, env: serverEnv(DATABASE), stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error('the dev server did not become healthy');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Replaces the working database with a pristine copy of the seeded template. */
async function freshDatabase() {
  await sql(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);
  await sql(`CREATE DATABASE "${DATABASE}" TEMPLATE "${TEMPLATE}"`);
}

async function teardown() {
  if (server) {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      server.once('exit', resolve);
      setTimeout(resolve, 5_000);
    });
  }
  if (!external) {
    await sql(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`).catch(() => undefined);
    await sql(`DROP DATABASE IF EXISTS "${TEMPLATE}" WITH (FORCE)`).catch(() => undefined);
    rmSync(join(appDir, DIST_DIR), { recursive: true, force: true });
    if (nextEnvBefore !== undefined) writeFileSync(nextEnvPath, nextEnvBefore);
    else rmSync(nextEnvPath, { force: true });
  }
}

// ------------------------------------------------------------------ run

const results = [];
let browser;

/** Signs in through the real form. Returns the page, on the area of the user's role. */
async function login(context, email, password = DEMO_PASSWORD) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  return page;
}

try {
  if (!external) await provision();
  browser = await chromium.launch();
  for (const [index, file] of specs.entries()) {
    const check = (name, condition, detail = '') => {
      results.push({ spec: file, name, ok: Boolean(condition), detail });
      console.log(
        `${condition ? '  ✓' : '  ✗'} ${name}${condition || !detail ? '' : ` — ${detail}`}`,
      );
    };
    console.log(`\n${file}`);
    try {
      if (!external && index > 0) await freshDatabase();
      const spec = await import(pathToFileURL(join(here, file)).href);
      await spec.default({ browser, baseUrl, check, login });
    } catch (error) {
      check(
        'walk-through ran to completion',
        false,
        error instanceof Error ? error.message.split('\n')[0] : String(error),
      );
    }
  }
} finally {
  await browser?.close();
  await teardown();
}

const failed = results.filter((result) => !result.ok);
for (const file of specs) {
  const own = results.filter((result) => result.spec === file);
  console.log(`  ${file}: ${own.filter((result) => result.ok).length}/${own.length}`);
}
console.log(
  `\nwalk-throughs: ${results.length - failed.length} passed, ${failed.length} failed, ${specs.length} file(s)`,
);
process.exit(failed.length > 0 ? 1 : 0);
