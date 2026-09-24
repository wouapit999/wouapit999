import { test, expect } from "@playwright/test";
import { USERS, login, uniq, selectByLabel } from "./helpers";

test.describe("11. concierge desk", () => {
  test("registers a visitor check-in for a resident", async ({ page }) => {
    const visitor = `Visiteur ${uniq()}`;
    await login(page, USERS.concierge);
    await page.goto("/concierge/visitors");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: /^(check in|enregistrer l'arrivée)$/i }) });
    await expect(form).toBeVisible();
    await selectByLabel(page, `${await formSelector(form)} select[name=propertyId]`, /Résidence Akwa/);
    await selectByLabel(page, `${await formSelector(form)} select[name=unitId]`, /\b1B\b/);
    await selectByLabel(page, `${await formSelector(form)} select[name=hostTenantId]`, /Fatou/);
    await form.locator("input[name=visitorName]").fill(visitor);
    await form.locator("input[name=visitorPhone]").fill("+237699000000");
    await form.locator("input[name=purpose]").fill("Visite familiale");
    await form.getByRole("button", { name: /^(check in|enregistrer l'arrivée)$/i }).click();
    await expect(form.locator("[role=status]")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.locator("main")).toContainText(visitor);
  });

  test("logs a parcel for a resident", async ({ page }) => {
    const recipient = `Colis ${uniq()}`;
    await login(page, USERS.concierge);
    await page.goto("/concierge/parcels");
    const form = page.locator("form").filter({ has: page.locator("input[name=recipientName]") });
    await expect(form).toBeVisible();
    await selectByLabel(page, `${await formSelector(form)} select[name=propertyId]`, /Résidence Akwa/);
    await selectByLabel(page, `${await formSelector(form)} select[name=unitId]`, /\b1B\b/);
    await form.locator("input[name=recipientName]").fill(recipient);
    await form.locator("input[name=carrier]").fill("DHL");
    await form.locator("input[name=trackingNumber]").fill(uniq("TRK"));
    await form.getByRole("button", { name: /log parcel|enregistrer et prévenir/i }).click();
    await expect(form.locator("[role=status]")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.locator("main")).toContainText(recipient);
  });
});

/** Gives each scenario form a stable id-based CSS selector so selectByLabel can scope to it. */
async function formSelector(form: import("@playwright/test").Locator) {
  const id = await form.evaluate((el) => {
    if (!el.id) el.id = `e2e-form-${Math.random().toString(36).slice(2, 8)}`;
    return el.id;
  });
  return `#${id}`;
}
