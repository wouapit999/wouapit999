// Viewport screenshots (desktop 1280x720, phone 390x844) in a given UI language, for the promo video.
// Run from /home/user/residenceflow:  node marketing/video/shots.mjs <lang> <outdir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const lang = process.argv[2] ?? "en";
const out = process.argv[3] ?? "/tmp/shots";
mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3100";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", headless: true });

async function session(viewport, user, pages) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: lang === "fr" ? "fr-FR" : "en-US" });
  await ctx.addInitScript(() => {
    const add = () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.documentElement.appendChild(s); };
    if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add);
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.locator("input[name=identifier]").fill(user);
  await page.locator("input[name=password]").fill("Demo!Pass2026");
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  // The UI language is resolved from this cookie first; login resets it from the user record, so set it after login.
  await ctx.addCookies([{ name: "rf_locale", value: lang, url: BASE }]);
  for (const [name, path] of pages) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle");
    await sleep(600);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(name);
  }
  await ctx.close();
}

const D = { width: 1280, height: 720 }, M = { width: 390, height: 844 };
await session(D, "admin@example.test", [
  ["roles", "/admin/roles"], ["audit", "/admin/audit-logs"], ["reports", "/reports"], ["payments", "/payments"], ["leases", "/leases"], ["tenants", "/tenants"],
]);
await session(M, "admin@example.test", [["m-dashboard", "/dashboard"], ["m-properties", "/properties"], ["m-arrears", "/arrears"], ["m-maintenance", "/maintenance"]]);
await session(M, "tenant@example.test", [["m-portal-home", "/portal/home"], ["m-portal-billing", "/portal/billing"]]);
await browser.close();
