import type { APIResponse, Page, Request } from '@playwright/test';

import { BASE_URL } from './env';
import { expect, pageState, pathOf, test } from './support';

/**
 * Authorisation is enforced on the server (SPEC "Money movement rules" §8): a customer can only
 * ever see their own transfers, wallets and documents; each area is closed to the other roles;
 * back-office sections follow the permission map; and a server action replayed with someone
 * else's session does nothing.
 */

const ADMIN_PAGES = [
  '/admin',
  '/admin/transfers',
  '/admin/customers',
  '/admin/kyc',
  '/admin/compliance',
  '/admin/audit',
  '/admin/providers',
  '/admin/providers/new',
  '/admin/countries',
  '/admin/fees',
  '/admin/fx',
  '/admin/treasury',
  '/admin/reconciliation',
  '/admin/partners',
  '/admin/partners/new',
  '/admin/reports',
  '/admin/users',
  '/admin/settings',
  '/admin/security',
  '/admin/notifications',
  '/admin/aml',
] as const;

const PARTNER_PAGES = [
  '/partner',
  '/partner/transactions',
  '/partner/commissions',
  '/partner/settlements',
  '/partner/api-keys',
  '/partner/webhooks',
  '/partner/docs',
  '/partner/profile',
  '/partner/float',
] as const;

const CUSTOMER_PAGES = [
  '/app',
  '/app/send',
  '/app/wallets',
  '/app/wallets/topup',
  '/app/transfers',
  '/app/beneficiaries',
  '/app/kyc',
  '/app/notifications',
  '/app/profile',
  '/app/security',
] as const;

/** Href of the first item in Amina's history that João has nothing to do with. */
async function aminaOnlyTransfer(amina: Page): Promise<string> {
  await amina.goto('/app/transfers?type=W2M'); // merchant payments: João is never a party
  const link = amina
    .getByRole('list', { name: 'Transfers' })
    .locator('a[href^="/app/transfers/"]')
    .first();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^\/app\/transfers\/[0-9a-f-]{36}$/);
  return href ?? '';
}

test.describe('a customer only sees their own data', () => {
  test("another customer's transfer, receipt and receipt PDF are not found", async ({
    session,
  }) => {
    const amina = await session('amina');
    const transferPath = await aminaOnlyTransfer(amina);

    // The owner can open all three.
    await amina.goto(transferPath);
    expect(await pageState(amina)).toBe('ok');
    await expect(amina.getByRole('list', { name: 'Tracking timeline' })).toBeVisible();
    expect((await amina.request.get(`${transferPath}/receipt/pdf`)).status()).toBe(200);

    // Another customer gets the same answer as for an id that does not exist.
    const joao = await session('joao');
    await joao.goto(transferPath);
    expect(await pageState(joao)).toBe('not-found');
    await expect(joao.getByRole('list', { name: 'Tracking timeline' })).toHaveCount(0);
    await expect(joao.getByText('Total debited')).toHaveCount(0);

    await joao.goto(`${transferPath}/receipt`);
    expect(await pageState(joao)).toBe('not-found');
    await expect(joao.getByText('Total paid')).toHaveCount(0);

    expect((await joao.request.get(`${transferPath}/receipt/pdf`)).status()).toBe(404);
  });

  test("another customer's wallet statement is not found", async ({ session }) => {
    const amina = await session('amina');
    await amina.goto('/app/wallets');
    const walletPath = await amina
      .getByRole('link', { name: 'Statement' })
      .first()
      .getAttribute('href');
    expect(walletPath).toMatch(/^\/app\/wallets\/[0-9a-f-]{36}$/);

    const joao = await session('joao');
    await joao.goto(walletPath ?? '');
    expect(await pageState(joao)).toBe('not-found');
  });

  test("another customer's KYC document is not served", async ({ session }) => {
    const compliance = await session('compliance');
    await compliance.goto('/admin/kyc?status=ALL');
    await compliance.getByRole('link', { name: /Maria/ }).first().click();
    await compliance.waitForURL(/\/admin\/kyc\/[0-9a-f-]{36}$/);
    const reviewerPath = await compliance
      .locator('a[href^="/admin/kyc/documents/"]')
      .first()
      .getAttribute('href');
    const documentId = reviewerPath?.split('/').pop() ?? '';
    expect(documentId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await compliance.request.get(reviewerPath ?? '')).status()).toBe(200);

    const amina = await session('amina');
    const asOwnerRoute = await amina.request.get(`/app/kyc/documents/${documentId}`);
    expect(asOwnerRoute.status()).toBe(404);
    const asReviewerRoute = await amina.request.get(`/admin/kyc/documents/${documentId}`, {
      maxRedirects: 0,
    });
    expect(asReviewerRoute.status()).not.toBe(200);
    expect(asReviewerRoute.headers()['content-type'] ?? '').not.toContain('image/');
  });
});

