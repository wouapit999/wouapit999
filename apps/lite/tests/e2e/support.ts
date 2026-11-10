import { type BrowserContext, type Page, test as base, expect } from '@playwright/test';

import { DEMO_PASSWORD, storageStatePath } from './env';

/**
 * Shared fixtures.
 *
 * - `session(name)` opens a page already signed in as that account (storage state saved by
 *   `auth.setup.ts`, or by a test for an account it registered itself).
 * - `problems` collects uncaught browser exceptions and 5xx responses from every page opened
 *   through `session` / `watch`; the test fails if there is any.
 *
 * The fixture callback is called `provide` (Playwright's docs call it `use`) so that the React
 * Hooks lint rule does not take it for React's `use` hook.
 */

interface Fixtures {
  problems: string[];
  session: (name: string) => Promise<Page>;
  watch: (page: Page) => Page;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring pattern
  problems: async ({}, provide) => {
    const problems: string[] = [];
    await provide(problems);
    expect(problems, 'uncaught page errors or 5xx responses').toEqual([]);
  },
  watch: async ({ problems }, provide) => {
    await provide((page) => {
      page.on('pageerror', (error) => {
        problems.push(`${safePath(page)}: ${error.message}`);
      });
      page.on('response', (response) => {
        if (response.status() >= 500) {
          problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
        }
      });
      return page;
    });
  },
  session: async ({ browser, watch }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async (name) => {
      const context = await browser.newContext({
        storageState: storageStatePath(name),
        acceptDownloads: true,
      });
      contexts.push(context);
      return watch(await context.newPage());
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect };

function safePath(page: Page): string {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return page.url();
  }
}

export const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** Signs in through the real form and waits for the role's home area. */
export async function signIn(
  page: Page,
  email: string,
  password: string = DEMO_PASSWORD,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

/**
 * What the page turned out to be once fully loaded: pages stream, so a missing object or a
 * crashed render can arrive with status 200 — the rendered boundary is the proof.
 */
export async function pageState(page: Page): Promise<'ok' | 'not-found' | 'error'> {
  const marker = page.locator('[data-page-state]').first();
  if ((await marker.count()) === 0) return 'ok';
  const state = await marker.getAttribute('data-page-state');
  return state === 'not-found' || state === 'error' ? state : 'ok';
}

/** Parses a displayed amount such as "12 345 FCFA" or "1,234.56 Kz" into minor units. */
export function digitsOf(text: string): bigint {
  const digits = text.replace(/[^0-9]/g, '');
  if (digits === '') throw new Error(`No amount in "${text}"`);
  return BigInt(digits);
}
