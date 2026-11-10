#!/usr/bin/env node
/**
 * Partner-area walk-through (Playwright library, same contract as the other *.e2e.mjs here):
 *
 *   export default async ({ browser, baseUrl, check, login }) => { … }
 *
 * Run it on its own against a dev server whose database holds the demo seed:
 *
 *   E2E_BASE_URL=http://localhost:3130 node tests/e2e/walkthroughs/partner.e2e.mjs
 *
 * It signs in as the demo merchant and the demo agent and exercises the real pages and the
 * public API: dashboard, transactions, commissions, settlements, API keys (secret shown once,
 * revoke), every /api/v1 endpoint including an idempotent replay, webhook endpoints with a local
 * receiver that verifies the signature (test event, failed delivery, retry), agent cash-in and
 * cash-out verification, the public application form, /roadmap, /status and the PWA manifest.
 * It mutates the demo data, so point it at a disposable database.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const stamp = Date.now().toString(36);
const visible = (locator) =>
  locator
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(
      () => true,
      () => false,
    );

/** A local webhook receiver that records deliveries and can be told to fail. */
function startReceiver() {
  const received = [];
  const state = { failing: false };
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        headers: request.headers,
        rawBody: Buffer.concat(chunks).toString('utf8'),
      });
      response.statusCode = state.failing ? 500 : 200;
      response.end(state.failing ? 'receiver is failing on purpose' : 'ok');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        received,
        state,
        url: `http://127.0.0.1:${server.address().port}/hooks/bi-rem`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/** The verification every partner is told to implement (see /partner/docs). */
function signatureIsValid(rawBody, header, secret) {
  const parts = Object.fromEntries(
    String(header ?? '')
      .split(',')
      .map((part) => part.trim().split('=')),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, 'hex'));
}

export default async function partnerWalkthrough({ browser, baseUrl, check, login }) {
  const receiver = await startReceiver();
  try {
    await merchantJourney({ browser, baseUrl, check, login, receiver });
    await agentJourney({ browser, baseUrl, check, login });
    await publicPages({ browser, baseUrl, check, login });
  } finally {
    await receiver.close();
  }
}