test.describe('each area is closed to the other roles', () => {
  test('a customer cannot open any back-office or partner page', async ({ session }) => {
    const amina = await session('amina');
    for (const path of [...ADMIN_PAGES, ...PARTNER_PAGES]) {
      const response = await amina.goto(path);
      expect(pathOf(amina), `${path} must send a customer back to /app`).toBe('/app');
      expect(response?.status(), path).toBe(200);
      await expect(amina.getByRole('heading', { level: 1 })).toContainText('Hello');
    }
    // Route handlers answer with a status, not a redirect to something readable.
    for (const format of ['csv', 'xlsx', 'pdf']) {
      const exported = await amina.request.get(`/api/exports/transfers?format=${format}`);
      expect(exported.status(), `export ${format}`).toBe(403);
    }
    expect((await amina.request.get('/api/exports/audit?format=csv')).status()).toBe(403);
  });

  test('a partner cannot open the back office or the customer area', async ({ session }) => {
    const partner = await session('partner');
    for (const path of [...ADMIN_PAGES, ...CUSTOMER_PAGES]) {
      await partner.goto(path);
      expect(pathOf(partner), `${path} must send a partner back to /partner`).toBe('/partner');
    }
    expect((await partner.request.get('/api/exports/transfers?format=csv')).status()).toBe(403);
    // A merchant has no agent desk.
    await partner.goto('/partner/float');
    expect(await pageState(partner)).toBe('not-found');
  });

  test('staff cannot open the customer area or the partner portal', async ({ session }) => {
    const admin = await session('admin');
    for (const path of [...CUSTOMER_PAGES, ...PARTNER_PAGES]) {
      await admin.goto(path);
      expect(pathOf(admin), `${path} must send staff back to /admin`).toBe('/admin');
    }
  });

  test('a signed-out visitor is sent to sign in and gets no data', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const path of [...ADMIN_PAGES, ...PARTNER_PAGES, ...CUSTOMER_PAGES]) {
      await page.goto(path);
      expect(pathOf(page), path).toBe('/login');
      expect(new URL(page.url()).searchParams.get('next'), path).toBe(path);
    }
    expect((await context.request.get('/api/exports/transfers?format=csv')).status()).toBe(401);
    expect((await context.request.get('/api/v1/me')).status()).toBe(401);
    expect((await context.request.get('/api/v1/transfers')).status()).toBe(401);
    const document = await context.request.get(
      '/admin/kyc/documents/00000000-0000-4000-8000-000000000000',
      { maxRedirects: 0 },
    );
    expect(document.status()).not.toBe(200);
    await context.close();
  });
});

