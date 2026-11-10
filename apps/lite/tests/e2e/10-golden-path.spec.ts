import { readFile } from 'node:fs/promises';

import type { Download, Locator, Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';

import { storageStatePath } from './env';
import { digitsOf, expect, pageState, pathOf, test } from './support';

/**
 * The golden path across the programme phases, as one story on one database:
 *
 *   a new customer registers (phase 1) → submits KYC, which the simulated vendor sends to manual
 *   review (2) → compliance approves it → the customer links a mobile-money account and tops up
 *   through the sandbox operator (3, 4) → sends a domestic transfer (5) → sends an international
 *   transfer CM → AO on a locked quote (6) → a transfer that matches the screening list is held
 *   (8) → compliance releases it → the administrator widens an FX margin and the next quote
 *   reflects it to the minor unit (7) → the administrator tests a provider connection (3) → a
 *   partner creates an API key and the public API creates a transfer idempotently (9) → the
 *   administrator downloads CSV, Excel and PDF exports (10).
 *
 * The tests depend on each other and run in order; a failure skips the rest.
 */

test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const customer = {
  name: `Awa Golden ${stamp}`,
  email: `awa.golden.${stamp}@example.org`,
  password: 'Golden-Path-2026',
  /** A storage-state name: the session is saved after registration and reused. */
  session: 'newcomer',
};

const TOP_UP = 200_000n; // XAF has no minor unit: 200 000 FCFA
const DOMESTIC = 5_000n;
const INTERNATIONAL = 20_000n;
const HELD = 3_000n;

/** 1×1 PNG used as the identity document. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** State handed from one step of the story to the next. */
const story = {
  balance: 0n,
  domesticPath: '',
  internationalReceive: 0n,
  heldReference: '',
  heldPath: '',
  heldTotalDebit: 0n,
};

/** The value (`<dd>`) displayed next to a label (`<dt>`). */
const valueOf = (scope: Page | Locator, label: string): Locator =>
  scope
    .locator('dt', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');

async function walletBalance(page: Page): Promise<bigint> {
  await page.goto('/app/wallets');
  const wallet = page.getByRole('listitem').filter({ hasText: 'XAF wallet' }).first();
  const text = await wallet
    .locator('p', { hasText: /\d.*XAF$/ })
    .first()
    .innerText();
  return digitsOf(text);
}

interface SendOptions {
  readonly recipient: (page: Page) => Promise<void>;
  readonly amount: bigint;
  readonly international?: boolean;
}

/** Drives the send wizard up to the review step (price locked) and returns what it shows. */
async function reviewTransfer(
  page: Page,
  options: SendOptions,
): Promise<{ totalDebit: bigint; receive: bigint; rateText: string }> {
  await page.goto('/app/send', { waitUntil: 'networkidle' });
  await options.recipient(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'How much?' })).toBeVisible();
  await page.getByLabel(/^You send/).fill(options.amount.toString());
  await expect(page.getByText('Recipient gets')).toBeVisible();
  if (options.international) {
    await page.getByLabel('Purpose of the transfer').selectOption('FAMILY_SUPPORT');
    await page.getByLabel('Source of funds').selectOption('SALARY');
  }
  await page.getByRole('button', { name: 'Review transfer' }).click();
  await expect(page.getByRole('heading', { name: 'Check and confirm' })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(/^1[0-9]:[0-5][0-9]$/);
  return {
    totalDebit: digitsOf(await valueOf(page, 'Total debited from your wallet').innerText()),
    receive: digitsOf(await valueOf(page, 'Recipient gets').innerText()),
    rateText: options.international ? await valueOf(page, 'Exchange rate').innerText() : '',
  };
}

/** Confirms the reviewed transfer and returns the outcome shown on the last step. */
async function confirmTransfer(
  page: Page,
): Promise<{ outcome: string; reference: string; trackingPath: string }> {
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByRole('heading', { name: 'Transfer submitted' })).toBeVisible();
  const outcome = await page.locator('[role="status"] p, [role="alert"] p').first().innerText();
  const reference = (await valueOf(page, 'Reference').innerText()).trim();
  const trackingPath =
    (await page.getByRole('link', { name: 'Track this transfer' }).getAttribute('href')) ?? '';
  return { outcome, reference, trackingPath };
}

const toJoao = async (page: Page): Promise<void> => {
  await page.getByText('To another country').click();
  await page.getByLabel('Destination country').selectOption('AO');
  await page.getByLabel('Phone number or e-mail').fill('joao@example.com');
};

