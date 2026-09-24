import { test, expect } from "@playwright/test";
import { USERS, login, uniq, selectByLabel, idFromUrl } from "./helpers";

test.describe.serial("8–10. maintenance request: tenant → maintenance manager → technician", () => {
  const title = `Fuite ${uniq()}`;
  let requestId = "";

  test("8. tenant creates a maintenance request from the portal", async ({ page }) => {
    await login(page, USERS.tenant);
    await page.goto("/portal/maintenance/new");
    await page.locator("select[name=category]").selectOption({ index: 1 });
    await page.locator("select[name=priority]").selectOption("HIGH");
    await page.locator("input[name=title]").fill(title);
    await page.locator("textarea[name=description]").fill("Fuite d'eau sous l'évier de la cuisine, test automatisé.");
    await page.locator("input[name=location]").fill("Cuisine");
    await page.locator("form button[type=submit]").last().click();
    await page.waitForURL(/\/portal\/maintenance\/[0-9a-f-]{36}/);
    requestId = idFromUrl(page.url(), "maintenance");
    await expect(page.locator("main")).toContainText(title);
    await expect(page.locator("main")).toContainText(/submitted|soumis/i);
  });

  test("9. maintenance manager assigns the technician", async ({ page }) => {
    await login(page, USERS.maintenanceManager);
    await page.goto(`/maintenance/${requestId}`);
    await expect(page.locator("main")).toContainText(title);
    await selectByLabel(page, "select[name=assigneeId]", /Thierry Technicien/);
    await page.getByRole("button", { name: /^(assign|affecter)$/i }).click();
    await expect(page.locator("main")).toContainText(/Thierry Technicien/, { timeout: 15_000 });
    await expect(page.locator("main")).toContainText(/assign/i);
  });

  test("10. technician moves the work order to in progress, then completed", async ({ page }) => {
    await login(page, USERS.technician);
    await page.goto(`/maintenance/${requestId}`);
    await expect(page.locator("main")).toContainText(title);

    await page.locator("select[name=to]").selectOption("IN_PROGRESS");
    await page.getByRole("button", { name: /update status|mettre à jour le statut/i }).click();
    await expect(page.locator("select[name=to] option[value=COMPLETED]")).toHaveCount(1, { timeout: 15_000 });

    await page.locator("select[name=to]").selectOption("COMPLETED");
    await page.locator("textarea[name=completionSummary]").fill("Joint remplacé, plus de fuite.");
    await page.getByRole("button", { name: /update status|mettre à jour le statut/i }).click();
    await expect(page.locator("main").locator("span", { hasText: /^(completed|terminée)$/i }).first()).toBeVisible({ timeout: 15_000 });

    // The technician's list no longer shows it as open work, but the tenant can see the outcome.
    await login(page, USERS.tenant);
    await page.goto(`/portal/maintenance/${requestId}`);
    await expect(page.locator("main")).toContainText(/completed|terminé/i);
  });
});
