import { test, expect } from "@playwright/test";
import { uniq } from "./helpers";

test.describe("15. a new client creates its own enterprise", () => {
  const password = "Client!Pass2026x";

  test("login page offers the button and sign-up creates an isolated enterprise", async ({ page }) => {
    const stamp = uniq();
    const email = `owner-${stamp}@newclient.test`;
    await page.goto("/login");
    await page.getByRole("link", { name: /create a new enterprise|créer une nouvelle entreprise/i }).click();
    await expect(page).toHaveURL(/\/signup/);
    await page.fill("input[name=orgName]", `Immobilière ${stamp}`);
    await page.fill("input[name=adminName]", "New Client Admin");
    await page.fill("input[name=adminEmail]", email);
    await page.fill("input[name=password]", password);
    await page.fill("input[name=confirm]", password);
    await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 30000 }), page.locator("form button[type=submit]").click()]);
    // Fresh workspace: no buildings, and the seeded organization's data is not visible.
    await page.goto("/properties");
    await expect(page.locator("main")).not.toContainText(/Résidence Akwa|Bonapriso/);
    await page.goto("/tenants");
    await expect(page.locator("main")).not.toContainText(/Fatou Ndiaye|Mbarga/);
    await page.goto("/admin/general");
    await expect(page).toHaveURL(/\/admin\/general/);
  });

  test("the same email cannot register twice", async ({ page, browser }) => {
    const stamp = uniq();
    const email = `twice-${stamp}@newclient.test`;
    // First registration in its own browser context (it signs the new admin in).
    const first = await browser.newContext();
    const p1 = await first.newPage();
    await p1.goto("/signup");
    await p1.fill("input[name=orgName]", `Première ${stamp}`);
    await p1.fill("input[name=adminName]", "Someone");
    await p1.fill("input[name=adminEmail]", email);
    await p1.fill("input[name=password]", password);
    await p1.fill("input[name=confirm]", password);
    await Promise.all([p1.waitForURL(/\/dashboard/, { timeout: 30000 }), p1.locator("form button[type=submit]").click()]);
    await first.close();
    // Second registration with the same email must be refused.
    await page.goto("/signup");
    await page.fill("input[name=orgName]", `Doublon ${stamp}`);
    await page.fill("input[name=adminName]", "Someone");
    await page.fill("input[name=adminEmail]", email);
    await page.fill("input[name=password]", password);
    await page.fill("input[name=confirm]", password);
    await page.locator("form button[type=submit]").click();
    await expect(page.locator("form [role=alert]").first()).toContainText(/already exists|existe déjà/i);
    await expect(page).toHaveURL(/\/signup/);
  });
});
