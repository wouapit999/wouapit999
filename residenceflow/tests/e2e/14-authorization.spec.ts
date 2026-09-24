import { test, expect } from "@playwright/test";
import { USERS, login } from "./helpers";

test.describe("14. authorization boundaries", () => {
  test("unauthenticated /dashboard redirects to /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("concierge cannot open /invoices", async ({ page }) => {
    await login(page, USERS.concierge);
    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/unauthorized/);
    await expect(page.getByRole("heading", { name: "403" })).toBeVisible();
  });

  test("technician cannot open /tenants", async ({ page }) => {
    await login(page, USERS.technician);
    await page.goto("/tenants");
    await expect(page).toHaveURL(/\/unauthorized/);
  });

  test("owner cannot open /admin/users", async ({ page }) => {
    await login(page, USERS.owner);
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/unauthorized/);
  });

  test("tenant is bounced from /dashboard to /portal/home", async ({ page }) => {
    await login(page, USERS.tenant);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/portal\/home/);
  });

  test("tenant gets 404 on another tenant's invoice", async ({ page }) => {
    // Find an invoice that belongs to someone other than Fatou Ndiaye (the demo tenant).
    await login(page, USERS.accountant);
    await page.goto("/invoices");
    const rows = page.locator("table tbody tr").filter({ hasNot: page.getByText("Fatou Ndiaye") });
    const link = rows.locator("a[href^='/invoices/']").first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    const otherInvoiceId = href!.split("/").pop()!;

    await login(page, USERS.tenant);
    const res = await page.goto(`/portal/billing/${otherInvoiceId}`);
    expect(res?.status()).toBe(404);
  });
});
