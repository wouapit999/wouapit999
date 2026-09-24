import { test, expect } from "@playwright/test";
import { USERS, login, uniq, selectByLabel, idFromUrl, UUID_RE } from "./helpers";

/**
 * Scenarios 2 → 6 form one business chain (building → unit → tenant → lease → invoice → payment)
 * so they run serially and share the ids created along the way.
 */
test.describe.serial("2–6. building → unit → tenant → lease → invoice → payment → public receipt check", () => {
  const tag = uniq();
  const buildingName = `Immeuble ${tag}`;
  const unitNumber = `U-${tag.slice(-6)}`;
  const tenantName = `Locataire ${tag}`;
  let propertyId = "";
  let unitId = "";
  let tenantId = "";
  let leaseId = "";
  let invoiceId = "";
  let paymentId = "";
  let verifyCode = "";

  test("2. admin creates a building and a unit", async ({ page }) => {
    await login(page, USERS.admin);

    await page.goto("/properties/new");
    await page.locator("input[name=name]").fill(buildingName);
    await page.locator("input[name=address]").fill("12 rue des Tests");
    await page.locator("input[name=city]").fill("Douala");
    await page.getByRole("button", { name: /^(save|enregistrer)$/i }).click();
    await page.waitForURL(/\/properties\/[0-9a-f-]{36}$/);
    propertyId = idFromUrl(page.url(), "properties");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(buildingName);

    await page.goto(`/units/new?propertyId=${propertyId}`);
    await expect(page.locator("select[name=propertyId]")).toHaveValue(propertyId);
    await page.locator("input[name=number]").fill(unitNumber);
    await page.locator("input[name=defaultRent]").fill("150000");
    await page.locator("input[name=defaultDeposit]").fill("300000");
    await page.getByRole("button", { name: /^(save|enregistrer)$/i }).click();
    await page.waitForURL(/\/units\/[0-9a-f-]{36}$/);
    unitId = idFromUrl(page.url(), "units");
    await expect(page.locator("main")).toContainText(unitNumber);
    await expect(page.locator("main")).toContainText(buildingName);

    // Manager and cashier roles are scoped to assigned buildings: grant them access to the new one.
    for (const staff of [USERS.manager, USERS.cashier]) {
      await page.goto("/admin/users");
      await page.locator("table tbody tr").filter({ hasText: staff }).locator("a[href^='/admin/users/']").first().click();
      await page.waitForURL(/\/admin\/users\/[0-9a-f-]{36}/);
      const accessForm = page.locator("form").filter({ has: page.locator("input[name=propertyIds]") });
      const scopeBox = accessForm.locator(`input[name=propertyIds][value="${propertyId}"]`);
      await expect(scopeBox).toBeVisible();
      await scopeBox.check();
      await accessForm.getByRole("button", { name: /^(save|enregistrer)$/i }).click();
      await expect(accessForm.locator("[role=status]")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("main")).toContainText(buildingName);
    }
  });

  test("3. manager creates a tenant and a draft lease on the new unit", async ({ page }) => {
    await login(page, USERS.manager);

    await page.goto("/tenants/new");
    await page.locator("input[name=legalName]").fill(tenantName);
    await page.locator("input[name=email]").fill(`${tag.toLowerCase()}@example.test`);
    await page.locator("input[name=phone]").fill("+237600000000");
    await page.getByRole("button", { name: /^(save|enregistrer)$/i }).click();
    await page.waitForURL(/\/tenants\/[0-9a-f-]{36}$/);
    tenantId = idFromUrl(page.url(), "tenants");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(tenantName);

    // Step 1: choose the unit (GET form), step 2: the lease form.
    await page.goto("/leases/new");
    await selectByLabel(page, "select[name=unitId]", new RegExp(unitNumber));
    await page.getByRole("button", { name: /^(continue|continuer)$/i }).click();
    await page.waitForURL(/\/leases\/new\?.*unitId=/);
    await expect(page.locator("input[name=unitId]")).toHaveValue(unitId);

    await selectByLabel(page, "select[name=tenantId]", new RegExp(tenantName));
    await page.locator("input[name=startDate]").fill("2027-01-01");
    await page.locator("input[name=endDate]").fill("2027-12-31");
    await page.locator("input[name=moveInDate]").fill("2027-01-01");
    await page.getByRole("button", { name: /^(save|enregistrer)$/i }).click();
    await page.waitForURL(/\/leases\/[0-9a-f-]{36}$/);
    leaseId = idFromUrl(page.url(), "leases");
    await expect(page.locator("main")).toContainText(tenantName);
    await expect(page.locator("main")).toContainText(/draft|brouillon/i);

    // Submit the draft for approval.
    await page.getByRole("button", { name: /submit for approval|soumettre pour approbation/i }).click();
    await expect(page.locator("main")).toContainText(/pending approval|submitted|en attente|soumis/i, { timeout: 15_000 });
  });

  test("4. admin approves & activates the lease and the rent schedule appears", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto(`/leases/${leaseId}`);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /approve & activate|approuver et activer/i }).click();
    await expect(page.locator("main span", { hasText: /^(active|actif)$/i }).first()).toBeVisible({ timeout: 15_000 });

    const schedule = page.locator("section").filter({ hasText: /rent schedule|échéancier des loyers/i });
    await expect(schedule).toBeVisible();
    const rows = schedule.locator("table tbody tr");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(12);
  });

  test("5. accountant issues an invoice for the new tenant", async ({ page }) => {
    await login(page, USERS.accountant);
    await page.goto(`/invoices/new?tenantId=${tenantId}`);
    await expect(page.locator("input[name=tenantId]")).toHaveValue(tenantId);
    await selectByLabel(page, "select[name=leaseId]", /ACTIVE/);
    await page.locator("input[name=issueDate]").fill("2027-01-01");
    await page.locator("input[name=dueDate]").fill("2027-01-10");
    await page.locator("input[name=line_0_description]").fill(`Loyer janvier ${tag}`);
    await page.locator("input[name=line_0_unitPrice]").fill("150000");
    await page.locator("input[name=issueNow]").check();
    await page.getByRole("button", { name: /create invoice|créer la facture/i }).click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    invoiceId = idFromUrl(page.url(), "invoices");
    await expect(page.locator("main")).toContainText(/INV-\d+/);
    await expect(page.locator("main")).toContainText(/\bissued\b|\bémise\b/i);
    await expect(page.locator("main")).toContainText(tenantName);
  });

  test("6. cashier records a partial payment; the receipt verifies publicly", async ({ page, browser }) => {
    await login(page, USERS.cashier);
    await page.goto(`/payments/new?tenantId=${tenantId}`);
    await expect(page.locator("input[name=tenantId]")).toHaveValue(tenantId);
    await page.locator("input[name=amount]").fill("50000");
    await page.locator("select[name=method]").selectOption("CASH");
    // The first submit button is the "Load tenant" GET form; the payment form's button is the last one.
    await page.locator("button[type=submit]").last().click();
    await page.waitForURL(/\/payments\/[0-9a-f-]{36}/);
    paymentId = idFromUrl(page.url(), "payments");
    expect(page.url()).toContain("recorded=confirmed");
    await expect(page.locator("main")).toContainText(/PAY-\d+/);

    const receiptLink = page.getByRole("link", { name: /view receipt|voir le reçu/i });
    await expect(receiptLink).toBeVisible();
    await receiptLink.click();
    await page.waitForURL(/\/receipts\/[0-9a-f-]{36}/);
    const body = (await page.locator("body").innerText()) ?? "";
    const m = body.match(/\/verify\/([A-Za-z0-9_-]{8,64})/);
    expect(m, "receipt shows a /verify/<code> URL").not.toBeNull();
    verifyCode = m![1];

    // The invoice is only partially paid.
    await page.goto(`/invoices/${invoiceId}`);
    await expect(page.locator("main")).toContainText(/partially paid|partiellement pay/i);

    // Public verification: fresh context, no cookies.
    const ctx = await browser.newContext();
    const pub = await ctx.newPage();
    await pub.goto(`/verify/${verifyCode}`);
    await expect(pub.getByText(/valid receipt|reçu valide/i)).toBeVisible();
    await expect(pub.locator("body")).not.toContainText(tenantName); // no personal data on the public page
    await pub.goto("/verify/definitely-not-a-code");
    await expect(pub.getByText(/receipt not found|reçu introuvable/i)).toBeVisible();
    await ctx.close();
    expect(paymentId).toMatch(UUID_RE);
  });
});
