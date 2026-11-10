/**
 * Core shell: public pages, authentication, role-based routing, registration.
 * Requires the demo data (amina@example.com, admin@bi-rem.local, …).
 */
export default async function core({ browser, baseUrl, check, login }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  // Public pages
  await page.goto(`${baseUrl}/`);
  check('landing renders', (await page.locator('h1').innerText()).includes('BI-Rem programme'));
  await page.goto(`${baseUrl}/roadmap`);
  check('roadmap lists the 13 phases', (await page.locator('ol > li').count()) === 13);
  check(
    'full roadmap is served',
    (await page.goto(`${baseUrl}/roadmap-full.html`)).status() === 200,
  );
  await page.goto(`${baseUrl}/status`);
  check(
    'status page reports operational',
    (await page.getByText('All systems operational').count()) === 1,
  );
  const health = await page.goto(`${baseUrl}/api/health`);
  check('health endpoint is ok', health.status() === 200 && (await health.json()).status === 'ok');
  const response = await page.goto(`${baseUrl}/`);
  const headers = response.headers();
  check(
    'security headers present',
    Boolean(
      headers['content-security-policy']?.includes("frame-ancestors 'none'") &&
      headers['strict-transport-security'] &&
      headers['x-request-id'],
    ),
  );
  const manifest = await page.goto(`${baseUrl}/manifest.webmanifest`);
  check('PWA manifest has icons', (await manifest.json()).icons.length >= 2);

  // Protection
  await page.goto(`${baseUrl}/admin`);
  check('signed-out /admin → login', page.url().includes('/login?next=%2Fadmin'), page.url());
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('E-mail').fill('amina@example.com');
  await page.locator('input[name="password"]').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Incorrect e-mail or password').waitFor();
  check('wrong password is rejected with a generic message', true);
  await page.close();

  // Role-based routing
  const customer = await login(context, 'amina@example.com');
  check('customer lands on /app', new URL(customer.url()).pathname === '/app', customer.url());
  await customer.goto(`${baseUrl}/admin`);
  check(
    'customer is kept out of /admin',
    new URL(customer.url()).pathname === '/app',
    customer.url(),
  );
  await customer.goto(`${baseUrl}/partner`);
  check(
    'customer is kept out of /partner',
    new URL(customer.url()).pathname === '/app',
    customer.url(),
  );
  await customer.getByRole('button', { name: 'Sign out' }).click();
  await customer.waitForURL('**/login');
  await customer.goto(`${baseUrl}/app`);
  check('after sign-out /app → login', customer.url().includes('/login'), customer.url());
  await customer.close();

  const staffContext = await browser.newContext();
  const admin = await login(staffContext, 'admin@bi-rem.local');
  check('admin lands on /admin', new URL(admin.url()).pathname === '/admin', admin.url());
  await admin.goto(`${baseUrl}/app`);
  check('admin is kept out of /app', new URL(admin.url()).pathname === '/admin', admin.url());
  await staffContext.close();

  const partnerContext = await browser.newContext();
  const partner = await login(partnerContext, 'partner@bi-rem.local');
  check('partner lands on /partner', new URL(partner.url()).pathname === '/partner', partner.url());
  await partnerContext.close();

  // Registration
  const fresh = await browser.newContext();
  const register = await fresh.newPage();
  await register.goto(`${baseUrl}/register`);
  await register.getByLabel('Full name').fill('E2E Tester');
  await register.getByLabel('E-mail').fill(`e2e-${Date.now()}@example.org`);
  await register.getByLabel('Country of residence').selectOption('GA');
  await register.locator('input[name="password"]').fill('E2e-Tester-2026');
  await register.getByLabel('Confirm password').fill('E2e-Tester-2026');
  await register.getByLabel('I understand this is a demonstration platform').check();
  await register.getByRole('button', { name: 'Create account' }).click();
  await register.waitForURL('**/app');
  check('registration opens the customer area', true);
  await fresh.close();

  check('no uncaught page errors', errors.length === 0, errors[0]);
  await context.close();
}
