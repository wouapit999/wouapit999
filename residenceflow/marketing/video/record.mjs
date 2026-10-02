// Records a real walkthrough of GestPro at 1280x720 with Playwright.
// Run from /home/user/residenceflow:  node marketing/video/record.mjs <lang: en|fr> <outdir>
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const lang = process.argv[2] ?? "en";
const outDir = process.argv[3] ?? "/tmp/video";
mkdirSync(outDir, { recursive: true });
const BASE = "http://localhost:3100";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  locale: lang === "fr" ? "fr-FR" : "en-US",
  recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
});
// Hide the framework dev-tools badge on every page.
await ctx.addInitScript(() => {
  const add = () => {
    const s = document.createElement("style");
    s.textContent = "nextjs-portal{display:none!important}";
    document.documentElement.appendChild(s);
  };
  if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add);
});
const page = await ctx.newPage();
const t0 = Date.now();
const marks = [];
const mark = (name) => { marks.push({ name, t: (Date.now() - t0) / 1000 }); console.log(name, ((Date.now() - t0) / 1000).toFixed(1)); };

async function drag(x1, y1, x2, y2, steps = 30, button = "left") {
  await page.mouse.move(x1, y1);
  await page.mouse.down({ button });
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
    await sleep(10);
  }
  await page.mouse.up({ button });
}
async function smoothScroll(px, step = 20) {
  for (let y = 0; y < px; y += step) { await page.mouse.wheel(0, step); await sleep(16); }
}
async function setLocale() {
  const b = page.locator(`button[name=locale][value=${lang}]`).first();
  if (await b.count() && (await b.getAttribute("aria-pressed")) !== "true") {
    await b.click(); await page.waitForLoadState("networkidle");
  }
}

mark("start");
await page.goto(`${BASE}/login`);
await page.waitForLoadState("networkidle");
await setLocale();
mark("login-page");
await sleep(1200);
await page.locator("input[name=identifier]").click();
await page.locator("input[name=identifier]").pressSequentially("admin@example.test", { delay: 45 });
await page.locator("input[name=password]").click();
await page.locator("input[name=password]").pressSequentially("Demo!Pass2026", { delay: 40 });
await sleep(400);
mark("login-submit");
await page.locator("form button[type=submit]").first().click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
await page.waitForLoadState("networkidle");
await setLocale();
mark("dashboard");
await sleep(1500);
await smoothScroll(700, 14);
await sleep(800);
mark("dashboard-end");

await page.goto(`${BASE}/properties`);
await page.waitForLoadState("networkidle");
mark("buildings");
await sleep(1800);
const akwa = page.locator("main a[href^='/properties/']:has-text('Akwa')").first();
const href = (await akwa.getAttribute("href")).split("?")[0];
const akwaId = href.split("/")[2];
await akwa.hover(); await sleep(400);
await page.goto(`${BASE}${href}`);
await page.waitForLoadState("networkidle");
mark("building-detail");
await sleep(1800);
const btn3d = page.locator("a[href$='/3d']").first();
await btn3d.hover();
await sleep(500);
await btn3d.click();
await page.waitForLoadState("networkidle");
mark("3d-loading");
await page.waitForSelector("canvas", { timeout: 20000 });
await sleep(5000);
mark("3d-ready");
const canvas = page.locator("canvas").first();
const bb = await canvas.boundingBox();
const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
await drag(cx - 150, cy, cx + 200, cy - 30, 30);
await sleep(500);
mark("3d-explode");
const explode = page.locator("label:has-text('Explode'), label:has-text('carter')").first();
if (await explode.count()) { await explode.click(); await sleep(2500); await drag(cx, cy, cx + 140, cy - 10, 24); await sleep(800); }
mark("3d-end");

await page.goto(`${BASE}/invoices?propertyId=${akwaId}`);
await page.waitForLoadState("networkidle");
mark("invoices");
await sleep(1600);
await smoothScroll(260, 10);
await sleep(700);
mark("invoices-end");

await page.goto(`${BASE}/arrears?propertyId=${akwaId}`);
await page.waitForLoadState("networkidle");
mark("arrears");
await sleep(2500);
mark("arrears-end");

await page.goto(`${BASE}/maintenance?propertyId=${akwaId}`);
await page.waitForLoadState("networkidle");
mark("maintenance");
await sleep(2500);
mark("maintenance-end");

await page.goto(`${BASE}/receipts`);
await page.waitForLoadState("networkidle");
mark("receipts");
await sleep(1500);
const rl = page.locator("main a[href^='/receipts/']").first();
const r = (await rl.getAttribute("href")).split("?")[0];
await rl.hover(); await sleep(400);
await page.goto(`${BASE}${r}`);
await page.waitForLoadState("networkidle");
mark("receipt");
await sleep(3000);
mark("end");

const video = page.video();
await ctx.close();
const p = await video.path();
writeFileSync(path.join(outDir, `marks-${lang}.json`), JSON.stringify({ video: p, marks }, null, 2));
console.log("video", p);
await browser.close();
