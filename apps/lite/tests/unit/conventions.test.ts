import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * House rules that are easy to break by accident, checked on the source text:
 *
 * 1. every server action authenticates and authorises (ARCHITECTURE §3.1);
 * 2. every route handler has an explicit way of knowing who calls it, or is on the short list
 *    of public ones;
 * 3. Client Components never deal in `bigint` — money crosses the boundary as strings (§3.3);
 * 4. every environment variable the app reads is documented in `.env.example`.
 */

const appDir = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string): string => readFileSync(join(appDir, path), 'utf8');

function walk(directory: string, accept: (file: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(appDir, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'generated' && entry.name !== 'node_modules') {
        found.push(...walk(path, accept));
      }
    } else if (accept(path)) {
      found.push(relative('.', path));
    }
  }
  return found;
}

const sources = walk('src', (file) => /\.(ts|tsx)$/.test(file));
const startsWithDirective = (file: string, directive: string): boolean =>
  new RegExp(`^\\s*(?:/\\*[\\s\\S]*?\\*/\\s*)*['"]${directive}['"]`).test(read(file));

describe('server actions', () => {
  const actionFiles = sources.filter((file) => startsWithDirective(file, 'use server'));

  /** Actions a signed-out visitor may call. Anything new here needs a very good reason. */
  const PUBLIC_ACTIONS = new Set(['loginAction', 'registerAction', 'applyForPartnerAction']);
  /** Plain functions (not built with the factories) and why they are safe. */
  const HAND_WRITTEN = new Map([['logoutAction', 'ends the caller’s own session']]);

  it('finds the action files', () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(20);
  });

  it('are all built with createAction (role or permission) or are explicitly public', () => {
    const problems: string[] = [];
    let count = 0;
    for (const file of actionFiles) {
      const source = read(file);
      const exports = [...source.matchAll(/^export\s+(?:const|async function|function)\s+(\w+)/gm)];
      if (/^export\s+(?:\{|\*|default)/m.test(source)) {
        problems.push(`${file}: re-exports or default exports hide what is exposed`);
      }
      for (const [index, match] of exports.entries()) {
        count += 1;
        const name = match[1] ?? '';
        const start = match.index;
        const end = exports[index + 1]?.index ?? source.length;
        const body = source.slice(start, end);
        if (HAND_WRITTEN.has(name)) continue;
        if (/=\s*createPublicAction\(/.test(body)) {
          if (!PUBLIC_ACTIONS.has(name)) problems.push(`${file}: ${name} is public`);
          continue;
        }
        if (!/=\s*createAction\(/.test(body)) {
          problems.push(`${file}: ${name} is not built with createAction`);
          continue;
        }
        if (!/\b(?:roles|permission)\s*:/.test(body)) {
          problems.push(`${file}: ${name} declares neither roles nor permission`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(count).toBeGreaterThanOrEqual(80);
  });
});

describe('route handlers', () => {
  const routes = sources.filter((file) => /(^|\/)route\.ts$/.test(file));

  /** Handlers that answer anyone, by design. */
  const PUBLIC_ROUTES = new Set([
    'src/app/api/health/route.ts', // liveness / readiness, no data
    'src/app/api/v1/route.ts', // API index: endpoint catalogue only
    'src/app/api/v1/openapi.json/route.ts', // OpenAPI description only
  ]);
  const GUARDS = [
    /\bgetActionContext\(/, // session
    /\bv1Route(?:<[^>]*>)?\(/, // API key + scope
    /\bhandleProviderWebhook\(/, // HMAC signature + replay protection
  ];

  it('each authenticate the caller or are on the public list', () => {
    expect(routes.length).toBeGreaterThanOrEqual(12);
    const unguarded = routes.filter(
      (file) => !PUBLIC_ROUTES.has(file) && !GUARDS.some((guard) => guard.test(read(file))),
    );
    expect(unguarded).toEqual([]);
    for (const file of PUBLIC_ROUTES) expect(routes).toContain(file);
  });
});

describe('client components', () => {
  const clientFiles = sources.filter((file) => startsWithDirective(file, 'use client'));

  it('never handle bigint: money reaches the browser as strings', () => {
    expect(clientFiles.length).toBeGreaterThanOrEqual(20);
    const offenders = clientFiles.filter((file) => /\bbigint\b|\bBigInt\(|\d+n\b/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('never import server modules other than the pure money helpers and types', () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      for (const match of read(file).matchAll(
        /^import\s+(type\s+)?[^;]*?from\s+'(@\/server\/[^']+)'/gm,
      )) {
        const typeOnly = Boolean(match[1]);
        if (!typeOnly && match[2] !== '@/server/money') offenders.push(`${file}: ${match[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('.env.example', () => {
  it('documents every environment variable the app, the seed and the tests read', () => {
    const documented = new Set(
      [...read('.env.example').matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map((match) => match[1]),
    );
    const files = [
      ...sources,
      ...walk('prisma', (file) => file.endsWith('.ts')),
      ...walk('scripts', (file) => file.endsWith('.mjs')),
      ...walk('tests/e2e', (file) => /\.(ts|mjs)$/.test(file)),
      ...walk('tests/helpers', (file) => file.endsWith('.ts')),
      'next.config.ts',
      'prisma.config.ts',
    ];
    /** Read by tooling or shown only in documentation samples, not configuration of the app. */
    const ignored = new Set(['CI', 'PORT', 'BIREM_WEBHOOK_SECRET']);
    const missing = new Set<string>();
    for (const file of files) {
      const source = read(file);
      const names = [
        ...[...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]),
        // Keys of the Zod schema in src/server/env.ts and of `env.X` reads on a passed-in env.
        ...(file.endsWith('src/server/env.ts')
          ? [...source.matchAll(/^\s{2}([A-Z][A-Z0-9_]+): z\./gm)].map((match) => match[1])
          : []),
        ...(file.endsWith('build-info.ts')
          ? [...source.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1])
          : []),
      ];
      for (const name of names) {
        if (name && !ignored.has(name) && !documented.has(name)) missing.add(`${name} (${file})`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
