import { test, expect } from "@playwright/test";
import { USERS, PASSWORD, login } from "./helpers";

test("13. admin generates a one-time password reset link; the password is never shown", async ({ page }) => {
  await login(page, USERS.admin);
  await page.goto("/admin/users");
  const row = page.locator("table tbody tr").filter({ hasText: USERS.vendor });
  await row.locator("a[href^='/admin/users/']").first().click();
  await page.waitForURL(/\/admin\/users\/[0-9a-f-]{36}/);
  await expect(page.locator("main")).toContainText(USERS.vendor);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /generate link|générer le lien/i }).click();
  const status = page.locator("[role=status]").filter({ hasText: /reset-password/ });
  await expect(status).toBeVisible({ timeout: 15_000 });
  const code = status.locator("code").filter({ hasText: /\/reset-password\// }).first();
  await expect(code).toBeVisible();
  expect(await code.textContent()).toMatch(/\/reset-password\/[A-Za-z0-9_-]{16,}/);

  const body = await page.locator("body").innerText();
  expect(body).not.toContain(PASSWORD);
  expect(body).not.toMatch(/password\s*:\s*\S+/i);
});