test.describe('back-office sections follow the permission map', () => {
  const matrix: ReadonlyArray<{
    account: string;
    allowed: readonly string[];
    denied: readonly string[];
    exports: Readonly<Record<string, number>>;
  }> = [
    {
      account: 'compliance',
      allowed: ['/admin/kyc', '/admin/compliance', '/admin/audit', '/admin/customers'],
      denied: ['/admin/treasury', '/admin/users', '/admin/settings'],
      exports: { audit: 200, compliance: 200, treasury: 403 },
    },
    {
      account: 'treasury',
      allowed: ['/admin/fx', '/admin/fees', '/admin/treasury', '/admin/reports'],
      denied: ['/admin/compliance', '/admin/audit', '/admin/users', '/admin/settings'],
      exports: { treasury: 200, revenue: 200, audit: 403, compliance: 403 },
    },
    {
      account: 'support',
      allowed: ['/admin/transfers', '/admin/customers', '/admin/kyc', '/admin/reports'],
      denied: ['/admin/treasury', '/admin/audit', '/admin/users', '/admin/settings'],
      exports: { transfers: 403, revenue: 403, audit: 403 },
    },
  ];

  for (const row of matrix) {
    test(`${row.account}: pages, navigation and exports`, async ({ session }) => {
      const page = await session(row.account);
      await page.goto('/admin');
      const nav = page.getByRole('navigation', { name: 'Back office navigation' });
      for (const path of row.allowed) {
        await expect(nav.locator(`a[href="${path}"]`), `nav shows ${path}`).toHaveCount(1);
        await page.goto(path);
        expect(pathOf(page), path).toBe(path);
        expect(await pageState(page), path).toBe('ok');
      }
      for (const path of row.denied) {
        await expect(nav.locator(`a[href="${path}"]`), `nav hides ${path}`).toHaveCount(0);
        await page.goto(path);
        expect(pathOf(page), `${path} must send ${row.account} back to /admin`).toBe('/admin');
      }
      for (const [name, status] of Object.entries(row.exports)) {
        const response = await page.request.get(`/api/exports/${name}?format=csv`);
        expect(response.status(), `export ${name}`).toBe(status);
      }
    });
  }

  test('support sees reports but is offered no export', async ({ session }) => {
    const support = await session('support');
    await support.goto('/admin/reports?view=revenue');
    expect(await pageState(support)).toBe('ok');
    await expect(support.locator('a[data-export]')).toHaveCount(0);
    // Read-only on FX: the override form is not rendered.
    await support.goto('/admin/fx?base=XAF');
    await expect(support.getByRole('button', { name: 'Apply override' })).toHaveCount(0);
  });
});

test.describe('server actions authorise the caller, not the page', () => {
  /**
   * Captures the exact request the administrator's browser sends for an FX override (without
   * letting it through), then replays it with other sessions. Server actions can be POSTed to
   * any URL, so hiding the form is no protection: the action itself must refuse.
   */
  test('an FX override replayed by a customer, by support or without a session changes nothing', async ({
    session,
    browser,
  }) => {
    const admin = await session('admin');
    const marginCell = (): Promise<string> =>
      admin.locator('tr[data-fx-pair="XAF-MZN"] td').nth(2).innerText();

    await admin.goto('/admin/fx?base=XAF&edit=XAF-MZN', { waitUntil: 'networkidle' });
    const before = await marginCell();
    const marginBps = 777;
    expect(before).not.toContain(`(${marginBps} basis points)`);

    let captured: Request | undefined;
    await admin.route('**/admin/fx**', async (route) => {
      const request = route.request();
      if (request.method() === 'POST' && request.headers()['next-action']) {
        captured = request;
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await admin.getByLabel('Margin (basis points)').fill(String(marginBps));
    await admin.getByLabel('Reason for the override').fill('E2E: replayed by another session');
    await admin.getByRole('button', { name: 'Apply override' }).click();
    await expect.poll(() => captured).toBeDefined();
    await admin.unroute('**/admin/fx**');
    if (!captured) throw new Error('the override request was not captured');

    const headers = await captured.allHeaders();
    const replay = (page: Page, path: string): Promise<APIResponse> =>
      page.request.post(path, {
        headers: {
          'next-action': headers['next-action'] ?? '',
          'content-type': headers['content-type'] ?? '',
          accept: 'text/x-component',
          origin: new URL(BASE_URL).origin,
        },
        data: captured?.postDataBuffer() ?? Buffer.alloc(0),
        maxRedirects: 0,
      });

    const amina = await session('amina');
    const asCustomer = await replay(amina, '/app');
    expect(await asCustomer.text()).not.toContain('saved=XAF-MZN');

    const support = await session('support');
    const asSupport = await replay(support, '/admin/fx');
    expect(await asSupport.text()).toContain('You are not allowed to do this');

    const anonymousContext = await browser.newContext();
    const anonymous = await anonymousContext.newPage();
    const asNobody = await replay(anonymous, '/login');
    expect(await asNobody.text()).not.toContain('saved=XAF-MZN');
    await anonymousContext.close();

    await admin.goto('/admin/fx?base=XAF');
    expect(await marginCell()).toBe(before);

    // The same bytes with the administrator's own session do apply: the replay is a real call.
    const asAdmin = await replay(admin, '/admin/fx');
    expect(asAdmin.status()).toBeLessThan(400);
    await admin.goto('/admin/fx?base=XAF');
    expect(await marginCell()).toContain(`(${marginBps} basis points)`);
  });
});
