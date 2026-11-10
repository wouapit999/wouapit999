/**
 * Customer area, end to end: dashboard, guided transfers (domestic, merchant, international,
 * mobile-money outcomes, AML hold), tracking, receipt (HTML + PDF), wallets (link, top-up,
 * statement), beneficiaries, KYC (reject → resubmit → approve), notifications, profile,
 * security (TOTP, sessions, password) and cross-customer isolation.
 *
 * Requires the demo data. Safe to run repeatedly: state-changing checks that cannot be undone
 * (KYC, password, MFA) run on a customer registered by the spec itself.
 */
import { createHmac } from 'node:crypto';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** RFC 6238 code for a base32 secret (same parameters as the server: SHA-1, 30 s, 6 digits). */
function totp(secret, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of secret.toUpperCase().replace(/[\s=-]/g, '')) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

const uniqueDigits = () => String(Date.now()).slice(-6);

/** Pages stream (skeleton first) and hydrate: wait until the network is quiet before asserting. */
const SETTLED = { waitUntil: 'networkidle' };

export default async function customer({ browser, baseUrl, check, login }) {
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (error) => errors.push(`${new URL(page.url()).pathname}: ${error}`));
    return page;
  };
  const pathOf = (page) => new URL(page.url()).pathname;

  /** Runs the wizard up to the outcome step and returns the outcome title. */
  async function send(page, { recipient, amount, international = false }) {
    await page.goto(`${baseUrl}/app/send`, SETTLED);
    await recipient(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'How much?' }).waitFor();
    await page.getByLabel(/^You send/).fill(amount);
    await page.getByText('Recipient gets').waitFor();
    if (international) {
      await page.getByLabel('Purpose of the transfer').selectOption('FAMILY_SUPPORT');
      await page.getByLabel('Source of funds').selectOption('SALARY');
    }
    await page.getByRole('button', { name: 'Review transfer' }).click();
    await page.getByRole('heading', { name: 'Check and confirm' }).waitFor();
    const locked = await page.getByRole('timer').innerText();
    await page.getByRole('button', { name: 'Confirm and send' }).click();
    await page.getByRole('heading', { name: 'Transfer submitted' }).waitFor();
    const title = await page.locator('[role="status"] p, [role="alert"] p').first().innerText();
    return { title, locked };
  }

  // ------------------------------------------------------------------ Amina (CM, tier 2)
  const aminaContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const amina = watch(await login(aminaContext, 'amina@example.com'));
  await amina.getByRole('list', { name: 'Recent transfers' }).waitFor();

  check('dashboard greets the customer', (await amina.locator('h1').innerText()).includes('Amina'));
  check('dashboard shows the XAF wallet', (await amina.getByText('XAF wallet').count()) >= 1);
  check(
    'dashboard shows limits and recent transfers',
    (await amina.getByRole('progressbar').count()) === 2 &&
      (await amina.getByRole('list', { name: 'Recent transfers' }).count()) === 1,
  );

  // Domestic wallet → wallet
  const domestic = await send(amina, {
    amount: '5000',
    recipient: async (page) => {
      await page.getByLabel('Phone number or e-mail').fill('+237 677 000 104');
    },
  });
  check('domestic transfer completes', domestic.title === 'Transfer completed', domestic.title);
  check(
    'price is locked with a countdown',
    /^1[0-9]:[0-5][0-9]$/.test(domestic.locked),
    domestic.locked,
  );

  const track = async (page) => {
    await page.getByRole('link', { name: 'Track this transfer' }).click();
    await page.getByRole('list', { name: 'Tracking timeline' }).waitFor();
  };
  await track(amina);
  const transferPath = pathOf(amina);
  check(
    'tracking page shows the timeline',
    (await amina.getByRole('list', { name: 'Tracking timeline' }).locator('li').count()) >= 2,
  );
  check('tracking page shows the amounts', (await amina.getByText('Total debited').count()) === 1);

  // Receipt: printable HTML and PDF
  await amina.goto(`${baseUrl}${transferPath}/receipt`, SETTLED);
  await amina.getByRole('button', { name: 'Print' }).waitFor();
  check(
    'receipt page renders',
    (await amina.getByRole('button', { name: 'Print' }).count()) === 1 &&
      (await amina.getByText('Total paid').count()) === 1,
  );
  const pdf = await aminaContext.request.get(`${baseUrl}${transferPath}/receipt/pdf`);
  check(
    'receipt PDF downloads',
    pdf.status() === 200 &&
      pdf.headers()['content-type'] === 'application/pdf' &&
      (await pdf.body()).subarray(0, 4).toString() === '%PDF',
    `${pdf.status()} ${pdf.headers()['content-type']}`,
  );

  // Merchant payment
  const merchant = await send(amina, {
    amount: '2500',
    recipient: async (page) => {
      await page.getByText('Pay a shop with its code').click();
      await page.getByLabel('Merchant code').fill('m-demo01');
    },
  });
  check('merchant payment completes', merchant.title === 'Transfer completed', merchant.title);

  // A domestic choice that resolves abroad is refused before any amount is entered
  await amina.goto(`${baseUrl}/app/send`, SETTLED);
  await amina.getByLabel('Phone number or e-mail').fill('joao@example.com');
  await amina.getByRole('button', { name: 'Continue' }).click();
  await amina.getByText('This recipient is in Angola').first().waitFor();
  check('a recipient abroad is not accepted as a domestic transfer', true);

  // International by corridor, with purpose and source of funds
  const international = await send(amina, {
    amount: '20000',
    international: true,
    recipient: async (page) => {
      await page.getByText('To another country').click();
      await page.getByLabel('Destination country').selectOption('AO');
      await page.getByLabel('Phone number or e-mail').fill('joao@example.com');
    },
  });
  check(
    'international transfer completes',
    international.title === 'Transfer completed',
    international.title,
  );
  await track(amina);
  check(
    'international tracking shows rate, purpose and route',
    (await amina.getByText('Exchange rate (locked)').count()) === 1 &&
      (await amina.getByText('Family support').count()) === 1 &&
      (await amina.getByText('Cameroon → Angola').count()) === 1,
  );

  const mobileMoney = (number, name) => async (page) => {
    await page.getByText('To a mobile-money number').click();
    await page.getByLabel('Mobile-money provider').selectOption({ index: 1 });
    await page.locator('input[name="accountNumber"]').fill(number);
    await page.getByLabel('Recipient’s full name').fill(name);
  };

  // Provider failure → refunded
  const failed = await send(amina, {
    amount: '3000',
    recipient: mobileMoney('+237 670 00 0001', 'Recipient Limit'),
  });
  check('a refused payout is reported as failed', failed.title === 'Transfer failed', failed.title);
  check(
    'the failure says the money is back',
    (await amina.getByText('is back in your wallet').count()) === 1,
  );

  // Provider pending → status check completes it
  const pending = await send(amina, {
    amount: '3000',
    recipient: mobileMoney('+237 670 00 0003', 'Pending Then Paid'),
  });
  check(
    'a pending payout is reported as in progress',
    pending.title === 'Transfer in progress',
    pending.title,
  );
  await track(amina);
  await amina.getByRole('button', { name: 'Check status' }).click();
  await amina.getByText('Transfer completed').first().waitFor();
  check('checking the status completes the payout', true);

  // AML hold (name close to the demo sanctions list)
  const held = await send(amina, {
    amount: '3000',
    recipient: mobileMoney('+237 670 12 3456', 'Viktor Demo Sanctionov'),
  });
  check(
    'a screened transfer is reported as under review',
    held.title === 'Transfer under review',
    held.title,
  );

  // History: filters and pagination
  await amina.goto(`${baseUrl}/app/transfers?status=FAILED`, SETTLED);
  check(
    'history filters by status',
    (await amina.getByRole('list', { name: 'Transfers' }).locator('li').count()) >= 1 &&
      (await amina.getByRole('list', { name: 'Transfers' }).getByText('Completed').count()) === 0,
  );
  await amina.goto(`${baseUrl}/app/transfers`, SETTLED);
  await amina.getByRole('link', { name: 'Next' }).click();
  await amina.waitForURL('**/app/transfers?page=2');
  check('history paginates', (await amina.getByText('Page 2 /').count()) === 1);

  // Wallets: link a mobile-money account, top up from it, statement
  const ownNumber = `+23767${uniqueDigits()}9`;
  await amina.goto(`${baseUrl}/app/wallets`, SETTLED);
  await amina.getByLabel('Provider').selectOption({ index: 1 });
  await amina.locator('input[name="accountNumber"]').fill(ownNumber);
  await amina.getByRole('button', { name: 'Validate and link' }).click();
  await amina.getByText(/linked — holder: Simulated Holder/).waitFor();
  check('a mobile-money account is validated and linked', true);

  await amina.locator('input[name="accountNumber"]').fill('+237 670 00 0000');
  await amina.getByLabel('Provider').selectOption({ index: 1 });
  await amina.getByRole('button', { name: 'Validate and link' }).click();
  await amina
    .getByText('could not be validated')
    .or(amina.getByText('does not exist'))
    .first()
    .waitFor();
  check('an account the operator does not know is refused', true);

  await amina.getByRole('link', { name: 'Top up from it' }).first().click();
  await amina.waitForURL('**/app/wallets/topup?source=*');
  await amina.getByLabel(/^Amount/).fill('10000');
  await amina.getByRole('button', { name: 'Review top-up' }).click();
  await amina.getByRole('heading', { name: 'Check and confirm' }).waitFor();
  check(
    'top-up review shows the holder and says it is simulated',
    (await amina.getByText('Simulated Holder').count()) >= 1 &&
      (await amina.getByText('Simulated cash-in', { exact: true }).count()) === 1,
  );
  await amina.getByRole('button', { name: 'Confirm top-up' }).click();
  await amina.waitForURL('**/app/transfers/*');
  check('top-up completes', (await amina.getByText('Top-up completed').count()) >= 1);

  await amina.goto(`${baseUrl}/app/wallets`, SETTLED);
  await amina.getByRole('link', { name: 'Statement' }).first().click();
  await amina.waitForURL('**/app/wallets/*');
  check(
    'statement lists the top-up',
    (await amina.locator('tbody tr').count()) >= 5 &&
      (await amina.locator('tbody tr').first().innerText()).includes('Top-up'),
  );
  await amina.getByRole('link', { name: 'Older movements' }).click();
  await amina.waitForURL('**before=*');
  check('statement pages back in time', (await amina.locator('tbody tr').count()) >= 1);

  await amina.goto(`${baseUrl}/app/wallets`, SETTLED);
  amina.once('dialog', (dialog) => dialog.accept());
  await amina.getByRole('button', { name: 'Unlink' }).first().click();
  await amina
    .getByText('Account unlinked')
    .or(amina.getByText('No linked account'))
    .first()
    .waitFor();
  check('a linked account can be unlinked', true);

  // Beneficiaries: add (validated), edit, send, remove
  const beneficiaryName = `E2E Beneficiary ${uniqueDigits()}`;
  await amina.goto(`${baseUrl}/app/beneficiaries`, SETTLED);
  await amina.getByLabel('Full name').fill(beneficiaryName);
  await amina.getByLabel('How do they receive money?').selectOption('MOBILE_MONEY');
  await amina.getByLabel('Mobile-money provider').selectOption({ index: 1 });
  await amina.locator('input[name="accountNumber"]').fill('+237 670 00 0000');
  await amina.getByRole('button', { name: 'Save beneficiary' }).click();
  await amina
    .getByRole('alert')
    .filter({ hasText: /valid|exist/i })
    .first()
    .waitFor();
  check('a beneficiary with an unknown account is refused', true);

  await amina.getByLabel('Full name').fill(beneficiaryName);
  await amina.getByLabel('How do they receive money?').selectOption('MOBILE_MONEY');
  await amina.getByLabel('Mobile-money provider').selectOption({ index: 1 });
  await amina.locator('input[name="accountNumber"]').fill(`+23769${uniqueDigits()}8`);
  await amina.getByRole('button', { name: 'Save beneficiary' }).click();
  await amina.getByText(`${beneficiaryName} was added`).waitFor();
  const row = amina.getByRole('listitem').filter({ hasText: beneficiaryName });
  check('the beneficiary appears in the list', (await row.count()) === 1);

  await row.getByRole('link', { name: 'Edit' }).click();
  await amina.waitForURL('**/app/beneficiaries/*');
  await amina.getByLabel('Nickname').fill('E2E');
  await amina.getByRole('button', { name: 'Save changes' }).click();
  await amina.getByText('Beneficiary updated.').waitFor();
  check(
    'the beneficiary can be edited',
    (await amina.getByRole('listitem').filter({ hasText: beneficiaryName }).innerText()).includes(
      '“E2E”',
    ),
  );

  await amina
    .getByRole('listitem')
    .filter({ hasText: beneficiaryName })
    .getByRole('link', { name: 'Send' })
    .click();
  await amina.waitForURL('**/app/send?beneficiary=*');
  check(
    'sending to a beneficiary pre-selects it',
    (await amina.locator('select[name="beneficiaryId"]').inputValue()) !== '',
  );

  await amina.goto(`${baseUrl}/app/beneficiaries`, SETTLED);
  amina.once('dialog', (dialog) => dialog.accept());
  await amina
    .getByRole('listitem')
    .filter({ hasText: beneficiaryName })
    .getByRole('button', { name: /Remove/ })
    .click();
  await amina
    .getByRole('listitem')
    .filter({ hasText: beneficiaryName })
    .waitFor({ state: 'detached' });
  check('the beneficiary can be removed', true);

  // Notifications
  await amina.goto(`${baseUrl}/app/notifications`, SETTLED);
  await amina.getByRole('list', { name: 'Notifications' }).waitFor();
  check(
    'notifications are listed',
    (await amina.getByRole('list', { name: 'Notifications' }).locator('li').count()) >= 3,
  );
  await amina
    .getByRole('button', { name: /^Mark “/ })
    .first()
    .click();
  await amina.waitForLoadState('networkidle');
  await amina.getByRole('button', { name: 'Mark all as read' }).click();
  await amina.getByText('You are all caught up.').waitFor();
  check(
    'notifications can be marked as read',
    (await amina.getByText('New', { exact: true }).count()) === 0,
  );

  // ------------------------------------------------------------------ Isolation (João)
  const joaoContext = await browser.newContext();
  const joao = watch(await login(joaoContext, 'joao@example.com'));
  await joao.goto(`${baseUrl}/app/transfers`, SETTLED);
  check(
    'the recipient sees the money that arrived',
    (await joao.getByRole('list', { name: 'Transfers' }).getByText('Amina Njoya').count()) >= 1,
  );
  // The page streams (loading skeleton first), so the proof is what is rendered, not the status.
  await joao.goto(`${baseUrl}${transferPath}`, SETTLED);
  await joao.getByText('We could not find that').waitFor();
  check(
    "another customer's transfer shows the not-found page and no data",
    (await joao.getByText('Total debited').count()) === 0 &&
      (await joao.getByRole('list', { name: 'Tracking timeline' }).count()) === 0,
  );
  const foreignPdf = await joaoContext.request.get(`${baseUrl}${transferPath}/receipt/pdf`);
  check(
    "another customer's receipt PDF is a 404",
    foreignPdf.status() === 404,
    String(foreignPdf.status()),
  );
  await joao.goto(`${baseUrl}${transferPath}/receipt`, SETTLED);
  await joao.getByText('We could not find that').waitFor();
  check(
    "another customer's receipt page shows the not-found page and no data",
    (await joao.getByText('Total paid').count()) === 0,
  );
  const anonymousPdf = await (
    await browser.newContext()
  ).request.get(`${baseUrl}${transferPath}/receipt/pdf`, { maxRedirects: 0 });
  check(
    'a signed-out visitor cannot download a receipt',
    [307, 401].includes(anonymousPdf.status()),
    String(anonymousPdf.status()),
  );

  // ------------------------------------------------------------------ New customer (GA)
  const freshContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const fresh = watch(await freshContext.newPage());
  const email = `e2e-customer-${Date.now()}@example.org`;
  const password = 'E2e-Customer-2026';
  await fresh.goto(`${baseUrl}/register`, SETTLED);
  await fresh.getByLabel('Full name').fill('E2E Customer');
  await fresh.getByLabel('E-mail').fill(email);
  await fresh.getByLabel('Country of residence').selectOption('GA');
  await fresh.locator('input[name="password"]').fill(password);
  await fresh.getByLabel('Confirm password').fill(password);
  await fresh.getByLabel('I understand this is a demonstration platform').check();
  await fresh.getByRole('button', { name: 'Create account' }).click();
  await fresh.waitForURL('**/app');

  check(
    'mobile layout has no horizontal scroll on the dashboard',
    await fresh.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  );
  await fresh.goto(`${baseUrl}/app/send`, SETTLED);
  check(
    'international transfers are closed before verification',
    await fresh.getByRole('radio', { name: /To another country/ }).isDisabled(),
  );
  check(
    'mobile layout has no horizontal scroll on the send flow',
    await fresh.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  );

  // KYC: rejected by the simulated vendor, then resubmitted and approved
  const submitKyc = async (idNumber, expected) => {
    await fresh.getByLabel('Document number').fill(idNumber);
    await fresh
      .getByLabel('ID document — front')
      .setInputFiles({ name: 'id-front.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await fresh.getByRole('button', { name: /Submit/ }).click();
    await fresh.waitForURL(`**/app/kyc?result=${expected}`);
  };
  // Wait for hydration: the size check below is a client-side handler.
  await fresh.goto(`${baseUrl}/app/kyc`, SETTLED);
  check(
    'KYC form names the simulated vendor',
    (await fresh.getByText('Checked by:').count()) === 1 &&
      (await fresh.getByText('Simulated').count()) >= 1,
  );
  await fresh.getByLabel('ID document — front').setInputFiles({
    name: 'big.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(1024 * 1024 + 10, 1),
  });
  await fresh.getByText(/the limit is 1 MB/).waitFor();
  check('a document over 1 MB is refused in the browser', true);
  await submitKyc('GA-TEST-0000', 'REJECTED');
  await fresh.getByText('Verification unsuccessful').first().waitFor();
  check(
    'a rejected verification is explained',
    (await fresh.getByText('Verification unsuccessful').count()) >= 1,
  );
  check(
    'the customer can submit again after a rejection',
    (await fresh.getByRole('button', { name: 'Submit again' }).count()) === 1,
  );
  await submitKyc('GA-TEST-1234', 'APPROVED');
  await fresh.getByText('Identity verified').first().waitFor();
  check('a resubmission is approved', (await fresh.getByText('Identity verified').count()) >= 1);
  check('the tier is raised', (await fresh.getByText('Tier 1 — Verified').count()) >= 1);

  const documentHref = await fresh
    .getByRole('list', { name: 'Verification history' })
    .locator('a[download]')
    .first()
    .getAttribute('href');
  const ownDocument = await freshContext.request.get(`${baseUrl}${documentHref}`);
  check(
    'the customer can download their own document',
    ownDocument.status() === 200 &&
      ownDocument.headers()['content-disposition']?.startsWith('attachment') === true,
    String(ownDocument.status()),
  );
  const foreignDocument = await joaoContext.request.get(`${baseUrl}${documentHref}`);
  check(
    "another customer's KYC document is a 404",
    foreignDocument.status() === 404,
    String(foreignDocument.status()),
  );

  // Profile
  await fresh.goto(`${baseUrl}/app/profile`, SETTLED);
  await fresh.getByLabel('City').fill('Libreville');
  await fresh.getByLabel('Mobile phone').fill(`+24166${uniqueDigits()}`);
  await fresh.getByRole('button', { name: 'Save profile' }).click();
  await fresh.getByText('Profile saved').waitFor();
  await fresh.reload(SETTLED);
  check('the profile is saved', (await fresh.getByLabel('City').inputValue()) === 'Libreville');

  // Security: TOTP enrolment
  await fresh.goto(`${baseUrl}/app/security`, SETTLED);
  await fresh.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  await fresh.getByText('Save this key now').waitFor();
  const secret = (await fresh.locator('p.font-mono').first().innerText()).replace(/\s/g, '');
  await fresh.getByLabel('Authentication code').fill(totp(secret));
  await fresh.getByRole('button', { name: 'Turn on two-factor' }).click();
  await fresh.getByRole('button', { name: 'Turn off two-factor' }).waitFor();
  check('two-factor authentication can be turned on', true);

  // A second session (signing in now needs the code), then sign it out from the first
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  await second.goto(`${baseUrl}/login`, SETTLED);
  await second.getByLabel('E-mail').fill(email);
  await second.locator('input[name="password"]').fill(password);
  await second.getByRole('button', { name: 'Sign in' }).click();
  await second.getByLabel('Authentication code').waitFor();
  await second.locator('input[name="password"]').fill(password);
  await second.getByLabel('Authentication code').fill(totp(secret));
  await second.getByRole('button', { name: 'Sign in' }).click();
  await second.waitForURL('**/app');

  await fresh.reload(SETTLED);
  check(
    'both sessions are listed',
    (await fresh.getByRole('list', { name: 'Active sessions' }).locator('li').count()) === 2,
  );
  fresh.once('dialog', (dialog) => dialog.accept());
  await fresh.getByRole('button', { name: 'Sign out all other sessions' }).click();
  await fresh
    .getByRole('list', { name: 'Active sessions' })
    .locator('li')
    .nth(1)
    .waitFor({ state: 'detached' });
  await second.goto(`${baseUrl}/app`, SETTLED);
  check('the other session is signed out', pathOf(second) === '/login', pathOf(second));
  await secondContext.close();

  // Turn two-factor off again (password + code)
  await fresh.locator('input[name="password"]').fill(password);
  await fresh.getByLabel('Authentication code').fill(totp(secret));
  fresh.once('dialog', (dialog) => dialog.accept());
  await fresh.getByRole('button', { name: 'Turn off two-factor' }).click();
  await fresh.getByRole('button', { name: 'Set up two-factor authentication' }).waitFor();
  check('two-factor authentication can be turned off', true);

  // Password change
  const newPassword = 'E2e-Customer-2027';
  await fresh.locator('input[name="currentPassword"]').fill('wrong-password-1');
  await fresh.locator('input[name="newPassword"]').fill(newPassword);
  await fresh.locator('input[name="confirmPassword"]').fill(newPassword);
  await fresh.getByRole('button', { name: 'Change password' }).click();
  await fresh.getByText('Incorrect password').waitFor();
  check('a wrong current password is refused', true);
  await fresh.locator('input[name="currentPassword"]').fill(password);
  await fresh.locator('input[name="newPassword"]').fill(newPassword);
  await fresh.locator('input[name="confirmPassword"]').fill(newPassword);
  await fresh.getByRole('button', { name: 'Change password' }).click();
  await fresh.getByText('Password changed').waitFor();
  const relogin = await login(await browser.newContext(), email, newPassword);
  check('the new password signs in', pathOf(relogin) === '/app', pathOf(relogin));

  check('no uncaught page errors', errors.length === 0, errors[0]);
  await Promise.all([aminaContext.close(), joaoContext.close(), freshContext.close()]);
}