async function merchantJourney({ browser, baseUrl, check, login, receiver }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await login(context, 'partner@bi-rem.local');
  const api = context.request;
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));

  // --- Dashboard ---------------------------------------------------------------------------
  check('partner lands on the dashboard', new URL(page.url()).pathname === '/partner');
  check('dashboard shows the payment code', await visible(page.getByTestId('partner-code')));
  check(
    'dashboard shows balance, volume and commission tiles',
    (await visible(page.getByText('Settlement balance'))) &&
      (await visible(page.getByText('Commission accrued'))) &&
      (await visible(page.getByText('Received · 30 days'))),
  );
  check('dashboard lists recent transactions', (await page.locator('table tbody tr').count()) > 0);

  // --- Transactions ------------------------------------------------------------------------
  await page.goto(`${baseUrl}/partner/transactions?direction=received`);
  const rows = page.locator('table tbody tr');
  check('transactions list has received payments', (await rows.count()) > 0);
  await rows.first().getByRole('link').first().click();
  await page.waitForURL(/\/partner\/transactions\/[0-9a-f-]{36}$/);
  check('transaction detail shows the timeline', await visible(page.getByText('Timeline')));
  const foreign = await page.goto(
    `${baseUrl}/partner/transactions/00000000-0000-4000-8000-000000000000`,
  );
  check(
    'an unknown transaction is a 404',
    foreign?.status() === 404,
    `status ${foreign?.status()}`,
  );

  await page.goto(`${baseUrl}/partner/commissions`);
  check('commissions page lists lines', (await page.locator('table tbody tr').count()) > 0);
  await page.goto(`${baseUrl}/partner/settlements`);
  check('settlements page shows a paid settlement', await visible(page.getByText(/^SET-/)));
  check(
    'settlements page shows the wallet statement',
    await visible(page.getByText(/Wallet statement/)),
  );

  // --- API keys ----------------------------------------------------------------------------
  await page.goto(`${baseUrl}/partner/api-keys`);
  await page.getByLabel('Key name').fill(`e2e full ${stamp}`);
  for (const scope of ['transfers:write', 'wallets:read', 'quotes:write']) {
    await page.getByRole('checkbox', { name: scope }).check();
  }
  await page.getByRole('button', { name: 'Create API key' }).click();
  const secretBox = page.getByTestId('api-key-secret');
  check('the new API key is displayed once', await visible(secretBox));
  const apiKey = ((await secretBox.textContent()) ?? '').trim();
  check('the key has the documented format', /^brl_[a-z0-9]{8}_[A-Za-z0-9_-]{20,}$/.test(apiKey));
  await page.reload();
  check(
    'after a reload only the prefix is listed, never the key',
    !(await page.content()).includes(apiKey) &&
      (await visible(page.getByText(`${apiKey.split('_').slice(0, 2).join('_')}_…`))),
  );

  await page.getByLabel('Key name').fill(`e2e read-only ${stamp}`);
  await page.getByRole('button', { name: 'Create API key' }).click();
  const readOnlyKey = ((await page.getByTestId('api-key-secret').textContent()) ?? '').trim();

  // --- Public API --------------------------------------------------------------------------
  const auth = { authorization: `Bearer ${apiKey}` };
  const v1 = `${baseUrl}/api/v1`;

  const anonymous = await api.get(`${v1}/me`);
  const anonymousBody = await anonymous.json();
  check(
    'the API refuses a request without a key (401 problem+json)',
    anonymous.status() === 401 &&
      (anonymous.headers()['content-type'] ?? '').includes('application/problem+json') &&
      anonymousBody.code === 'UNAUTHENTICATED',
    `status ${anonymous.status()}`,
  );
  const garbage = await api.get(`${v1}/me`, {
    headers: { authorization: `Bearer brl_aaaaaaaa_${'x'.repeat(43)}` },
  });
  check('the API refuses an unknown key', garbage.status() === 401);

  const me = await (await api.get(`${v1}/me`, { headers: auth })).json();
  check(
    'GET /me returns the partner and its wallet',
    me.data?.partner?.code === 'M-DEMO01' && /^\d+$/.test(me.data?.wallets?.[0]?.balance ?? ''),
  );
  const balanceBefore = BigInt(me.data.wallets[0].balance);

  const providers = await (await api.get(`${v1}/providers?country=CM`, { headers: auth })).json();
  check(
    'GET /providers lists simulated Cameroon providers',
    providers.data?.length > 0 &&
      providers.data.every((p) => p.countryCode === 'CM' && p.simulated),
  );
  const rate = await (await api.get(`${v1}/rates?from=XAF&to=AOA`, { headers: auth })).json();
  check(
    'GET /rates returns mid and customer rate as strings',
    typeof rate.data?.midRate === 'string' && typeof rate.data?.rate === 'string',
  );
  const badRate = await api.get(`${v1}/rates?from=XXX`, { headers: auth });
  check('GET /rates validates currencies', badRate.status() === 400);

  const quote = await api.post(`${v1}/quotes`, {
    headers: auth,
    data: { recipient: { type: 'wallet', identifier: 'joao@example.com' }, amount: '50000' },
  });
  const quoteBody = await quote.json();
  check(
    'POST /quotes locks an international price',
    quote.status() === 201 &&
      quoteBody.data?.international === true &&
      /^[0-9a-f-]{36}$/.test(quoteBody.data?.quoteId ?? ''),
    `status ${quote.status()}`,
  );

  const transferBody = {
    recipient: { type: 'wallet', identifier: '+237699000101' },
    amount: '1500',
    note: `e2e ${stamp}`,
  };
  const noKey = await api.post(`${v1}/transfers`, { headers: auth, data: transferBody });
  check('POST /transfers requires an Idempotency-Key', noKey.status() === 400);
  const floatAmount = await api.post(`${v1}/transfers`, {
    headers: { ...auth, 'idempotency-key': `e2e-float-${stamp}` },
    data: { ...transferBody, amount: 15.5 },
  });
  check('POST /transfers rejects a float amount', floatAmount.status() === 400);

  const idempotencyKey = `e2e-${stamp}-${randomUUID()}`;
  const created = await api.post(`${v1}/transfers`, {
    headers: { ...auth, 'idempotency-key': idempotencyKey },
    data: transferBody,
  });
  const createdBody = await created.json();
  check(
    'POST /transfers sends from the partner wallet',
    created.status() === 201 &&
      createdBody.data?.status === 'COMPLETED' &&
      createdBody.data?.sendAmount === '1500',
    `status ${created.status()} ${JSON.stringify(createdBody).slice(0, 200)}`,
  );
  const reference = createdBody.data?.reference;
  const replay = await api.post(`${v1}/transfers`, {
    headers: { ...auth, 'idempotency-key': idempotencyKey },
    data: transferBody,
  });
  const replayBody = await replay.json();
  check(
    'replaying the same Idempotency-Key returns the original transfer',
    replay.status() === 200 &&
      replay.headers()['idempotent-replayed'] === 'true' &&
      replayBody.data?.id === createdBody.data?.id,
  );
  const meAfter = await (await api.get(`${v1}/me`, { headers: auth })).json();
  check(
    'the wallet was debited exactly once',
    balanceBefore - BigInt(meAfter.data.wallets[0].balance) === BigInt(createdBody.data.totalDebit),
    `before ${balanceBefore} after ${meAfter.data.wallets[0].balance}`,
  );
  const conflict = await api.post(`${v1}/transfers`, {
    headers: { ...auth, 'idempotency-key': idempotencyKey },
    data: { ...transferBody, amount: '1600' },
  });
  check('reusing the key for another amount is a 409', conflict.status() === 409);

  const one = await api.get(`${v1}/transfers/${reference}`, { headers: auth });
  const oneBody = await one.json();
  check(
    'GET /transfers/{reference} returns the transfer with its timeline',
    one.status() === 200 &&
      oneBody.data?.reference === reference &&
      oneBody.data?.timeline?.length > 0,
  );
  const missing = await api.get(`${v1}/transfers/BR0000000000`, { headers: auth });
  check('an unknown reference is a 404 problem', missing.status() === 404);
  const list = await (
    await api.get(`${v1}/transfers?direction=sent&pageSize=5`, { headers: auth })
  ).json();
  check(
    'GET /transfers lists with pagination',
    list.data?.[0]?.reference === reference && list.pagination?.pageSize === 5,
  );
  const forbidden = await api.post(`${v1}/transfers`, {
    headers: { authorization: `Bearer ${readOnlyKey}`, 'idempotency-key': `e2e-ro-${stamp}` },
    data: transferBody,
  });
  check('a read-only key cannot send (403)', forbidden.status() === 403);
  const payout = await api.post(`${v1}/transfers`, {
    headers: { ...auth, 'idempotency-key': `e2e-payout-${stamp}` },
    data: {
      recipient: {
        type: 'mobile_money',
        provider: 'mtn-momo-cm',
        accountNumber: '237677120003',
        name: 'E2E Pending',
      },
      amount: '1000',
    },
  });
  const payoutBody = await payout.json();
  check(
    'a mobile-money payout to a …0003 account stays PROCESSING',
    payout.status() === 201 && payoutBody.data?.status === 'PROCESSING',
    `status ${payout.status()} ${payoutBody.data?.status ?? payoutBody.code}`,
  );
  if (payoutBody.data?.reference) {
    const refreshed = await api.post(`${v1}/transfers/${payoutBody.data.reference}/refresh`, {
      headers: auth,
    });
    const refreshedBody = await refreshed.json();
    check(
      'POST /transfers/{reference}/refresh completes it',
      refreshed.status() === 200 && refreshedBody.data?.status === 'COMPLETED',
      `status ${refreshed.status()} ${refreshedBody.data?.status}`,
    );
  }
  const openapi = await (await api.get(`${v1}/openapi.json`)).json();
  check(
    'OpenAPI document is served',
    openapi.openapi === '3.1.0' && '/api/v1/transfers' in openapi.paths,
  );

  // --- Webhooks ----------------------------------------------------------------------------
  await page.goto(`${baseUrl}/partner/webhooks`);
  await page.getByLabel('Endpoint URL').fill(receiver.url);
  await page.getByLabel('Description').fill(`e2e ${stamp}`);
  await page.getByRole('checkbox', { name: 'transfer.completed' }).check();
  await page.getByRole('button', { name: 'Add endpoint' }).click();
  const whBox = page.getByTestId('webhook-secret');
  check('the webhook signing secret is displayed once', await visible(whBox));
  const webhookSecret = ((await whBox.textContent()) ?? '').trim();
  await page.reload();
  check(
    'the signing secret is gone after a reload',
    !(await page.content()).includes(webhookSecret),
  );

  await page.getByRole('button', { name: 'Send test event' }).first().click();
  check(
    'a test event is delivered',
    await visible(page.getByTestId('delivery-outcome').filter({ hasText: 'Delivered (HTTP 200)' })),
  );
  const test = receiver.received.at(-1);
  check(
    'the delivery carries a valid HMAC-SHA256 signature',
    Boolean(test) &&
      signatureIsValid(test.rawBody, test.headers['x-birem-signature'], webhookSecret),
  );
  check(
    'a tampered body does not verify',
    Boolean(test) &&
      !signatureIsValid(`${test.rawBody} `, test.headers['x-birem-signature'], webhookSecret),
  );
  check(
    'the delivery names its event',
    test?.headers['x-birem-event'] === 'webhook.test' &&
      JSON.parse(test.rawBody).type === 'webhook.test',
  );

  receiver.state.failing = true;
  await page.getByRole('button', { name: 'Send test event' }).first().click();
  check(
    'a failing endpoint is reported',
    await visible(page.getByTestId('delivery-outcome').filter({ hasText: 'Not delivered' })),
  );
  await page.reload();
  check(
    'the failed delivery is in the log',
    await visible(page.getByRole('cell', { name: /HTTP 500/ })),
  );
  receiver.state.failing = false;
  const before = receiver.received.length;
  await page
    .getByRole('button', { name: /^Retry/ })
    .first()
    .click();
  // The action refreshes the log: the failed row is now marked as retried, above it sits the
  // new delivered row.
  check(
    'retrying a failed delivery succeeds',
    await visible(page.getByRole('row', { name: /HTTP 500/ }).getByText('Retried')),
  );
  check('the retry reached the receiver', receiver.received.length === before + 1);

  const beforeTransfer = receiver.received.length;
  const hooked = await api.post(`${v1}/transfers`, {
    headers: { ...auth, 'idempotency-key': `e2e-hook-${stamp}` },
    data: { ...transferBody, amount: '1200' },
  });
  const hookedBody = await hooked.json();
  const event = receiver.received
    .slice(beforeTransfer)
    .map((delivery) => ({ ...delivery, json: JSON.parse(delivery.rawBody) }))
    .find((delivery) => delivery.json.type === 'transfer.completed');
  check(
    'a transfer state change fires a signed transfer.completed webhook',
    hooked.status() === 201 &&
      event?.json.data.reference === hookedBody.data?.reference &&
      signatureIsValid(event.rawBody, event.headers['x-birem-signature'], webhookSecret),
  );

  await page.reload();
  await page.getByRole('button', { name: 'Pause' }).first().click();
  check('an endpoint can be paused', await visible(page.getByText('Paused')));
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).first().click();
  check('an endpoint can be deleted', await visible(page.getByText('No endpoint yet')));

  // --- Revocation --------------------------------------------------------------------------
  await page.goto(`${baseUrl}/partner/api-keys`);
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('row', { name: new RegExp(`e2e full ${stamp}`) })
    .getByRole('button', { name: /Revoke/ })
    .click();
  await visible(
    page.getByRole('row', { name: new RegExp(`e2e full ${stamp}`) }).getByText(/Revoked/),
  );
  const revoked = await api.get(`${v1}/me`, { headers: auth });
  check(
    'a revoked key stops working immediately',
    revoked.status() === 401,
    `status ${revoked.status()}`,
  );

  // --- Docs, profile, boundaries -----------------------------------------------------------
  await page.goto(`${baseUrl}/partner/docs`);
  check(
    'the API reference documents curl examples and signature verification',
    (await visible(page.getByText('Verify every delivery'))) &&
      (await page.content()).includes('Idempotency-Key') &&
      (await page.content()).includes('timingSafeEqual'),
  );
  await page.goto(`${baseUrl}/partner/profile`);
  check(
    'profile shows business details and security',
    await visible(page.getByText('Two-factor authentication')),
  );
  const float = await page.goto(`${baseUrl}/partner/float`);
  check('a merchant has no agent desk', float?.status() === 404, `status ${float?.status()}`);
  await page.goto(`${baseUrl}/admin`);
  check(
    'a partner cannot open the back office',
    !new URL(page.url()).pathname.startsWith('/admin'),
  );
  check('no client-side error in the merchant journey', problems.length === 0, problems[0]);
  await context.close();
}

