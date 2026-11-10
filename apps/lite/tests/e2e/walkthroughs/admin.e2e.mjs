#!/usr/bin/env node
/**
 * Back-office walk-through (Playwright library, same contract as the other *.e2e.mjs here):
 *
 *   export default async ({ browser, baseUrl, check, login }) => { … }
 *
 * Run it on its own against a dev server whose database holds the demo seed:
 *
 *   E2E_BASE_URL=http://localhost:3120 node tests/e2e/walkthroughs/admin.e2e.mjs
 *
 * It signs in as the administrator, compliance, treasury and support demo users and exercises
 * the real pages: approves a KYC case, tests and configures a provider, overrides an FX margin,
 * releases a held transfer, files a SAR, funds a float, onboards a partner, and downloads every
 * export in CSV / Excel / PDF and checks each file is valid. It mutates the demo data, so point
 * it at a disposable database.
 */
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRequire = createRequire(join(here, '..', '..', '..', 'package.json'));

const REPORTS = [
  'transfers',
  'revenue',
  'corridors',
  'providers',
  'compliance',
  'treasury',
  'commissions',
  'audit',
];
const stamp = Date.now().toString(36);

/** Parses a CSV document (quoted fields, CRLF) into rows — enough to validate our exports. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function validateExport(format, body) {
  if (format === 'csv') {
    const text = body.toString('utf8');
    if (!text.startsWith('\uFEFF')) return 'missing UTF-8 BOM';
    const rows = parseCsv(text.slice(1));
    const header = rows[0] ?? [];
    if (header.length < 2 || header.some((cell) => cell.trim() === '')) return 'bad header row';
    const ragged = rows.find((row) => row.length !== header.length);
    return ragged ? `row with ${ragged.length} cells, header has ${header.length}` : null;
  }
  if (format === 'xlsx') {
    if (body.subarray(0, 2).toString('latin1') !== 'PK') return 'not a zip container';
    const ExcelJS = appRequire('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(body);
    const sheet = workbook.worksheets[0];
    if (!sheet) return 'no worksheet';
    return sheet.rowCount >= 1 && sheet.columnCount >= 2 ? null : 'empty worksheet';
  }
  if (body.subarray(0, 5).toString('latin1') !== '%PDF-') return 'missing %PDF- header';
  const { PDFDocument } = appRequire('pdf-lib');
  const pdf = await PDFDocument.load(body);
  return pdf.getPageCount() >= 1 ? null : 'no page';
}

export default async function backOfficeWalkthrough({ browser, baseUrl, check, login }) {
  const open = async (email) => {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await login(context, email);
    page.on('dialog', (dialog) => void dialog.accept());
    return { context, page };
  };
  const goto = async (page, path) => {
    const response = await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
    return response?.status() ?? 0;
  };
  const visible = (locator, timeout = 20_000) =>
    locator
      .first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  const heading = (page) => page.locator('h1').first().innerText();
  /** The confirmation shown after an action that redirects back with `?notice=`. */
  const notice = (page, text) =>
    visible(page.getByTestId('notice').filter({ hasText: text }), 30_000);

  // ------------------------------------------------------------------ administrator
  const admin = await open('admin@bi-rem.local');
  {
    const { page, context } = admin;
    check(
      'admin lands on the executive dashboard',
      (await heading(page)) === 'Executive dashboard',
    );
    const body = await page.locator('main').innerText();
    for (const kpi of [
      'VOLUME',
      'VALUE',
      'REVENUE',
      'FX PROFIT',
      'FAILED RATE',
      '(DAU)',
      '(MAU)',
    ]) {
      check(`dashboard shows ${kpi}`, body.toUpperCase().includes(kpi));
    }
    check('dashboard has accessible charts', (await page.locator('svg[role="img"]').count()) >= 2);
    check(
      'dashboard lists provider performance and country activity',
      body.includes('Provider performance') && body.includes('Country activity'),
    );

    for (const path of [
      '/admin/customers',
      '/admin/kyc',
      '/admin/providers',
      '/admin/transfers',
      '/admin/fees',
      '/admin/fx',
      '/admin/treasury',
      '/admin/compliance',
      '/admin/partners',
      '/admin/reports',
      '/admin/countries',
      '/admin/users',
      '/admin/audit',
      '/admin/notifications',
      '/admin/security',
      '/admin/settings',
    ]) {
      const status = await goto(page, path);
      const text = await page.locator('body').innerText();
      check(
        `admin can open ${path}`,
        status === 200 &&
          new URL(page.url()).pathname === path &&
          !/Something went wrong/i.test(text),
        `status ${status}, at ${page.url()}`,
      );
    }

    // Customers: search and 360° view.
    await goto(page, '/admin/customers?q=amina');
    const amina = page.getByRole('link', { name: /Amina/ });
    check('customer search finds Amina by name', await visible(amina));
    await goto(page, '/admin/customers?q=%2B237677000104');
    check(
      'customer search finds Samuel by phone',
      await visible(page.getByRole('link', { name: /Samuel/ })),
    );
    await goto(page, '/admin/customers?country=AO&kyc=VERIFIED');
    check(
      'customer filters by country and KYC status',
      await visible(page.getByRole('link', { name: /Jo/ })),
    );
    await goto(page, '/admin/customers?q=amina');
    await page.getByRole('link', { name: /Amina/ }).first().click();
    await page.waitForURL(/\/admin\/customers\/[0-9a-f-]{36}$/);
    const profile = await page.locator('main').innerText();
    for (const section of [
      'Wallets',
      'KYC history',
      'Risk profile',
      'Recent transfers',
      'Audit trail',
      'Limits',
    ]) {
      check(`customer 360° shows ${section}`, profile.includes(section));
    }
    const aminaUrl = page.url();

    // Suspend and reactivate another customer (Paul).
    await goto(page, '/admin/customers?q=paul%40example.com');
    await page.getByRole('link', { name: /Paul/ }).first().click();
    await page.waitForURL(/\/admin\/customers\/[0-9a-f-]{36}$/);
    await page.getByRole('heading', { name: 'Suspend account' }).waitFor();
    await page
      .locator('form:has(input[name="status"][value="SUSPENDED"]) textarea[name="reason"]')
      .fill('E2E: suspected account takeover');
    await page.getByRole('button', { name: 'Suspend account' }).click();
    check(
      'admin suspends a customer',
      await visible(page.getByRole('heading', { name: 'Reactivate account' })),
    );
    await page
      .locator('form:has(input[name="status"][value="ACTIVE"]) textarea[name="reason"]')
      .fill('E2E: identity confirmed by phone');
    await page.getByRole('button', { name: 'Reactivate account' }).click();
    check(
      'admin reactivates the customer',
      await visible(page.getByRole('heading', { name: 'Suspend account' })),
    );

    // Providers: connectivity test from the directory.
    await goto(page, '/admin/providers');
    const row = page.locator('tr[data-provider="mtn-momo-cm"]');
    await row.getByRole('button', { name: 'Test' }).click();
    const result = row.getByTestId('connectivity-result');
    check('provider connectivity test shows a result', await visible(result));
    const resultText = (await result.innerText().catch(() => '')).replace(/\s+/g, ' ');
    check(
      'connectivity result has status and latency',
      /Healthy/.test(resultText) && /\d+ ms/.test(resultText),
      resultText,
    );
    check('connectivity result is labelled simulated', /Simulated/.test(resultText), resultText);

    // Create a provider, store write-only secrets, rotate, disable.
    const providerCode = `e2e-sim-${stamp}`;
    await goto(page, '/admin/providers/new');
    const fillProvider = async (environment) => {
      await page.locator('input[name="code"]').fill(providerCode);
      await page.locator('input[name="name"]').fill('E2E Simulated Wallet');
      await page.locator('input[name="operator"]').fill('E2E Money');
      await page.locator('select[name="countryCode"]').selectOption('CM');
      await page.locator('select[name="currency"]').selectOption('XAF');
      await page.locator('select[name="adapter"]').selectOption('simulator');
      await page.locator('select[name="environment"]').selectOption(environment);
      await page
        .locator('input[name="callbackUrl"]')
        .fill(`https://example.com/api/webhooks/providers/${providerCode}`);
    };
    await fillProvider('PRODUCTION');
    await page.getByRole('button', { name: 'Create provider' }).click();
    check(
      'the simulator is refused for the production environment',
      await visible(page.getByText(/simulator cannot be used in the production/i)),
    );
    await fillProvider('SANDBOX');
    await page.getByRole('button', { name: 'Create provider' }).click();
    await page
      .waitForURL(/\/admin\/providers\/[0-9a-f-]{36}\?created=1$/, { timeout: 30_000 })
      .catch(() => undefined);
    check(
      'admin creates a provider',
      /\/admin\/providers\/[0-9a-f-]{36}/.test(page.url()),
      page.url(),
    );

    await page.locator('input[name="credentialName[]"]').nth(0).fill('apiKey');
    await page.locator('input[name="credentialValue[]"]').nth(0).fill('e2e-secret-api-key-value');
    await page.locator('input[name="credentialName[]"]').nth(1).fill('apiSecret');
    await page.locator('input[name="credentialValue[]"]').nth(1).fill('e2e-very-secret-value');
    await page.getByRole('button', { name: 'Store credentials' }).click();
    check(
      'credentials are stored as version 1',
      await visible(page.getByText(/Credentials stored as version 1/)),
    );
    await page.reload({ waitUntil: 'networkidle' });
    const html = await page.content();
    check(
      'stored credentials are never sent back to the browser',
      !html.includes('e2e-secret-api-key-value') && !html.includes('e2e-very-secret-value'),
    );
    check(
      'secret history shows only the field names',
      (await page.locator('main').innerText()).includes('fields: apiKey, apiSecret'),
    );

    await page.getByRole('button', { name: 'Set webhook secret' }).click();
    const generated = page.getByTestId('generated-webhook-secret');
    check('a generated webhook secret is displayed once', await visible(generated));
    const secret = (await generated.innerText().catch(() => '')).trim();
    check('the generated secret looks like a secret', /^whsec_.{20,}$/.test(secret));
    await page.reload({ waitUntil: 'networkidle' });
    check(
      'the webhook secret cannot be read again',
      secret !== '' && !(await page.content()).includes(secret),
    );
    await page.getByRole('button', { name: 'Rotate webhook secret' }).click();
    check(
      'the webhook secret is rotated to version 2',
      await visible(page.getByText(/rotated to version 2/)),
    );

    // Unsigned / wrongly signed inbound webhooks are rejected.
    const unsigned = await context.request.post(
      `${baseUrl}/api/webhooks/providers/${providerCode}`,
      {
        data: { eventId: 'e2e-1', status: 'SUCCESS', reference: 'NOPE' },
      },
    );
    check(
      'an unsigned provider webhook is rejected',
      unsigned.status() === 401,
      `status ${unsigned.status()}`,
    );
    const forged = await context.request.post(`${baseUrl}/api/webhooks/providers/${providerCode}`, {
      headers: { 'x-birem-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` },
      data: { eventId: 'e2e-2', status: 'SUCCESS', reference: 'NOPE' },
    });
    check(
      'a forged provider webhook signature is rejected',
      forged.status() === 401,
      `status ${forged.status()}`,
    );

    await page.getByRole('button', { name: 'Test connectivity' }).click();
    check(
      'connectivity test from the provider page',
      await visible(page.getByTestId('connectivity-result')),
    );
    await page.reload({ waitUntil: 'networkidle' });
    check(
      'the test is recorded in the health history',
      (await page.locator('main').innerText()).includes('Simulator reachable'),
    );
    check(
      'a new provider starts disabled',
      await visible(page.getByRole('button', { name: 'Enable', exact: true })),
    );
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    check('admin enables the provider', await notice(page, 'Provider enabled'));
    await page.getByRole('button', { name: 'Disable', exact: true }).click();
    check('admin disables the provider', await notice(page, 'Provider disabled'));

    // Signed webhook end to end: complete the payout that waits for the operator's callback.
    await goto(page, '/admin/transfers?status=PROCESSING');
    const pendingLink = page.locator('tbody tr a').first();
    if ((await pendingLink.count()) > 0) {
      const pendingRef = (await pendingLink.innerText()).trim();
      await goto(page, '/admin/providers');
      await page.locator('tr[data-provider="mtn-momo-cm"] a').first().click();
      await page.waitForURL(/\/admin\/providers\/[0-9a-f-]{36}$/);
      await page.getByRole('button', { name: /(Set|Rotate) webhook secret/ }).click();
      const shown = page.getByTestId('generated-webhook-secret');
      await visible(shown);
      const signingSecret = (await shown.innerText().catch(() => '')).trim();
      const send = (payload) => {
        const rawBody = JSON.stringify(payload);
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = createHmac('sha256', signingSecret)
          .update(`${timestamp}.${rawBody}`)
          .digest('hex');
        return context.request.post(`${baseUrl}/api/webhooks/providers/mtn-momo-cm`, {
          headers: {
            'content-type': 'application/json',
            'x-birem-signature': `t=${timestamp},v1=${signature}`,
          },
          data: rawBody,
        });
      };
      const event = { eventId: `e2e-${stamp}`, reference: pendingRef, status: 'SUCCESS' };
      const first = await send(event);
      const firstBody = await first.json().catch(() => ({}));
      check(
        'a correctly signed provider webhook completes the pending payout',
        first.status() === 200 &&
          firstBody.data?.outcome === 'PROCESSED' &&
          firstBody.data?.transferStatus === 'COMPLETED',
        `status ${first.status()} ${JSON.stringify(firstBody)}`,
      );
      const replay = await send(event);
      const replayBody = await replay.json().catch(() => ({}));
      check(
        'a replayed webhook is acknowledged but not applied twice',
        replay.status() === 200 && replayBody.data?.outcome === 'DUPLICATE',
        `status ${replay.status()} ${JSON.stringify(replayBody)}`,
      );
      await page.reload({ waitUntil: 'networkidle' });
      check(
        'the provider page lists the received webhook',
        (await page.locator('main').innerText()).includes(`e2e-${stamp}`),
      );
      await goto(page, `/admin/transfers?q=${pendingRef}`);
      check(
        'the payout is completed in the transfer monitor',
        await visible(page.locator('tr', { hasText: pendingRef }).getByText('Completed')),
      );
    } else {
      check(
        'a payout is waiting for a provider webhook',
        false,
        'no PROCESSING transfer in the seed',
      );
    }

    // Transfers: monitor, detail with journals, reversal.
    await goto(page, '/admin/transfers?type=W2M&status=COMPLETED');
    const firstTransfer = page.locator('tbody tr a').first();
    const reference = (await firstTransfer.innerText()).trim();
    await firstTransfer.click();
    await page.waitForURL(/\/admin\/transfers\/[0-9a-f-]{36}$/);
    const transferText = await page.locator('main').innerText();
    check(
      'transfer detail shows the ledger journals',
      transferText.includes('Ledger journals') &&
        /Debit/i.test(transferText) &&
        /Credit/i.test(transferText),
    );
    check(
      'transfer detail shows the timeline',
      transferText.includes('Timeline') && transferText.includes('Created'),
    );
    await page
      .locator('textarea[name="reason"]')
      .fill('E2E: merchant refund requested by customer');
    await page.getByRole('button', { name: 'Reverse transfer' }).click();
    check(`admin reverses ${reference}`, await notice(page, 'Transfer reversed'));
    await page.reload({ waitUntil: 'networkidle' });
    const reversedText = await page.locator('main').innerText();
    check(
      'the reversal is a new journal, not an edit',
      /Reversal/i.test(reversedText) && reversedText.includes('Reversed'),
    );
    await goto(page, `/admin/transfers?q=${reference}`);
    check(
      'transfer search by reference',
      await visible(page.getByRole('link', { name: reference })),
    );

    // Fees: create, edit, deactivate.
    const ruleName = `E2E rule ${stamp}`;
    await goto(page, '/admin/fees?new=1');
    await page.getByLabel('Rule name').fill(ruleName);
    await page.locator('select[name="transferType"]').selectOption('W2M');
    await page.locator('select[name="currency"]').selectOption('XAF');
    await page.getByLabel('Fixed fee').fill('25');
    await page.getByLabel('Variable fee (basis points)').fill('90');
    await page.getByLabel('Minimum fee').fill('50');
    await page.getByLabel('Cap (maximum fee)').fill('2500');
    await page.locator('input[name="priority"]').fill('7');
    await page.getByRole('button', { name: 'Create rule' }).click();
    await page.waitForURL(/saved=created/, { timeout: 30_000 }).catch(() => undefined);
    const feeRow = page.locator('tr', { hasText: ruleName });
    check('admin creates a fee rule', await visible(feeRow));
    check(
      'the new rule shows its percentage and cap',
      /0\.90%/.test(await feeRow.innerText()) && /2\s?500/.test(await feeRow.innerText()),
    );
    await feeRow.getByRole('link', { name: /Edit/ }).click();
    await page.getByLabel('Variable fee (basis points)').fill('110');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForURL(/saved=updated/, { timeout: 30_000 }).catch(() => undefined);
    check(
      'admin edits the fee rule',
      /1\.10%/.test(await page.locator('tr', { hasText: ruleName }).innerText()),
    );
    await page
      .locator('tr', { hasText: ruleName })
      .getByRole('button', { name: /Deactivate/ })
      .click();
    check(
      'admin deactivates the fee rule',
      await visible(page.locator('tr', { hasText: ruleName }).getByText('Inactive')),
    );

    // Countries: enable a planned market, then switch it back off.
    await goto(page, '/admin/countries');
    const nigeria = page.locator('tr[data-country="NG"]');
    await nigeria.getByRole('button', { name: /Enable/ }).click();
    check('admin enables a planned country', await visible(nigeria.getByText('Enabled')));
    await nigeria.getByRole('button', { name: /Disable/ }).click();
    check('admin disables it again', await visible(nigeria.getByText('Planned')));
    check(
      'the planned rails registry is listed',
      (await page.locator('main').innerText()).includes('Visa Direct'),
    );

    // Staff accounts and roles.
    const staffEmail = `e2e-${stamp}@bi-rem.local`;
    await goto(page, '/admin/users');
    await page.getByLabel('Full name').fill('E2E Analyst');
    await page.getByLabel('Work e-mail').fill(staffEmail);
    await page
      .locator('form:has(input[name="fullName"]) select[name="role"]')
      .selectOption('SUPPORT');
    await page.getByLabel('Initial password').fill('E2ePassword123');
    await page.getByRole('button', { name: 'Create account' }).click();
    const staffRow = page.locator(`tr[data-staff="${staffEmail}"]`);
    check('admin creates a staff account', await visible(staffRow));
    await staffRow.locator('select[name="role"]').selectOption('TREASURY');
    await staffRow.getByRole('button', { name: /Save/ }).click();
    check('admin changes a staff role', await visible(staffRow.getByText(/is now treasury/)));

    // Partners: onboard, commission, settlement run.
    await goto(page, '/admin/partners/new');
    await page.locator('select[name="type"]').selectOption('MERCHANT');
    await page.locator('select[name="countryCode"]').selectOption('CM');
    await page.getByLabel('Business name').fill(`E2E Boutique ${stamp}`);
    await page.getByLabel('Contact e-mail').fill(`boutique-${stamp}@example.com`);
    await page.getByLabel('Commission (basis points)').fill('45');
    await page.getByRole('button', { name: 'Create partner' }).click();
    await page
      .waitForURL(/\/admin\/partners\/[0-9a-f-]{36}\?created=1$/, { timeout: 30_000 })
      .catch(() => undefined);
    check(
      'admin onboards a merchant',
      /\/admin\/partners\/[0-9a-f-]{36}/.test(page.url()),
      page.url(),
    );
    check(
      'the new partner has a wallet and its commission rate',
      /0\.45%/.test(await page.locator('main').innerText()) &&
        (await page.locator('tr[data-wallet="XAF"]').count()) === 1,
    );
    await page
      .locator('form:has(button:has-text("Save commission")) input[name="commissionBps"]')
      .fill('60');
    await page.getByRole('button', { name: 'Save commission' }).click();
    check(
      'admin changes the commission',
      await visible(page.getByText(/Commission set to 60 bps/)),
    );
    await page.getByRole('button', { name: 'Suspend partner' }).click();
    check(
      'admin suspends the partner',
      await visible(page.getByRole('button', { name: 'Reactivate partner' })),
    );

    await goto(page, '/admin/partners?q=A-DEMO01');
    await page.getByRole('link', { name: /agent/i }).first().click();
    await page.waitForURL(/\/admin\/partners\/[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: 'Run and mark paid' }).click();
    check(
      'admin runs a settlement and it is marked paid',
      await notice(page, 'Settlement run complete'),
    );
    await page.reload({ waitUntil: 'networkidle' });
    check(
      'nothing is left to settle afterwards',
      (await page.locator('main').innerText()).includes('Nothing to settle'),
    );
    await goto(page, '/admin/partners?tab=settlements');
    check(
      'the settlement appears as paid',
      /SET-\d{4}-/.test(await page.locator('main').innerText()) &&
        (await page.locator('main').innerText()).includes('Paid'),
    );

    // Settings.
    await goto(page, '/admin/settings');
    const ttl = page.locator('[data-setting="fx.quoteTtlMinutes"]');
    await ttl.locator('textarea[name="value"]').fill('20');
    await ttl.getByRole('button', { name: 'Save' }).click();
    check('admin changes a setting', await visible(ttl.getByText('fx.quoteTtlMinutes saved')));
    await ttl.locator('textarea[name="value"]').fill('9999');
    await ttl.getByRole('button', { name: 'Save' }).click();
    check('an out-of-range setting is refused', await visible(ttl.locator('[role="alert"]')));
    await ttl.locator('textarea[name="value"]').fill('15');
    await ttl.getByRole('button', { name: 'Save' }).click();
    await visible(ttl.getByText('fx.quoteTtlMinutes saved'));

    // Audit log: the mutations above are there, with before / after.
    for (const action of [
      'provider.connectivity_test',
      'provider.credentials.rotate',
      'provider.webhook_secret.rotate',
      'provider.create',
      'transfer.reverse',
      'fee_rule.create',
      'country.enable',
      'user.staff.create',
      'user.role',
      'user.status',
      'partner.create',
      'settlement.create',
      'setting.update',
    ]) {
      await goto(page, `/admin/audit?action=${action}`);
      check(
        `audit log has ${action}`,
        (await page.locator(`[data-audit-action="${action}"]`).count()) > 0,
      );
    }
    await goto(page, '/admin/audit?action=provider.credentials.rotate');
    await page.locator('[data-audit-action="provider.credentials.rotate"] summary').first().click();
    const auditText = await page.locator('main').innerText();
    check(
      'audit rows never contain the credential values',
      !auditText.includes('e2e-secret-api-key-value') &&
        auditText.includes('fields: apiKey, apiSecret'),
    );

    // Reports: five dashboards and every export in three formats.
    for (const view of ['executive', 'operational', 'revenue', 'compliance', 'treasury']) {
      const status = await goto(page, `/admin/reports?view=${view}&days=90`);
      const tab = page.locator('nav[aria-label="Dashboards"] a[aria-current="page"]');
      check(
        `report dashboard ${view} renders`,
        status === 200 && (await tab.innerText()).toLowerCase() === view,
      );
      check(
        `report dashboard ${view} offers exports`,
        (await page.locator('a[data-export]').count()) >= 3,
      );
    }
    await goto(page, '/admin/reports?view=revenue&from=2026-01-01&to=2026-12-31');
    check(
      'reports accept a custom date range',
      (await page.locator('input[name="from"]').inputValue()) === '2026-01-01',
    );
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.locator('a[data-export="revenue.csv"]').click(),
    ]);
    check(
      'clicking an export button downloads a file',
      /^bi-rem-daily-revenue-\d{4}-\d{2}-\d{2}\.csv$/.test(download.suggestedFilename()),
      download.suggestedFilename(),
    );

    for (const name of REPORTS) {
      for (const format of ['csv', 'xlsx', 'pdf']) {
        const response = await context.request.get(
          `${baseUrl}/api/exports/${name}?format=${format}&days=90`,
        );
        const body = await response.body();
        const disposition = response.headers()['content-disposition'] ?? '';
        const problem =
          response.status() !== 200
            ? `status ${response.status()}`
            : !disposition.includes('attachment') || !disposition.includes(`.${format}`)
              ? `content-disposition ${disposition}`
              : await validateExport(format, body).catch((error) => String(error));
        check(
          `export ${name}.${format} is a valid ${format.toUpperCase()}`,
          problem === null,
          problem ?? '',
        );
      }
    }
    const badFormat = await context.request.get(`${baseUrl}/api/exports/transfers?format=exe`);
    check('an unknown export format is refused', badFormat.status() === 400);
    const badName = await context.request.get(`${baseUrl}/api/exports/secrets?format=csv`);
    check('an unknown report is not found', badName.status() === 404);
    await goto(page, '/admin/audit?action=report.export');
    check(
      'exports are audited',
      (await page.locator('[data-audit-action="report.export"]').count()) > 0,
    );

    await goto(page, aminaUrl.replace(baseUrl, ''));
    await context.close();
  }

  // ------------------------------------------------------------------ compliance
  {
    const { page, context } = await open('compliance@bi-rem.local');
    check('compliance lands in the back office', new URL(page.url()).pathname === '/admin');
    const nav = await page.locator('nav').allInnerTexts();
    const navText = nav.join(' ');
    check(
      'compliance sees KYC, Compliance and Audit',
      ['KYC queue', 'Compliance', 'Audit log', 'Customers'].every((label) =>
        navText.includes(label),
      ),
    );
    check(
      'compliance does not see Treasury or Staff',
      !navText.includes('Treasury') && !navText.includes('Staff & roles'),
    );
    for (const path of ['/admin/treasury', '/admin/users', '/admin/settings']) {
      await goto(page, path);
      check(
        `compliance is kept out of ${path}`,
        new URL(page.url()).pathname === '/admin',
        page.url(),
      );
    }

    // KYC: queue → case → document preview and download → approve.
    await goto(page, '/admin/kyc');
    const queued = page.getByRole('link', { name: /Maria/ });
    check('the KYC queue shows the waiting case', await visible(queued));
    await queued.first().click();
    await page.waitForURL(/\/admin\/kyc\/[0-9a-f-]{36}$/);
    const preview = page.locator('li[data-document="ID_FRONT"] img');
    check('the KYC case shows a document preview', await visible(preview));
    const src = await preview.getAttribute('src');
    const image = await context.request.get(`${baseUrl}${src}`);
    check(
      'the document preview is served inline, as an image, with safe headers',
      image.status() === 200 &&
        image.headers()['content-type'] === 'image/png' &&
        image.headers()['x-content-type-options'] === 'nosniff' &&
        (image.headers()['content-disposition'] ?? '').startsWith('inline') &&
        (image.headers()['cache-control'] ?? '').includes('no-store'),
      JSON.stringify(image.headers()),
    );
    const [doc] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.locator('a[data-download="ID_FRONT"]').click(),
    ]);
    check(
      'the KYC document can be downloaded',
      doc.suggestedFilename().length > 0,
      doc.suggestedFilename(),
    );
    check(
      'the vendor decision is labelled simulated',
      (await page.locator('main').innerText()).includes('Simulated'),
    );

    await page.getByRole('button', { name: 'Record decision' }).click();
    check(
      'a decision needs a choice and a reason',
      new URL(page.url()).pathname.startsWith('/admin/kyc/') &&
        (await page.getByRole('button', { name: 'Record decision' }).count()) === 1,
    );
    await page.locator('select[name="decision"]').selectOption('APPROVE');
    await page
      .locator('form:has(select[name="decision"]) textarea[name="note"]')
      .fill('E2E: document and selfie match, address confirmed');
    await page.getByRole('button', { name: 'Record decision' }).click();
    check('compliance approves the KYC case', await notice(page, 'Case approved'));
    await page.reload({ waitUntil: 'networkidle' });
    const caseText = await page.locator('main').innerText();
    check(
      'the case is approved and the tier raised',
      caseText.includes('Approved') &&
        /Tier [12] — /.test(caseText) &&
        !caseText.includes('Decide this case'),
    );
    await goto(page, '/admin/kyc');
    check('the queue is empty afterwards', await visible(page.getByText('The queue is empty')));

    // Tier assignment.
    await goto(page, '/admin/customers?q=samuel%40example.com');
    await page
      .getByRole('link', { name: /Samuel/ })
      .first()
      .click();
    await page.waitForURL(/\/admin\/customers\/[0-9a-f-]{36}$/);
    const tierForm = page.locator('form:has(select[name="tier"])');
    await tierForm.locator('select[name="tier"]').selectOption('TIER_2');
    await tierForm
      .locator('textarea[name="reason"]')
      .fill('E2E: proof of address verified in branch');
    await tierForm.getByRole('button', { name: 'Assign tier' }).click();
    check('compliance assigns a KYC tier', await visible(page.getByText('Tier assigned')));
    check(
      'compliance cannot suspend accounts',
      (await page.getByRole('button', { name: 'Suspend account' }).count()) === 0,
    );

    // Held transfer: release.
    await goto(page, '/admin/compliance?tab=cases&status=OPEN');
    const held = page.locator('tr', { hasText: 'On hold' }).first();
    const caseRef = (await held.locator('a').first().innerText()).trim();
    await held.locator('a').first().click();
    await page.waitForURL(/\/admin\/compliance\/cases\/[0-9a-f-]{36}$/);
    const caseUrl = page.url();
    await page
      .locator('form:has(input[name="body"]), form:has(textarea[name="body"])')
      .locator('textarea[name="body"]')
      .fill('E2E: contacted the sender, invoice provided.');
    await page.getByRole('button', { name: 'Add note' }).click();
    check('compliance adds a case note', await visible(page.getByText('Note added')));
    const release = page.locator('form[data-decision="release"]');
    await release
      .locator('textarea[name="note"]')
      .fill('E2E: legitimate supplier payment, documents on file');
    await release.getByRole('button', { name: 'Release transfer' }).click();
    check(
      `compliance releases the held transfer of ${caseRef}`,
      await notice(page, 'Case released'),
    );
    await page.goto(caseUrl, { waitUntil: 'networkidle' });
    const released = await page.locator('main').innerText();
    check(
      'the case is closed as released',
      released.includes('Released') && !released.includes('Release transfer'),
    );
    check(
      'the transfer left the hold',
      !/Status\s+On hold/.test(released) && /(Completed|Processing)/.test(released),
    );

    // The other held transfer: reject (refund).
    await goto(page, '/admin/compliance?tab=cases&status=OPEN');
    const second = page.locator('tr', { hasText: 'On hold' }).first();
    if ((await second.count()) > 0) {
      await second.locator('a').first().click();
      await page.waitForURL(/\/admin\/compliance\/cases\/[0-9a-f-]{36}$/);
      const secondUrl = page.url();
      const sarDraft = page.locator('form:has(button:has-text("Save SAR draft"))');
      await sarDraft
        .locator('textarea[name="narrative"]')
        .fill(
          'E2E narrative: repeated high-value transfers to an unrelated third party without economic rationale.',
        );
      await sarDraft.getByRole('button', { name: 'Save SAR draft' }).click();
      check('compliance starts a SAR draft', await notice(page, 'SAR draft saved'));
      const reject = page.locator('form[data-decision="reject"]');
      await reject
        .locator('textarea[name="note"]')
        .fill('E2E: sender could not explain the source of funds');
      await reject.getByRole('button', { name: 'Reject and refund' }).click();
      check('compliance rejects a held transfer', await notice(page, 'Case rejected'));
      await page.goto(secondUrl, { waitUntil: 'networkidle' });
      await page.getByLabel('Filed with').fill('ANIF (demo)');
      await page.getByRole('button', { name: 'Mark as filed' }).click();
      check(
        'compliance files the SAR with a reference',
        (await notice(page, 'Report marked as filed')) &&
          /SAR-\d{4}-/.test(
            await page
              .locator('[data-sar="filed"]')
              .innerText()
              .catch(() => ''),
          ),
      );
      await page.goto(secondUrl, { waitUntil: 'networkidle' });
      check(
        'the filed SAR is read-only',
        (await page.locator('[data-sar="filed"]').count()) === 1 &&
          (await page.getByRole('button', { name: 'Mark as filed' }).count()) === 0,
      );
    } else {
      check('a second held transfer exists to reject', false, 'none found');
    }
    await goto(page, '/admin/compliance?tab=sars&status=FILED');
    check(
      'the SAR register lists the filed report',
      /SAR-\d{4}-/.test(await page.locator('main').innerText()),
    );

    // Alerts: dismiss one.
    await goto(page, '/admin/compliance?tab=alerts');
    const alertRow = page.locator('tr[data-alert]').first();
    if ((await alertRow.count()) > 0) {
      await alertRow.locator('summary').click();
      await alertRow
        .locator('input[name="note"]')
        .fill('E2E: name similarity only, different date of birth');
      const before = await page.locator('tr[data-alert]').count();
      await alertRow.getByRole('button', { name: 'Dismiss alert' }).click();
      await page
        .waitForFunction(
          (count) =>
            document.querySelectorAll('tr[data-alert]').length < count ||
            document.querySelector('tr[data-alert]') === null,
          before,
          { timeout: 20_000 },
        )
        .catch(() => undefined);
      check(
        'compliance dismisses an alert',
        (await page.locator('tr[data-alert]').count()) < before,
      );
    }

    // Rules and screening list.
    await goto(page, '/admin/compliance?tab=rules');
    const rule = page.locator('tr[data-rule="AML-002"]');
    await rule.getByRole('button', { name: /Disable/ }).click();
    check('compliance disables an AML rule', await visible(rule.getByText('Disabled')));
    await rule.getByRole('button', { name: /Enable/ }).click();
    check('compliance re-enables it', await visible(rule.getByText('Enabled')));
    await page.locator('tr[data-rule="AML-010"]').getByRole('link', { name: /Edit/ }).click();
    await page.getByLabel('Maximum transfers in the window').fill('6');
    await page.getByLabel('Window (hours)').fill('2');
    await page.getByRole('button', { name: 'Save rule' }).click();
    await page.waitForURL(/saved=AML-010/, { timeout: 30_000 }).catch(() => undefined);
    const tuned = await page.locator('tr[data-rule="AML-010"]').innerText();
    check(
      'compliance tunes rule parameters',
      /Maximum transfers in the window: 6/.test(tuned) && /Window \(hours\): 2/.test(tuned),
      tuned,
    );
    await page.locator('tr[data-rule="AML-001"]').getByRole('link', { name: /Edit/ }).click();
    await page.getByLabel('Threshold (USD)').fill('3500.50');
    await page.getByRole('button', { name: 'Save rule' }).click();
    await page.waitForURL(/saved=AML-001/, { timeout: 30_000 }).catch(() => undefined);
    check(
      'USD thresholds are stored exactly',
      /Threshold \(USD\): 3500\.50/.test(await page.locator('tr[data-rule="AML-001"]').innerText()),
    );

    await goto(page, '/admin/compliance?tab=screening');
    await page.getByLabel('Full name').fill(`Evil Demo Person ${stamp}`);
    await page.getByLabel('Aliases').fill('E. D. Person');
    await page.getByRole('button', { name: 'Add entry' }).click();
    check(
      'compliance adds a screening entry',
      await visible(page.locator('tr', { hasText: `Evil Demo Person ${stamp}` })),
    );
    check(
      'the screening list is labelled as demo data',
      (await page.locator('main').innerText()).includes('fictional'),
    );

    // Exports allowed / refused for this role.
    const allowed = await context.request.get(`${baseUrl}/api/exports/audit?format=csv`);
    check('compliance may export the audit log', allowed.status() === 200);
    await context.close();
  }

  // ------------------------------------------------------------------ treasury
  {
    const { page, context } = await open('treasury@bi-rem.local');
    const navText = (await page.locator('nav').allInnerTexts()).join(' ');
    check(
      'treasury sees FX, Treasury, Fees and Reports',
      ['FX rates', 'Treasury', 'Fees', 'Reports'].every((label) => navText.includes(label)),
    );
    check(
      'treasury does not see Compliance, Audit or Staff',
      !navText.includes('Compliance') &&
        !navText.includes('Audit log') &&
        !navText.includes('Staff & roles'),
    );
    for (const path of ['/admin/compliance', '/admin/audit', '/admin/users']) {
      await goto(page, path);
      check(
        `treasury is kept out of ${path}`,
        new URL(page.url()).pathname === '/admin',
        page.url(),
      );
    }

    // FX: override the margin of XAF/AOA with a reason.
    await goto(page, '/admin/fx?base=XAF');
    const pair = page.locator('tr[data-fx-pair="XAF-AOA"]');
    const beforeRow = await pair.innerText();
    await pair.getByRole('link', { name: /Override/ }).click();
    await page.waitForURL(/edit=XAF-AOA/);
    check(
      'the override form is prefilled with the pair',
      (await page.locator('select[name="quoteCurrency"]').inputValue()) === 'AOA' &&
        (await page.getByLabel('Mid rate').inputValue()) !== '',
    );
    await page.getByLabel('Margin (basis points)').fill('185');
    await page.getByRole('button', { name: 'Apply override' }).click();
    check(
      'an override needs a reason',
      (await page.locator('#override textarea[name="reason"]:invalid').count()) === 1 &&
        !page.url().includes('saved='),
    );
    await page.getByLabel('Margin (basis points)').fill('185');
    await page
      .getByLabel('Reason for the override')
      .fill('E2E: widening the spread ahead of the weekend');
    await page.getByRole('button', { name: 'Apply override' }).click();
    await page.waitForURL(/saved=XAF-AOA/, { timeout: 30_000 }).catch(() => undefined);
    const afterRow = await page.locator('tr[data-fx-pair="XAF-AOA"]').innerText();
    check(
      'treasury changes an FX margin',
      /1\.85%/.test(afterRow) && afterRow.includes('Manual override') && afterRow !== beforeRow,
      afterRow,
    );

    // Fees: treasury may edit.
    await goto(page, '/admin/fees');
    check(
      'treasury can edit fee rules',
      (await page.getByRole('link', { name: 'New fee rule' }).count()) === 1,
    );

    // Treasury page.
    await goto(page, '/admin/treasury');
    const alerts = page.getByTestId('liquidity-alerts');
    check(
      'the low-liquidity alert is raised for STN',
      (await visible(alerts)) && (await alerts.innerText()).includes('STN'),
    );
    const thresholds = page.locator('form:has(input[name="lowBalance"])');
    await thresholds.locator('select[name="currency"]').selectOption('STN');
    await thresholds.locator('input[name="lowBalance"]').fill('1000');
    await thresholds.locator('input[name="criticalBalance"]').fill('5000');
    await thresholds.getByRole('button', { name: 'Save thresholds' }).click();
    check(
      'a critical level above the low level is refused',
      await visible(thresholds.locator('[role="alert"]')),
    );
    await thresholds.locator('select[name="currency"]').selectOption('STN');
    await thresholds.locator('input[name="lowBalance"]').fill('40000');
    await thresholds.locator('input[name="criticalBalance"]').fill('10000');
    await thresholds.getByRole('button', { name: 'Save thresholds' }).click();
    check('treasury edits a threshold', await visible(page.getByText('Thresholds saved for STN')));

    const funding = page.locator('form:has(input[name="approvedBy"])');
    await funding.locator('select[name="currency"]').selectOption('STN');
    await funding.locator('input[name="amount"]').fill('250000.00');
    await funding
      .locator('textarea[name="reason"]')
      .fill('E2E: wire ref BK-778 to operator account');
    await funding.getByRole('button', { name: 'Post journal' }).click();
    check(
      'funding without a four-eyes note is refused',
      !(await visible(page.getByText(/Funding journal posted/), 3_000)),
    );
    await funding.locator('select[name="currency"]').selectOption('STN');
    await funding.locator('input[name="amount"]').fill('250000.00');
    await funding
      .locator('textarea[name="reason"]')
      .fill('E2E: wire ref BK-778 to operator account');
    await funding.locator('input[name="approvedBy"]').fill('Approved by head of treasury (demo)');
    await funding.getByRole('button', { name: 'Post journal' }).click();
    check(
      'treasury posts a funding journal',
      await visible(page.getByText('Funding journal posted for STN')),
    );
    await page.reload({ waitUntil: 'networkidle' });
    const treasuryText = await page.locator('main').innerText();
    check(
      'the STN alert clears after funding',
      !(await page.getByTestId('liquidity-alerts').count()) ||
        !(await page.getByTestId('liquidity-alerts').innerText()).includes('STN'),
    );
    check(
      'profit analytics by day and corridor are shown',
      treasuryText.includes('Profit by day') && treasuryText.includes('Profit by corridor'),
    );
    check(
      'the ledger reconciles against provider statements',
      treasuryText.includes('Ledger and provider statements agree') &&
        (await page.locator('tr[data-reconciliation]').count()) > 0 &&
        !treasuryText.includes('Out of balance'),
    );
    check(
      'the statement source is stated honestly',
      treasuryText.includes('Rebuilt from simulator acknowledgements'),
    );

    // Reports and exports for treasury.
    await goto(page, '/admin/reports?view=treasury');
    check(
      'treasury opens the treasury dashboard',
      (await page.locator('main').innerText()).includes('Positions'),
    );
    const ok = await context.request.get(`${baseUrl}/api/exports/treasury?format=xlsx`);
    check(
      'treasury may export treasury positions',
      ok.status() === 200 && (await validateExport('xlsx', await ok.body())) === null,
    );
    const denied = await context.request.get(`${baseUrl}/api/exports/audit?format=csv`);
    check(
      'treasury may not export the audit log',
      denied.status() === 403,
      `status ${denied.status()}`,
    );

    // No reversal, no KYC documents for this role.
    await goto(page, '/admin/transfers?status=COMPLETED');
    await page.locator('tbody tr a').first().click();
    await page.waitForURL(/\/admin\/transfers\/[0-9a-f-]{36}$/);
    check(
      'treasury cannot reverse transfers',
      (await page.getByRole('button', { name: 'Reverse transfer' }).count()) === 0,
    );
    await context.close();
  }

  // ------------------------------------------------------------------ support
  {
    const { page, context } = await open('support@bi-rem.local');
    const navText = (await page.locator('nav').allInnerTexts()).join(' ');
    check(
      'support sees Customers, Transfers and Notifications',
      ['Customers', 'Transfers', 'Notifications'].every((label) => navText.includes(label)),
    );
    for (const path of ['/admin/treasury', '/admin/audit', '/admin/users', '/admin/settings']) {
      await goto(page, path);
      check(
        `support is kept out of ${path}`,
        new URL(page.url()).pathname === '/admin',
        page.url(),
      );
    }
    await goto(page, '/admin/customers?q=amina');
    await page.getByRole('link', { name: /Amina/ }).first().click();
    await page.waitForURL(/\/admin\/customers\/[0-9a-f-]{36}$/);
    const text = await page.locator('main').innerText();
    check(
      'support reads the customer profile',
      text.includes('Wallets') && text.includes('Recent transfers'),
    );
    check(
      'support has no account, tier or risk controls',
      (await page
        .getByRole('button', { name: /Suspend account|Assign tier|Reassess risk/ })
        .count()) === 0,
    );
    await goto(page, '/admin/providers');
    check(
      'support cannot test or add providers',
      (await page.getByRole('button', { name: 'Test' }).count()) === 0 &&
        (await page.getByRole('link', { name: 'Add provider' }).count()) === 0,
    );
    await goto(page, '/admin/providers/new');
    check('support cannot open the provider form', new URL(page.url()).pathname === '/admin');
    await goto(page, '/admin/kyc?status=ALL');
    await page.locator('tbody tr a').first().click();
    await page.waitForURL(/\/admin\/kyc\/[0-9a-f-]{36}$/);
    check(
      'support cannot open KYC documents',
      (await page.locator('li[data-document]').count()) === 0 &&
        (await page.locator('main').innerText()).includes('Documents can only be opened'),
    );
    await goto(page, '/admin/reports');
    check(
      'support sees reports but no export buttons',
      (await page.locator('a[data-export]').count()) === 0,
    );
    const exportDenied = await context.request.get(`${baseUrl}/api/exports/transfers?format=csv`);
    check(
      'support export requests are refused',
      exportDenied.status() === 403,
      `status ${exportDenied.status()}`,
    );
    await goto(page, '/admin/notifications');
    check('support opens its notifications', (await heading(page)) === 'Notifications');
    await context.close();
  }

  // ------------------------------------------------------------------ outsiders
  {
    const anonymous = await browser.newContext();
    const noSession = await anonymous.request.get(`${baseUrl}/api/exports/transfers?format=csv`);
    check('exports require a session', noSession.status() === 401, `status ${noSession.status()}`);
    const page = await anonymous.newPage();
    await page.goto(`${baseUrl}/admin/customers`);
    check(
      'the back office redirects visitors to sign in',
      new URL(page.url()).pathname === '/login',
    );
    const document = await anonymous.request.get(
      `${baseUrl}/admin/kyc/documents/00000000-0000-4000-8000-000000000000`,
      { maxRedirects: 0 },
    );
    check(
      'KYC documents are not served without a session',
      document.status() !== 200,
      `status ${document.status()}`,
    );
    await anonymous.close();

    const customerContext = await browser.newContext();
    const customerPage = await login(customerContext, 'joao@example.com');
    await customerPage.goto(`${baseUrl}/admin`);
    check(
      'a customer is sent away from the back office',
      !new URL(customerPage.url()).pathname.startsWith('/admin'),
    );
    const customerExport = await customerContext.request.get(
      `${baseUrl}/api/exports/transfers?format=csv`,
    );
    check(
      'a customer cannot export reports',
      customerExport.status() === 403,
      `status ${customerExport.status()}`,
    );
    const customerDocument = await customerContext.request.get(
      `${baseUrl}/admin/kyc/documents/00000000-0000-4000-8000-000000000000`,
      { maxRedirects: 0 },
    );
    check(
      'a customer cannot reach the reviewer document route',
      customerDocument.status() !== 200,
      `status ${customerDocument.status()}`,
    );
    await customerContext.close();
  }
}

// ---------------------------------------------------------------------------
// Stand-alone runner
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.env.E2E_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) {
    process.stdout.write('back-office e2e: skipped (set E2E_BASE_URL to a running BI-Rem Lite)\n');
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
    await backOfficeWalkthrough({ browser, baseUrl, check, login });
  } catch (error) {
    check(
      'walk-through ran to completion',
      false,
      error instanceof Error ? error.message.split('\n')[0] : String(error),
    );
  }
  await browser.close();
  const failed = results.filter((ok) => !ok).length;
  process.stdout.write(`\nback-office e2e: ${results.length - failed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}
