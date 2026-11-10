import { test as setup } from '@playwright/test';

import { ACCOUNTS, type AccountName, storageStatePath } from './env';
import { pathOf, signIn } from './support';

/**
 * Signs in once per demo account and stores the session, so the specs never sign in again (the
 * app under test enforces its production rate limits on /login).
 */

const HOME: Record<AccountName, string> = {
  admin: '/admin',
  compliance: '/admin',
  treasury: '/admin',
  support: '/admin',
  partner: '/partner',
  agent: '/partner',
  amina: '/app',
  joao: '/app',
};

for (const [name, email] of Object.entries(ACCOUNTS) as Array<[AccountName, string]>) {
  setup(`sign in as ${name}`, async ({ page }) => {
    await signIn(page, email);
    setup.expect(pathOf(page)).toBe(HOME[name]);
    await page.context().storageState({ path: storageStatePath(name) });
  });
}