async function agentJourney({ browser, baseUrl, check, login }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let page;
  try {
    page = await login(context, 'agent@bi-rem.local');
  } catch {
    check(
      'demo agent can sign in (agent@bi-rem.local)',
      false,
      'login failed — reseed the demo data',
    );
    await context.close();
    return;
  }
  await page.goto(`${baseUrl}/partner/float`);
  check('the agent sees the float wallet', await visible(page.getByText('Float balance')));
  const floatBefore = await page.locator('text=Float balance').locator('..').textContent();

  await page.getByLabel('Customer phone number or e-mail').fill('+237699000101');
  await page.getByLabel(/Cash received/).fill('2 500');
  await page.getByRole('button', { name: 'Review cash-in' }).click();
  check(
    'cash-in shows the customer before anything moves',
    await visible(page.getByTestId('cash-in-preview')),
  );
  check(
    'the preview names the customer',
    ((await page.getByTestId('cash-in-preview').textContent()) ?? '').includes('Amina'),
  );
  await page.getByRole('button', { name: 'Confirm cash-in' }).click();
  check('cash-in credits the customer', await visible(page.getByTestId('cash-in-result')));
  check(
    'cash-in completed through the transfer engine',
    ((await page.getByTestId('cash-in-result').textContent()) ?? '').includes('Completed'),
  );
  await page.reload();
  const floatAfter = await page.locator('text=Float balance').locator('..').textContent();
  check('the float went down', floatBefore !== floatAfter, `${floatBefore} → ${floatAfter}`);

  await page.getByLabel('Customer phone number or e-mail').fill('joao@example.com');
  await page.getByLabel(/Cash received/).fill('1000');
  await page.getByRole('button', { name: 'Review cash-in' }).click();
  check(
    'cash-in to a customer abroad is refused',
    await visible(page.getByText(/Cash-in is domestic/)),
  );

  // Cash-out: verify a payment a customer sent to the agent code.
  await page.goto(`${baseUrl}/partner/transactions?direction=received`);
  const reference = ((await page.locator('table tbody tr a').first().textContent()) ?? '').trim();
  await page.goto(`${baseUrl}/partner/float`);
  await page.getByLabel('Transfer reference').fill(reference);
  await page.getByRole('button', { name: 'Verify payment' }).click();
  check(
    'a received payment is confirmed for cash-out',
    await visible(page.getByTestId('cash-out-result')),
  );
  await page.getByLabel('Transfer reference').fill('BR0000000000');
  await page.getByRole('button', { name: 'Verify payment' }).click();
  check(
    'an unknown reference is refused for cash-out',
    await visible(page.getByText('No completed payment to you with this reference')),
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('the agent desk fits a 390 px screen', overflow <= 0, `overflow ${overflow}px`);
  await context.close();
}

async function publicPages({ browser, baseUrl, check, login }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  // --- Self-serve application --------------------------------------------------------------
  const legacy = await page.goto(`${baseUrl}/partners/apply`);
  check(
    '/partners/apply leads to the application form',
    new URL(page.url()).pathname === '/apply' && legacy?.ok(),
  );
  const email = `apply-${stamp}@e2e.test`;
  await page.getByLabel('Partner type').selectOption('MERCHANT');
  await page.getByLabel('Business name').fill(`E2E Boutique ${stamp}`);
  await page.getByLabel('Country of operation').selectOption('CM');
  await page.getByLabel('Your full name').fill('E2E Applicant');
  await page.getByLabel('Work e-mail').fill(email);
  await page.locator('input[name="password"]').fill('short');
  await page.locator('input[name="confirmPassword"]').fill('short');
  await page.getByRole('checkbox', { name: /authorised/ }).check();
  await page.locator('form').evaluate((form) => form.setAttribute('novalidate', ''));
  await page.getByRole('button', { name: 'Send application' }).click();
  check(
    'a weak password is rejected by the server',
    await visible(page.getByText('Use at least 10 characters')),
  );
  await page.locator('input[name="password"]').fill('ChangeMe123!');
  await page.locator('input[name="confirmPassword"]').fill('ChangeMe123!');
  await page.getByRole('button', { name: 'Send application' }).click();
  await page.waitForURL(/\/apply\/submitted$/, { timeout: 30_000 });
  check('the application is acknowledged', await visible(page.getByText('Application received')));

  const applicantContext = await browser.newContext();
  const applicant = await login(applicantContext, email);
  check(
    'the applicant can sign in and sees the pending banner',
    new URL(applicant.url()).pathname === '/partner' &&
      (await visible(applicant.getByText('Your application is under review'))),
  );
  await applicant.goto(`${baseUrl}/partner/api-keys`);
  check(
    'a pending partner cannot create API keys',
    await applicant.getByRole('button', { name: 'Create API key' }).isDisabled(),
  );
  await applicantContext.close();

  // --- Roadmap, status, PWA ----------------------------------------------------------------
  await page.goto(`${baseUrl}/roadmap`);
  check('roadmap lists the 13 phases', (await page.locator('[id^="phase-"]').count()) === 13);
  check(
    'roadmap has the compact timeline',
    await visible(page.getByRole('img', { name: /timeline/i })),
  );
  const roadmapOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('roadmap fits a 390 px screen', roadmapOverflow <= 0, `overflow ${roadmapOverflow}px`);
  const full = await context.request.get(`${baseUrl}/roadmap-full.html`);
  const fullHtml = await full.text();
  check(
    'the full interactive roadmap is served',
    full.status() === 200 && fullHtml.includes('BI-Rem'),
  );
  check('the full roadmap has no ../phases links left', !fullHtml.includes('../phases/'));

  await page.goto(`${baseUrl}/status`);
  check('status page reports the database', await visible(page.getByText('Database')));
  check('status page shows build information', await visible(page.getByText('Build')));
  check('status page states the availability target', await visible(page.getByText(/99\.9/)));
  const statusOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('status fits a 390 px screen', statusOverflow <= 0, `overflow ${statusOverflow}px`);

  const manifest = await (await context.request.get(`${baseUrl}/manifest.webmanifest`)).json();
  check(
    'the web app manifest is installable',
    manifest.display === 'standalone' &&
      manifest.theme_color === '#0B6E4F' &&
      manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'),
  );
  for (const icon of manifest.icons) {
    const response = await context.request.get(`${baseUrl}${icon.src}`);
    check(`icon ${icon.src} is served`, response.status() === 200);
  }
  await page.goto(`${baseUrl}/`);
  check(
    'theme colour and apple touch icon are declared',
    (await page.locator('meta[name="theme-color"]').count()) > 0 &&
      (await page.locator('link[rel="apple-touch-icon"]').count()) > 0,
  );
  check(
    'the footer says native apps are on the roadmap',
    await visible(page.getByText(/Native .*apps.*phase 11/i)),
  );
  await context.close();
}

// ---------------------------------------------------------------------------
// Stand-alone runner
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.env.E2E_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) {
    process.stdout.write('partner e2e: skipped (set E2E_BASE_URL to a running BI-Rem Lite)\n');
    process.exit(0);
  }
  const { chromium } = createRequire(import.meta.url)('@playwright/test');
  const password = process.env.E2E_PASSWORD ?? 'ChangeMe123!';
  const browser = await chromium.launch();
  const results = [];
  const check = (name, condition, detail = '') => {
    results.push(Boolean(condition));
    process.stdout.write(
      `${condition ? '  ✓' : '  ✗'} ${name}${condition || !detail ? '' : ` — ${detail}`}\n`,
    );
  };
  const login = async (context, email) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/login`);
    await page.getByLabel('E-mail').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
    return page;
  };
  try {
    await partnerWalkthrough({ browser, baseUrl, check, login });
  } catch (error) {
    check(
      'walk-through ran to completion',
      false,
      error instanceof Error ? error.message.split('\n')[0] : String(error),
    );
  }
  await browser.close();
  const failed = results.filter((ok) => !ok).length;
  process.stdout.write(`\npartner e2e: ${results.length - failed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}
