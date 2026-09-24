import { test, expect, type Page } from "@playwright/test";
import { USERS, login, logout, uniq } from "./helpers";

const ORIGINAL_APP_NAME = "ResidenceFlow";

async function saveAppName(page: Page, name: string) {
  await page.goto("/admin/general");
  const input = page.locator("input[name=appName]");
  await expect(input).toBeVisible();
  await input.fill(name);
  await page.getByRole("button", { name: /^(save|enregistrer)$/i }).click();
  await expect(page.locator("[role=status]").filter({ hasNot: page.locator("header") })).toBeVisible({ timeout: 15_000 });
}

test.describe.serial("1. branding: application name change is visible on the sidebar and login page", () => {
  const newName = uniq("Brand");

  test.afterAll(async ({ browser }) => {
    // Always restore the seeded branding even if an assertion failed midway.
    const page = await browser.newPage();
    try {
      await login(page, USERS.admin);
      await saveAppName(page, ORIGINAL_APP_NAME);
    } finally {
      await page.close();
    }
  });

  test("admin changes the app name and sees it in the sidebar, then on the login page", async ({ page }) => {
    await login(page, USERS.admin);
    await saveAppName(page, newName);

    await page.goto("/dashboard");
    await expect(page.locator("aside").getByText(newName, { exact: true })).toBeVisible();

    await logout(page);
    await page.goto("/login");
    await expect(page.getByText(newName, { exact: true })).toBeVisible();
  });

  test("restoring the original name is reflected on the login page", async ({ page }) => {
    await login(page, USERS.admin);
    await saveAppName(page, ORIGINAL_APP_NAME);
    await logout(page);
    await page.goto("/login");
    await expect(page.getByText(ORIGINAL_APP_NAME, { exact: true })).toBeVisible();
    await expect(page.getByText(newName)).toHaveCount(0);
  });
});
