#!/usr/bin/env node
/**
 * Web server of the end-to-end suite (started by Playwright's `webServer`): builds the app the
 * way a deployment does (`next build`), then serves that build with `next start`.
 *
 *   E2E_SKIP_BUILD=1   reuse the existing build in NEXT_DIST_DIR (default `.next`)
 *   PORT               port to listen on (set by the Playwright config)
 *
 * The database does not need to exist yet: nothing connects until the first request, and the
 * global setup creates, migrates and seeds it before the first test runs.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nextBin = createRequire(join(appDir, 'package.json')).resolve('next/dist/bin/next');
const distDir = process.env.NEXT_DIST_DIR ?? '.next';
const port = process.env.PORT ?? '3210';
// `next build` and `next start` both expect production; a CI job may export NODE_ENV=test.
const env = { ...process.env, NODE_ENV: 'production' };

/** Runs one build step quietly; its output is shown only if it fails. */
function step(label, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: appDir,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    console.error(`[e2e] ${label} failed`);
    process.exit(result.status ?? 1);
  }
}

const built = existsSync(join(appDir, distDir, 'BUILD_ID'));
if (process.env.E2E_SKIP_BUILD === '1' && built) {
  console.log(`[e2e] reusing the build in ${distDir}`);
} else {
  console.log(`[e2e] building the app into ${distDir}…`);
  step('sync-roadmap', [join(appDir, 'scripts', 'sync-roadmap.mjs')]);
  step('next build', [nextBin, 'build']);
}

const server = spawn(process.execPath, [nextBin, 'start', '-p', port], {
  cwd: appDir,
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
