import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Demo!Pass2026";

export const USERS = {
  admin: "admin@example.test",
  manager: "manager@example.test",
  accountant: "accountant@example.test",
  cashier: "cashier@example.test",
  concierge: "concierge@example.test",
  tenant: "tenant@example.test",
  maintenanceManager: "maintenance.manager@example.test",
  technician: "technician@example.test",
  vendor: "vendor@example.test",
  owner: "owner@example.test",
  auditor: "auditor@example.test",
  superadmin: "superadmin@example.test",
} as const;

export type UserKey = keyof typeof USERS;

/** Unique suffix so records created by the suite never collide with seeded or previous-run data. */
export function uniq(prefix = "E2E") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Sign in through the real login form and wait for the post-login redirect. */
export async function login(page: Page, email: string, password: string = PASSWORD) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("input[name=identifier]").fill(email);
  await page.locator("input[name=password]").fill(password);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await expect(page.locator("body")).not.toContainText(/Application error|server-side exception/i);
}

/** Sign out through the header user menu, falling back to clearing the session cookie. */
export async function logout(page: Page) {
  const menu = page.locator("header details summary").last();
  if (await menu.count()) {
    await menu.click();
    const btn = page.getByRole("button", { name: /sign out|se déconnecter/i });
    if (await btn.count()) {
      await btn.click();
      await page.waitForURL(/\/login/, { timeout: 15_000 }).catch(() => undefined);
    }
  }
  await page.context().clearCookies();
}

/** Fails if the page rendered a Next.js error boundary or a 404. */
export async function expectHealthyPage(page: Page) {
  const body = page.locator("body");
  await expect(body).not.toContainText(/Application error|server-side exception|Internal Server Error/i);
  await expect(page.getByText(/^404$|This page could not be found/i)).toHaveCount(0);
}

/** Parses a formatted money string ("195 000 XAF", "1 234,50 €", "1,234.50") into a number. */
export function parseMoney(text: string): number {
  const cleaned = text.replace(/[^\d.,-]/g, "");
  const m = cleaned.match(/^(-?)(.*?)(?:[.,](\d{1,2}))?$/);
  if (!m) return Number.NaN;
  const intPart = m[2].replace(/[.,]/g, "");
  const dec = m[3] ?? "0";
  return Number(`${m[1]}${intPart}.${dec}`);
}

/** Selects the <select> option whose visible label matches, returning its value. */
export async function selectByLabel(page: Page, selectSelector: string, label: RegExp) {
  const select = page.locator(selectSelector);
  await expect(select).toBeVisible();
  const options = select.locator("option");
  const n = await options.count();
  for (let i = 0; i < n; i++) {
    const opt = options.nth(i);
    const text = (await opt.textContent()) ?? "";
    const value = await opt.getAttribute("value");
    if (value && label.test(text)) {
      await select.selectOption(value);
      return value;
    }
  }
  throw new Error(`No option in ${selectSelector} matches ${label}`);
}

/** Extracts the UUID from a detail URL such as /leases/<uuid>. */
export function idFromUrl(url: string, segment: string): string {
  const m = url.match(new RegExp(`/${segment}/([0-9a-f-]{36})`, "i"));
  if (!m) throw new Error(`No ${segment} id in ${url}`);
  return m[1];
}

export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
