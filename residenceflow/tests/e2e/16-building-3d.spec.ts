import { test, expect } from "@playwright/test";
import { USERS, login } from "./helpers";

const uuid = /[0-9a-f]{8}-[0-9a-f-]{27}/;

test("16. building 3D view renders and shows a unit's areas", async ({ page }) => {
  await login(page, USERS.admin);
  await page.goto("/properties");
  const hrefs = await page.locator("main a[href^='/properties/']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  const href = hrefs.find((h) => uuid.test(h) && /akwa/i.test(h) === false) ?? hrefs.find((h) => uuid.test(h))!;
  await page.goto(href);
  await page.getByRole("link", { name: /3D/ }).first().click();
  await expect(page).toHaveURL(/\/properties\/[0-9a-f-]+\/3d/);
  await expect(page.locator("[data-testid=building-3d] canvas")).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("button", { name: /all floors|tous les étages/i })).toBeVisible();

  // Open with a unit preselected: the panel lists its areas and links to the unit page.
  await page.goto("/units");
  const unitHrefs = await page.locator("main a[href^='/units/']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  const unitHref = unitHrefs.find((h) => uuid.test(h))!;
  await page.goto(unitHref);
  await page.getByRole("link", { name: /3D/ }).first().click();
  await expect(page).toHaveURL(/\/3d\?unit=/);
  const panel = page.locator("[data-testid=unit-panel]");
  await expect(panel).toBeVisible({ timeout: 20000 });
  await expect(panel).toContainText(/living room|salon|shop floor|surface de vente|main room|pièce principale/i);
  await expect(panel.getByRole("link", { name: /open unit page|ouvrir la fiche/i })).toHaveAttribute("href", unitHref);
});
