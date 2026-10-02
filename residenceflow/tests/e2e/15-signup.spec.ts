import { test, expect, type Browser } from "@playwright/test";
import { USERS, login, uniq } from "./helpers";

const password = "Client!Pass2026x";

async function requestAccess(browser: Browser, email: string, org: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByRole("link", { name: /create a new enterprise|créer une nouvelle entreprise/i }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.fill("input[name=orgName]", org);
  await page.fill("input[name=adminName]", "New Client Admin");
  await page.fill("input[name=adminEmail]", email);
  await Promise.all([page.waitForURL(/\/signup\/requested/), page.locator("form button[type=submit]").click()]);
  await expect(page.locator("main, body")).toContainText(/request received|demande reçue/i);
  await ctx.close();
}

async function approveAsOperator(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, USERS.superadmin);
  await page.goto("/platform/access-requests");
  const row = page.locator("tr", { hasText: email }).first();
  await expect(row).toContainText(/pending|en attente/i);
  await row.getByRole("button", { name: /approve|approuver/i }).click();
  const code = (await row.locator("[data-testid=access-code]").textContent({ timeout: 15000 }))?.trim() ?? "";
  expect(code).toMatch(/^\d{4}-\d{4}$/);
  await ctx.close();
  return code;
}

test.describe("15. a new client gets access through operator approval and a 20-minute code", () => {
  test("request → approve → code → enterprise created and isolated", async ({ page, browser }) => {
    const stamp = uniq();
    const email = `owner-${stamp}@newclient.test`;
    await requestAccess(browser, email, `Immobilière ${stamp}`);

    // Without approval there is no code: a guess is refused.
    await page.goto("/signup/verify");
    await page.fill("input[name=email]", email);
    await page.fill("input[name=code]", "0000-0000");
    await page.locator("form button[type=submit]").click();
    await expect(page.locator("form [role=alert]").first()).toContainText(/not valid|pas valable/i);

    const code = await approveAsOperator(browser, email);

    // Wrong code after approval is refused; the right one proceeds.
    await page.goto("/signup/verify?email=" + encodeURIComponent(email));
    await page.fill("input[name=code]", "1111-1111");
    await page.locator("form button[type=submit]").click();
    await expect(page.locator("form [role=alert]").first()).toContainText(/not valid|pas valable/i);
    await page.fill("input[name=code]", code);
    await Promise.all([page.waitForURL(/\/signup\/complete/), page.locator("form button[type=submit]").click()]);

    await page.fill("input[name=password]", password);
    await page.fill("input[name=confirm]", password);
    await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 30000 }), page.locator("form button[type=submit]").click()]);

    // Fresh, isolated workspace.
    await page.goto("/properties");
    await expect(page.locator("main")).not.toContainText(/Résidence Akwa|Bonapriso/);
    await page.goto("/tenants");
    await expect(page.locator("main")).not.toContainText(/Fatou Ndiaye|Mbarga/);
    await page.goto("/admin/general");
    await expect(page).toHaveURL(/\/admin\/general/);

    // The code is single use: it cannot create a second enterprise.
    const again = await browser.newContext();
    const p2 = await again.newPage();
    await p2.goto("/signup/verify?email=" + encodeURIComponent(email));
    await p2.fill("input[name=code]", code);
    await p2.locator("form button[type=submit]").click();
    await expect(p2.locator("form [role=alert]").first()).toContainText(/not valid|pas valable/i);
    await again.close();
  });

  test("an email that already has an account cannot request access", async ({ page }) => {
    await page.goto("/signup");
    await page.fill("input[name=orgName]", "Doublon");
    await page.fill("input[name=adminName]", "Someone");
    await page.fill("input[name=adminEmail]", USERS.admin);
    await page.locator("form button[type=submit]").click();
    await expect(page.locator("form [role=alert]").first()).toContainText(/already exists|existe déjà/i);
  });
});
