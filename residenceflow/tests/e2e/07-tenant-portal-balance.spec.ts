import { test, expect, type Page } from "@playwright/test";
import { USERS, login, parseMoney, selectByLabel } from "./helpers";

const PAYMENT = 500;

async function readOutstanding(page: Page): Promise<number> {
  await page.goto("/portal/billing");
  const value = page.locator("section[aria-label] .text-2xl").first();
  await expect(value).toBeVisible();
  const n = parseMoney((await value.textContent()) ?? "");
  expect(Number.isFinite(n)).toBe(true);
  return n;
}

test.describe.serial("7. tenant portal reflects a cashier payment", () => {
  let before = 0;

  test("tenant reads the current outstanding balance", async ({ page }) => {
    await login(page, USERS.tenant);
    await expect(page).toHaveURL(/\/portal\/home/);
    before = await readOutstanding(page);
    expect(before).toBeGreaterThan(PAYMENT);
  });

  test("cashier records a payment for Fatou Ndiaye", async ({ page }) => {
    await login(page, USERS.cashier);
    await page.goto("/payments/new");
    await selectByLabel(page, "select[name=tenantId]", /Fatou Ndiaye/);
    await page.getByRole("button", { name: /load tenant|charger le locataire/i }).click();
    await page.waitForURL(/\/payments\/new\?.*tenantId=/);
    await page.locator("input[name=amount]").fill(String(PAYMENT));
    await page.locator("select[name=method]").selectOption("MOBILE_MONEY");
    await page.locator("button[type=submit]").last().click();
    await page.waitForURL(/\/payments\/[0-9a-f-]{36}\?recorded=confirmed/);
  });

  test("tenant sees the balance decreased by the payment", async ({ page }) => {
    await login(page, USERS.tenant);
    const after = await readOutstanding(page);
    expect(after).toBeCloseTo(before - PAYMENT, 0);
    await page.goto("/portal/payments");
    await expect(page.locator("main")).toContainText(/PAY-\d+/);
  });
});
