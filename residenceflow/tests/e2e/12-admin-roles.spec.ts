import { test, expect } from "@playwright/test";
import { USERS, PASSWORD, login, uniq, idFromUrl } from "./helpers";

const PERMISSION = "building.view";

test.describe.serial("12. admin creates a custom role and grants a permission after re-authentication", () => {
  const roleName = uniq("Role");
  let roleId = "";

  test("create the role, confirm password, tick a permission and save", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/roles");
    const create = page.locator("form").filter({ has: page.locator("input[name=name]") });
    await create.locator("input[name=name]").fill(roleName);
    await create.locator("input[name=description]").fill("Created by the Playwright suite");
    await create.getByRole("button", { name: /^(create|créer)$/i }).click();
    await page.waitForURL(/\/admin\/roles\/[0-9a-f-]{36}$/);
    roleId = idFromUrl(page.url(), "roles");
    await expect(page.locator("main")).toContainText(roleName);

    // Sensitive edits need a password confirmation within the last 10 minutes. Signing in counts as
    // one, so the re-auth card only appears when the window has already lapsed; handle both states.
    const reauth = page.locator("form").filter({ has: page.locator("input[name=password]") });
    const confirmed = page.getByText(/password confirmed|mot de passe confirmé/i).first();
    await expect(reauth.or(confirmed).first()).toBeVisible();
    if (await reauth.count()) {
      await reauth.locator("input[name=password]").fill(PASSWORD);
      await reauth.getByRole("button", { name: /^(confirm|confirmer)$/i }).click();
      await expect(confirmed).toBeVisible({ timeout: 15_000 });
      await page.reload();
    }
    await expect(confirmed).toBeVisible();

    const box = page.locator(`input[name=permissions][value="${PERMISSION}"]`);
    await expect(box).toBeEnabled();
    await box.check();
    await page.getByRole("button", { name: /save permissions|enregistrer les permissions/i }).click();
    await expect(page.locator("[role=status]").filter({ hasText: /saved|enregistr|permissions/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("the permission persists on the next request", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto(`/admin/roles/${roleId}`);
    await expect(page.locator("main")).toContainText(roleName);
    await expect(page.locator(`input[name=permissions][value="${PERMISSION}"]`)).toBeChecked();
    await page.goto("/admin/roles");
    await expect(page.locator("main")).toContainText(roleName);
  });
});
