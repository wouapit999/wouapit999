import { test, expect } from "@playwright/test";
import { USERS, login, expectHealthyPage } from "./helpers";

/** Every demo account can sign in and open its main pages without an error boundary or 404. */
const ROLE_PAGES: Record<keyof typeof USERS, string[]> = {
  admin: ["/dashboard", "/properties", "/units", "/tenants", "/leases", "/invoices", "/payments", "/receipts", "/arrears", "/deposits", "/maintenance", "/reports", "/admin", "/admin/branding", "/admin/roles", "/admin/users", "/admin/audit-logs"],
  manager: ["/dashboard", "/properties", "/units", "/tenants", "/leases", "/invoices", "/maintenance", "/reports"],
  accountant: ["/dashboard", "/invoices", "/payments", "/receipts", "/arrears", "/deposits", "/reports"],
  cashier: ["/dashboard", "/payments", "/receipts", "/payments/new"],
  concierge: ["/dashboard", "/concierge/visitors", "/concierge/parcels", "/concierge/incidents", "/maintenance"],
  tenant: ["/portal/home", "/portal/lease", "/portal/billing", "/portal/payments", "/portal/receipts", "/portal/maintenance", "/portal/profile"],
  maintenanceManager: ["/dashboard", "/maintenance", "/vendors", "/inspections", "/reports"],
  technician: ["/dashboard", "/maintenance"],
  vendor: ["/dashboard", "/maintenance"],
  owner: ["/dashboard", "/properties", "/leases", "/arrears", "/reports"],
  auditor: ["/dashboard", "/properties", "/tenants", "/invoices", "/reports", "/admin/audit-logs"],
  superadmin: ["/platform"],
};

for (const [key, pages] of Object.entries(ROLE_PAGES) as [keyof typeof USERS, string[]][]) {
  test(`smoke: ${key} (${USERS[key]}) can open ${pages.length} pages`, async ({ page }) => {
    await login(page, USERS[key]);
    for (const path of pages) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} status`).toBeLessThan(400);
      await expect(page, `${path} should not bounce to login/unauthorized`).not.toHaveURL(/\/(login|unauthorized)$/);
      await expectHealthyPage(page);
    }
  });
}