test('1 · a visitor registers and gets a wallet in the local currency', async ({ page, watch }) => {
  watch(page);
  await page.goto('/register', { waitUntil: 'networkidle' });
  await page.getByLabel('Full name').fill(customer.name);
  await page.getByLabel('E-mail').fill(customer.email);
  await page.getByLabel('Country of residence').selectOption('CM');
  await page.locator('input[name="password"]').fill(customer.password);
  await page.getByLabel('Confirm password').fill(customer.password);
  await page.getByLabel('I understand this is a demonstration platform').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/app');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello, Awa');
  await expect(page.getByText('XAF wallet')).toBeVisible();
  await expect(page.getByText('Tier 0 — your current verification level')).toBeVisible();
  await page.context().storageState({ path: storageStatePath(customer.session) });

  // Unverified: international transfers are closed.
  await page.goto('/app/send', { waitUntil: 'networkidle' });
  await expect(page.getByRole('radio', { name: /To another country/ })).toBeDisabled();
});

test('2 · the customer submits KYC and the simulated vendor asks for a manual review', async ({
  session,
}) => {
  const page = await session(customer.session);
  await page.goto('/app/kyc', { waitUntil: 'networkidle' });
  await expect(page.getByText('Checked by:')).toBeVisible();
  await expect(page.getByText('Simulated').first()).toBeVisible();

  // An ID number containing REVIEW makes the simulated vendor refer the case to compliance.
  await page.getByLabel('Document number').fill(`CM-REVIEW-${stamp.slice(-4).toUpperCase()}`);
  await page
    .getByLabel('ID document — front')
    .setInputFiles({ name: 'id-front.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await page.getByRole('button', { name: 'Submit for verification' }).click();
  await page.waitForURL('**/app/kyc?result=IN_REVIEW');
  await expect(page.getByText('Your documents are being reviewed')).toBeVisible();
  await expect(page.getByText('Tier 0 — Registered')).toBeVisible();
});

test('3 · compliance approves the case from the verification queue', async ({ session }) => {
  const page = await session('compliance');
  await page.goto('/admin/kyc');
  await page.getByRole('link', { name: customer.name }).click();
  await page.waitForURL(/\/admin\/kyc\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('img', { name: /Id front of/ })).toBeVisible();
  await expect(page.getByText('no real identity check was performed')).toBeVisible();

  await page.getByLabel('Decision').selectOption('APPROVE');
  await page
    .locator('form:has(select[name="decision"]) textarea[name="note"]')
    .fill('E2E golden path: document checked, data consistent.');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByTestId('notice')).toContainText('Case approved');

  const customerPage = await session(customer.session);
  await customerPage.goto('/app/kyc');
  await expect(customerPage.getByText('Tier 1 — Verified').first()).toBeVisible();
  await customerPage.goto('/app/notifications');
  await expect(customerPage.getByRole('list', { name: 'Notifications' })).toContainText(/verif/i);
});

test('4 · the customer links a mobile-money account and tops up through the sandbox', async ({
  session,
}) => {
  const page = await session(customer.session);
  await page.goto('/app/wallets', { waitUntil: 'networkidle' });
  await page.getByLabel('Provider').selectOption({ label: 'MTN MoMo CM (simulated)' });
  await page.locator('input[name="accountNumber"]').fill('+237 670 55 12 34');
  await page.getByRole('button', { name: 'Validate and link' }).click();
  await expect(page.getByText(/linked — holder: Simulated Holder/)).toBeVisible();

  await page.getByRole('link', { name: 'Top up from it' }).first().click();
  await page.waitForURL('**/app/wallets/topup?source=*');
  await page.getByLabel(/^Amount/).fill(TOP_UP.toString());
  await page.getByRole('button', { name: 'Review top-up' }).click();
  await expect(page.getByRole('heading', { name: 'Check and confirm' })).toBeVisible();
  // Honest labelling: the operator is a simulator and the page says so.
  await expect(page.getByText('Simulated cash-in', { exact: true })).toBeVisible();
  expect(digitsOf(await valueOf(page, 'Credited to your wallet').innerText())).toBe(TOP_UP);
  await page.getByRole('button', { name: 'Confirm top-up' }).click();
  await page.waitForURL('**/app/transfers/*');
  await expect(page.getByText('Top-up completed').first()).toBeVisible();

  story.balance = await walletBalance(page);
  expect(story.balance).toBe(TOP_UP);
});

test('5 · a domestic transfer to another customer debits exactly amount + fee', async ({
  session,
}) => {
  const page = await session(customer.session);
  const review = await reviewTransfer(page, {
    amount: DOMESTIC,
    recipient: async (wizard) => {
      await wizard.getByLabel('Phone number or e-mail').fill('+237 699 000 101'); // Amina
    },
  });
  expect(review.receive).toBe(DOMESTIC);
  expect(review.totalDebit).toBeGreaterThan(DOMESTIC);

  const done = await confirmTransfer(page);
  expect(done.outcome).toBe('Transfer completed');
  story.domesticPath = done.trackingPath;

  await page.goto(done.trackingPath);
  await expect(page.getByRole('list', { name: 'Tracking timeline' })).toBeVisible();
  expect(digitsOf(await valueOf(page, 'Total debited').innerText())).toBe(review.totalDebit);

  const balance = await walletBalance(page);
  expect(balance).toBe(story.balance - review.totalDebit);
  story.balance = balance;

  // The recipient sees the money and who sent it.
  const amina = await session('amina');
  await amina.goto('/app/transfers');
  await expect(amina.getByRole('list', { name: 'Transfers' })).toContainText(customer.name);

  // Receipt: printable page and PDF.
  await page.goto(`${done.trackingPath}/receipt`);
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
  const pdf = await page.request.get(`${done.trackingPath}/receipt/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await PDFDocument.load(await pdf.body())).getPageCount()).toBeGreaterThanOrEqual(1);
});

test('6 · an international transfer CM → AO is paid at the locked quote', async ({ session }) => {
  const page = await session(customer.session);
  const review = await reviewTransfer(page, {
    amount: INTERNATIONAL,
    international: true,
    recipient: toJoao,
  });
  expect(review.rateText).toMatch(/^1 XAF = [\d.]+ AOA/);
  expect(review.rateText).toContain('FX margin');
  // The quoted amount follows from the quoted rate, to the cent (AOA has two decimals).
  const rate = /= ([\d.]+) AOA/.exec(review.rateText)?.[1] ?? '';
  expect(review.receive).toBe(convert(INTERNATIONAL, scaleRate(rate)));

  const done = await confirmTransfer(page);
  expect(done.outcome).toBe('Transfer completed');
  story.internationalReceive = review.receive;

  await page.goto(done.trackingPath);
  await expect(page.getByText('Cameroon → Angola')).toBeVisible();
  await expect(page.getByText('Family support')).toBeVisible();
  expect(digitsOf(await valueOf(page, 'Recipient got').innerText())).toBe(review.receive);

  const balance = await walletBalance(page);
  expect(balance).toBe(story.balance - review.totalDebit);
  story.balance = balance;

  const joao = await session('joao');
  await joao.goto('/app/transfers');
  await expect(joao.getByRole('list', { name: 'Transfers' })).toContainText(customer.name);
});

test('7 · a transfer that matches the screening list is held and the funds reserved', async ({
  session,
}) => {
  const page = await session(customer.session);
  const review = await reviewTransfer(page, {
    amount: HELD,
    recipient: async (wizard) => {
      await wizard.getByText('To a mobile-money number').click();
      await wizard
        .getByLabel('Mobile-money provider')
        .selectOption({ label: 'MTN MoMo CM (simulated)' });
      await wizard.locator('input[name="accountNumber"]').fill('+237 670 12 34 56');
      // The seeded screening list is fictional demo data; this name is on it.
      await wizard.getByLabel('Recipient’s full name').fill('Viktor Demo Sanctionov');
    },
  });
  const done = await confirmTransfer(page);
  expect(done.outcome).toBe('Transfer under review');
  story.heldReference = done.reference;
  story.heldPath = done.trackingPath;
  story.heldTotalDebit = review.totalDebit;

  await page.goto(done.trackingPath);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/under review|on hold/i);

  // Reserved, not gone: the wallet is debited while compliance decides.
  const balance = await walletBalance(page);
  expect(balance).toBe(story.balance - review.totalDebit);
  story.balance = balance;
});

test('8 · compliance releases the held transfer and it is paid out', async ({ session }) => {
  const page = await session('compliance');
  await page.goto('/admin/compliance?tab=cases&status=OPEN');
  const row = page.getByRole('row').filter({ hasText: story.heldReference });
  await expect(row).toContainText('On hold');
  await row.getByRole('link').first().click();
  await page.waitForURL(/\/admin\/compliance\/cases\/[0-9a-f-]{36}$/);
  await expect(page.getByText('AML-050', { exact: true })).toBeVisible();
  await expect(
    page.getByText(new RegExp(`${xafPattern(story.heldTotalDebit)} in the suspense account`)),
  ).toBeVisible();

  const release = page.locator('form[data-decision="release"]');
  await release
    .locator('textarea[name="note"]')
    .fill('E2E golden path: false positive, different person — released.');
  // Releasing money asks for an explicit confirmation.
  page.once('dialog', (dialog) => void dialog.accept());
  await release.getByRole('button', { name: 'Release transfer' }).click();
  await expect(page.getByTestId('notice')).toContainText('Case released');

  const customerPage = await session(customer.session);
  await customerPage.goto(story.heldPath);
  await expect(customerPage.getByRole('heading', { level: 1 })).toContainText('Completed');
  await expect(customerPage.getByRole('list', { name: 'Tracking timeline' })).toContainText(
    'Released',
  );
  // Released, not refunded: the balance is unchanged.
  expect(await walletBalance(customerPage)).toBe(story.balance);
});

test('9 · the administrator widens an FX margin and the next quote reflects it', async ({
  session,
}) => {
  const admin = await session('admin');
  await admin.goto('/admin/fx?base=XAF');
  const pair = admin.locator('tr[data-fx-pair="XAF-AOA"]');
  await pair.getByRole('link', { name: /Override/ }).click();
  await admin.waitForURL(/edit=XAF-AOA/);
  const mid = await admin.getByLabel('Mid rate').inputValue();
  const before = Number(await admin.getByLabel('Margin (basis points)').inputValue());
  const marginBps = before + 125;
  await admin.getByLabel('Margin (basis points)').fill(String(marginBps));
  await admin
    .getByLabel('Reason for the override')
    .fill('E2E golden path: wider spread for the weekend.');
  await admin.getByRole('button', { name: 'Apply override' }).click();
  await admin.waitForURL(/saved=XAF-AOA/);
  await expect(admin.locator('tr[data-fx-pair="XAF-AOA"]')).toContainText(
    `(${marginBps} basis points)`,
  );
  await expect(admin.locator('tr[data-fx-pair="XAF-AOA"]')).toContainText('Manual override');

  // customer rate = floor(mid × (1 − margin)); receive = floor(amount × rate), in AOA cents.
  const customerRate = (scaleRate(mid) * BigInt(10_000 - marginBps)) / 10_000n;
  const expected = convert(INTERNATIONAL, customerRate);
  expect(expected).toBeLessThan(story.internationalReceive);

  const page = await session(customer.session);
  const review = await reviewTransfer(page, {
    amount: INTERNATIONAL,
    international: true,
    recipient: toJoao,
  });
  expect(review.receive).toBe(expected);
  expect(review.rateText).toContain(`${(marginBps / 100).toFixed(2)}% FX margin`);

  // The override is in the audit log, with the reason.
  await admin.goto('/admin/audit?action=fx_rate.override');
  await expect(admin.locator('main')).toContainText('wider spread for the weekend');
});

test('10 · the administrator tests a provider connection from the dashboard', async ({
  session,
}) => {
  const admin = await session('admin');
  await admin.goto('/admin/providers', { waitUntil: 'networkidle' });
  const row = admin.locator('tr[data-provider="mtn-momo-cm"]');
  await row.getByRole('button', { name: 'Test' }).click();
  const result = row.getByTestId('connectivity-result');
  await expect(result).toContainText('Healthy');
  await expect(result).toContainText(/\d+ ms/);
  await expect(result).toContainText('Simulated');

  // The test is recorded in the provider's health history.
  await row.getByRole('link').first().click();
  await admin.waitForURL(/\/admin\/providers\/[0-9a-f-]{36}$/);
  await expect(admin.locator('main')).toContainText('Simulator reachable');
});

test('11 · a partner creates an API key and the public API pays idempotently', async ({
  session,
  request,
}) => {
  const page = await session('partner');
  await page.goto('/partner/api-keys', { waitUntil: 'networkidle' });
  await page.getByLabel('Key name').fill(`golden path ${stamp}`);
  for (const scope of ['transfers:write', 'wallets:read']) {
    await page.getByRole('checkbox', { name: scope }).check();
  }
  await page.getByRole('button', { name: 'Create API key' }).click();
  const apiKey = (await page.getByTestId('api-key-secret').innerText()).trim();
  expect(apiKey).toMatch(/^brl_[a-z0-9]{8}_[A-Za-z0-9_-]{20,}$/);

  // Shown once: after a reload only the prefix is listed.
  await page.reload();
  expect(await page.content()).not.toContain(apiKey);

  const headers = { authorization: `Bearer ${apiKey}` };
  const anonymous = await request.get('/api/v1/me');
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()['content-type']).toContain('application/problem+json');

  interface Me {
    data: { partner: { code: string }; wallets: Array<{ balance: string; currency: string }> };
  }
  interface TransferBody {
    data: { id: string; reference: string; status: string; sendAmount: string; totalDebit: string };
  }
  const me = (await (await request.get('/api/v1/me', { headers })).json()) as Me;
  expect(me.data.partner.code).toBe('M-DEMO01');
  const balanceBefore = BigInt(me.data.wallets[0]?.balance ?? '0');

  const body = {
    recipient: { type: 'wallet', identifier: customer.email },
    amount: '1500',
    note: `golden path ${stamp}`,
  };
  const withoutKey = await request.post('/api/v1/transfers', { headers, data: body });
  expect(withoutKey.status()).toBe(400);

  const idempotencyKey = `golden-${stamp}-${crypto.randomUUID()}`;
  const send = () =>
    request.post('/api/v1/transfers', {
      headers: { ...headers, 'idempotency-key': idempotencyKey },
      data: body,
    });
  const created = await send();
  expect(created.status()).toBe(201);
  const createdBody = (await created.json()) as TransferBody;
  expect(createdBody.data.status).toBe('COMPLETED');
  expect(createdBody.data.sendAmount).toBe('1500');

  const replay = await send();
  expect(replay.status()).toBe(200);
  expect(replay.headers()['idempotent-replayed']).toBe('true');
  expect(((await replay.json()) as TransferBody).data.id).toBe(createdBody.data.id);

  const conflict = await request.post('/api/v1/transfers', {
    headers: { ...headers, 'idempotency-key': idempotencyKey },
    data: { ...body, amount: '1600' },
  });
  expect(conflict.status()).toBe(409);

  // Debited exactly once, credited exactly once.
  const after = (await (await request.get('/api/v1/me', { headers })).json()) as Me;
  expect(balanceBefore - BigInt(after.data.wallets[0]?.balance ?? '0')).toBe(
    BigInt(createdBody.data.totalDebit),
  );
  const customerPage = await session(customer.session);
  const balance = await walletBalance(customerPage);
  expect(balance).toBe(story.balance + 1_500n);
  story.balance = balance;

  await page.goto('/partner/transactions');
  await expect(page.locator('main')).toContainText(createdBody.data.reference);
});

test('12 · the administrator downloads CSV, Excel and PDF exports', async ({ session }) => {
  const admin = await session('admin');
  await admin.goto('/admin/reports?view=operational&days=90', { waitUntil: 'networkidle' });
  const download = async (name: string): Promise<{ file: Download; bytes: Buffer }> => {
    const [file] = await Promise.all([
      admin.waitForEvent('download'),
      admin.locator(`a[data-export="${name}"]`).first().click(),
    ]);
    return { file, bytes: await readFile(await file.path()) };
  };

  const csv = await download('transfers.csv');
  expect(csv.file.suggestedFilename()).toMatch(/\.csv$/);
  const lines = csv.bytes.toString('utf8').trim().split(/\r?\n/);
  expect(lines[0]).toMatch(/reference/i);
  expect(lines.length).toBeGreaterThan(50); // the demo history plus this story
  expect(csv.bytes.toString('utf8')).toContain(story.heldReference);

  const xlsx = await download('transfers.xlsx');
  expect(xlsx.file.suggestedFilename()).toMatch(/\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    xlsx.bytes.buffer.slice(
      xlsx.bytes.byteOffset,
      xlsx.bytes.byteOffset + xlsx.bytes.byteLength,
    ) as ArrayBuffer,
  );
  expect(workbook.worksheets[0]?.rowCount ?? 0).toBeGreaterThan(50);

  const pdf = await download('transfers.pdf');
  expect(pdf.file.suggestedFilename()).toMatch(/\.pdf$/);
  expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBeGreaterThanOrEqual(1);

  // Exports are audited.
  await admin.goto('/admin/audit?action=report.export');
  await expect(admin.locator('[data-audit-action="report.export"]').first()).toBeVisible();
  expect(await pageState(admin)).toBe('ok');
  expect(pathOf(admin)).toBe('/admin/audit');
});

// ---------------------------------------------------------------- exact-arithmetic helpers

const RATE_SCALE = 10_000_000_000n; // rates carry ten decimals, as in src/server/money.ts

/** "1.4753444204" → 14753444204n */
function scaleRate(text: string): bigint {
  const [whole = '0', fraction = ''] = text.trim().split('.');
  return BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(10, '0').slice(0, 10));
}

/** XAF (no minor unit) → AOA cents, rounded down as the pricing engine does. */
function convert(amountXaf: bigint, scaledRate: bigint): bigint {
  return (amountXaf * scaledRate * 100n) / RATE_SCALE;
}

/** 3060n → a pattern for "3 060 XAF" as the UI prints it (any space as the group separator). */
function xafPattern(amount: bigint): string {
  return `${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\\s')}\\sXAF`;
}
