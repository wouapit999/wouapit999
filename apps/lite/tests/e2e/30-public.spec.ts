import { expect, test } from './support';

/**
 * Public surface: landing, programme roadmap (kept in step with docs/roadmap), status page,
 * health endpoint, security headers and the installable PWA shell.
 */

const overflow = (): number =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth;

test('/roadmap renders the 13 phases from the programme schedule', async ({ page, watch }) => {
  watch(page);
  await page.goto('/roadmap');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const phases = page.locator('[id^="phase-"]');
  await expect(phases).toHaveCount(13);
  // Every phase shows its dates and what Lite implements of it.
  for (const id of ['phase-1', 'phase-6', 'phase-13']) {
    const phase = page.locator(`[id="${id}"]`);
    await expect(phase).toContainText(/20\d\d/);
    await expect(phase).toContainText(/Lite/);
  }
  await expect(page.getByRole('img', { name: /timeline/i })).toBeVisible();

  // The full interactive roadmap from docs/ is served as a static file and linked.
  const link = page.locator('a[href="/roadmap-full.html"]').first();
  await expect(link).toBeVisible();
  const full = await page.request.get('/roadmap-full.html');
  expect(full.status()).toBe(200);
  const html = await full.text();
  expect(html).toContain('BI-Rem');
  expect(html).not.toContain('../phases/');
});

test('/status and /api/health report a healthy platform', async ({ page, watch, request }) => {
  watch(page);
  await page.goto('/status');
  await expect(page.getByText('All systems operational')).toBeVisible();
  await expect(page.getByText('Database').first()).toBeVisible();
  // Operators are simulators and the status page says so.
  await expect(page.getByText(/simulat/i).first()).toBeVisible();

  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(health.headers()['cache-control']).toContain('no-store');
  const body = (await health.json()) as {
    status: string;
    checks: { database: { status: string } };
  };
  expect(body.status).toBe('ok');
  expect(body.checks.database.status).toBe('up');
});

test('security headers, correlation id and the PWA manifest are served', async ({ request }) => {
  const response = await request.get('/');
  const headers = response.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['strict-transport-security']).toContain('max-age=');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-request-id']).toMatch(/^[A-Za-z0-9._-]{8,100}$/);
  expect(headers['x-powered-by']).toBeUndefined();

  const echoed = await request.get('/api/health', {
    headers: { 'x-request-id': 'e2e-correlation-0001' },
  });
  expect(echoed.headers()['x-request-id']).toBe('e2e-correlation-0001');

  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
    display: string;
    theme_color: string;
    icons: Array<{ src: string; sizes: string; purpose?: string }>;
  };
  expect(manifest.display).toBe('standalone');
  expect(manifest.theme_color).toBe('#0B6E4F');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  }
});

test('public pages fit a phone and say what is simulated', async ({ browser, watch }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = watch(await context.newPage());
  for (const path of ['/', '/roadmap', '/status', '/login', '/register', '/apply']) {
    await page.goto(path);
    expect(await page.evaluate(overflow), `${path} scrolls sideways at 390 px`).toBeLessThanOrEqual(
      0,
    );
  }
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/simulated/i).first()).toBeVisible();
  // Phase 11: native apps are a roadmap item, and the UI says so.
  await expect(page.getByText(/Native .*apps/i).first()).toBeVisible();
  await page.goto('/login');
  await expect(page.getByText('Demo accounts')).toBeVisible();
  await context.close();
});

test('an unknown address is a real 404', async ({ page, request }) => {
  const response = await request.get('/definitely-not-a-page');
  expect(response.status()).toBe(404);
  await page.goto('/definitely-not-a-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
