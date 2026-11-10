import type { Page } from '@playwright/test';

import { BASE_URL } from './env';
import { expect, pageState, pathOf, test } from './support';

/**
 * Consistency: every internal link a role can see leads somewhere. Starting from the role's
 * home, the crawler follows each same-origin `<a href>` it finds (breadth first) and fails on a
 * 4xx / 5xx, on a rendered not-found or error boundary, and on a link that throws a signed-in
 * user back to the sign-in page. Downloads are fetched instead of navigated to.
 *
 * Detail pages and filtered lists exist once per row, so each "shape" of URL (path with ids
 * replaced, plus the names of its query parameters) is visited at most twice.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MAX_PER_SHAPE = 2;
const MAX_PAGES = 250;
/** Query parameters that select a different view of the same page: each value is its own shape. */
const VIEW_PARAMS = new Set(['tab', 'view']);

interface Link {
  readonly url: string;
  readonly from: string;
  readonly download: boolean;
}

function shapeOf(url: URL): string {
  const path = url.pathname
    .replace(UUID, ':id')
    .replace(/\/(BR|SET)-[A-Z0-9-]+/g, '/:ref')
    .replace(/\/\d+(?=\/|$)/g, '/:n');
  const params = [...url.searchParams.entries()]
    .map(([key, value]) => (VIEW_PARAMS.has(key) ? `${key}=${value}` : key))
    .sort();
  return `${path}?${[...new Set(params)].join('&')}`;
}

/** Links answered with a file or JSON rather than a page. */
const isResource = (url: URL): boolean =>
  url.pathname.startsWith('/api/') ||
  url.pathname.endsWith('/pdf') ||
  url.pathname.includes('/documents/') ||
  /\.(html|webmanifest|png|svg|ico|json|txt)$/.test(url.pathname);

async function crawl(
  page: Page,
  starts: readonly string[],
  signedIn: boolean,
): Promise<{ visited: string[]; failures: string[] }> {
  const origin = new URL(BASE_URL).origin;
  const queue: Link[] = starts.map((path) => ({
    url: new URL(path, origin).toString(),
    from: '(start)',
    download: false,
  }));
  const seen = new Set(queue.map((link) => link.url));
  const perShape = new Map<string, number>();
  const visited: string[] = [];
  const failures: string[] = [];

  while (queue.length > 0 && visited.length < MAX_PAGES) {
    const link = queue.shift();
    if (!link) break;
    const url = new URL(link.url);
    const shape = shapeOf(url);
    const count = perShape.get(shape) ?? 0;
    if (count >= MAX_PER_SHAPE) continue;
    perShape.set(shape, count + 1);
    const label = `${url.pathname}${url.search} (linked from ${link.from})`;

    if (link.download || isResource(url)) {
      const response = await page.request.get(link.url, { maxRedirects: 5 });
      visited.push(link.url);
      if (response.status() >= 400) failures.push(`${response.status()} ${label}`);
      continue;
    }

    const response = await page.goto(link.url, { waitUntil: 'load' });
    visited.push(link.url);
    const status = response?.status() ?? 0;
    if (status >= 400) {
      failures.push(`${status} ${label}`);
      continue;
    }
    const state = await pageState(page);
    if (state !== 'ok') {
      failures.push(`${state} page: ${label}`);
      continue;
    }
    if (signedIn && pathOf(page) === '/login') {
      failures.push(`sent to /login: ${label}`);
      continue;
    }

    const here = `${pathOf(page)}${new URL(page.url()).search}`;
    const anchors = await page.locator('a[href]').evaluateAll((elements) =>
      elements.map((element) => ({
        href: element.getAttribute('href') ?? '',
        download: element.hasAttribute('download'),
      })),
    );
    for (const anchor of anchors) {
      if (/^(mailto:|tel:|javascript:|#)/.test(anchor.href) || anchor.href === '') continue;
      const target = new URL(anchor.href, page.url());
      if (target.origin !== origin) continue;
      target.hash = '';
      const key = target.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ url: key, from: here, download: anchor.download });
    }
  }
  return { visited, failures };
}

const ROLES: ReadonlyArray<{ account: string; starts: readonly string[]; minimum: number }> = [
  { account: 'amina', starts: ['/app'], minimum: 20 },
  { account: 'joao', starts: ['/app'], minimum: 15 },
  { account: 'admin', starts: ['/admin'], minimum: 40 },
  { account: 'compliance', starts: ['/admin'], minimum: 25 },
  { account: 'treasury', starts: ['/admin'], minimum: 25 },
  { account: 'support', starts: ['/admin'], minimum: 20 },
  { account: 'partner', starts: ['/partner'], minimum: 12 },
  { account: 'agent', starts: ['/partner'], minimum: 12 },
];

test.describe('every internal link resolves', () => {
  test('signed-out visitor', async ({ page, watch }) => {
    watch(page);
    const { visited, failures } = await crawl(
      page,
      ['/', '/login', '/register', '/apply', '/roadmap', '/status'],
      false,
    );
    console.log(`  crawled ${visited.length} URLs signed out`);
    expect(failures).toEqual([]);
    expect(visited.length).toBeGreaterThanOrEqual(8);
  });

  for (const role of ROLES) {
    test(`as ${role.account}`, async ({ session }) => {
      test.setTimeout(300_000);
      const page = await session(role.account);
      const { visited, failures } = await crawl(page, role.starts, true);
      console.log(`  crawled ${visited.length} URLs as ${role.account}`);
      expect(failures).toEqual([]);
      expect(visited.length).toBeGreaterThanOrEqual(role.minimum);

      // No link may have signed the user out (sign-out must be a POST).
      await page.goto(role.starts[0] ?? '/');
      expect(pathOf(page)).toBe(role.starts[0]);
    });
  }
});
