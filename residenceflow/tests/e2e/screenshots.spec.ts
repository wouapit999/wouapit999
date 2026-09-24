import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { USERS, login, UUID_RE } from "./helpers";

/**
 * Captures full-page PNGs for the documentation (docs/SCREENSHOTS.md) at desktop and phone sizes.
 * Files are named docs/screenshots/<role>-<page>.png and <role>-<page>-mobile.png.
 */
const OUT = "docs/screenshots";
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } } as const;

type Shot = { name: string; path: string | ((page: Page) => Promise<string>); after?: (page: Page) => Promise<void> };

/** Opens a list page and returns the first detail link (/<module>/<uuid>). */
function firstDetail(listPath: string, module: string) {
  return async (page: Page) => {
    await page.goto(listPath);
    await expect(page.locator(`main a[href^='/${module}/']`).first()).toBeVisible();
    const hrefs = await page.locator(`main a[href^='/${module}/']`).evaluateAll((els) => els.map((a) => a.getAttribute("href") ?? ""));
    const href = hrefs.find((h) => new RegExp(`^/${module}/[0-9a-f-]{36}(\\?|$)`, "i").test(h));
    expect(href, `detail link on ${listPath}`).toBeDefined();
    expect(href!).toMatch(UUID_RE);
    return href!.split("?")[0];
  };
}

async function toggleTheme(page: Page) {
  await page.locator("header form button[name=theme]").click();
  await page.waitForLoadState("networkidle");
}

const GROUPS: { role: keyof typeof USERS | "public"; shots: Shot[] }[] = [
  { role: "public", shots: [{ name: "login", path: "/login" }] },
  {
    role: "admin",
    shots: [
      { name: "dashboard", path: "/dashboard" },
      { name: "properties", path: "/properties" },
      { name: "property-detail", path: firstDetail("/properties", "properties") },
      { name: "units", path: "/units" },
      { name: "tenants", path: "/tenants" },
      { name: "tenant-detail", path: firstDetail("/tenants", "tenants") },
      { name: "leases", path: "/leases" },
      { name: "lease-detail", path: firstDetail("/leases", "leases") },
      { name: "invoices", path: "/invoices" },
      { name: "invoice-detail", path: firstDetail("/invoices", "invoices") },
      { name: "payments", path: "/payments" },
      { name: "payment-detail", path: firstDetail("/payments", "payments") },
      { name: "receipt", path: firstDetail("/receipts", "receipts") },
      { name: "arrears", path: "/arrears" },
      { name: "deposits", path: "/deposits" },
      { name: "maintenance", path: "/maintenance" },
      { name: "maintenance-detail", path: firstDetail("/maintenance", "maintenance") },
      { name: "reports", path: "/reports" },
      { name: "admin-branding", path: "/admin/branding" },
      { name: "admin-roles", path: "/admin/roles" },
      { name: "admin-users", path: "/admin/users" },
      { name: "admin-audit-logs", path: "/admin/audit-logs" },
      { name: "dashboard-dark", path: "/dashboard", after: toggleTheme },
    ],
  },
  { role: "concierge", shots: [{ name: "dashboard", path: "/dashboard" }, { name: "visitors", path: "/concierge/visitors" }] },
  { role: "technician", shots: [{ name: "dashboard", path: "/dashboard" }] },
  { role: "owner", shots: [{ name: "dashboard", path: "/dashboard" }] },
  {
    role: "tenant",
    shots: [
      { name: "portal-home", path: "/portal/home" },
      { name: "portal-billing", path: "/portal/billing" },
      { name: "portal-maintenance", path: "/portal/maintenance" },
    ],
  },
];

test.describe("documentation screenshots", () => {
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  for (const group of GROUPS) {
    test(`${group.role}: ${group.shots.length} page(s) at desktop and phone width`, async ({ page }) => {
      test.setTimeout(240_000);
      if (group.role !== "public") await login(page, USERS[group.role]);
      for (const shot of group.shots) {
        const url = typeof shot.path === "string" ? shot.path : await shot.path(page);
        for (const [vp, size] of Object.entries(VIEWPORTS)) {
          await page.setViewportSize(size);
          await page.goto(url);
          await page.waitForLoadState("networkidle");
          if (shot.after) await shot.after(page);
          await expect(page.locator("body")).not.toContainText(/Application error|server-side exception/i);
          const file = `${OUT}/${group.role}-${shot.name}${vp === "mobile" ? "-mobile" : ""}.png`;
          await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
          if (shot.after === toggleTheme) await toggleTheme(page); // restore light mode for the next shot
        }
      }
    });
  }
});
