import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

// Chromium is preinstalled in this environment; only override the executable when the
// bundled Playwright browser is not available (e.g. `playwright install` was never run).
function chromiumExecutable(): string | undefined {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) return undefined;
  } catch {
    /* fall through to the preinstalled browser */
  }
  const fallback = "/opt/pw-browsers/chromium";
  return existsSync(fallback) ? fallback : undefined;
}

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 1,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    locale: "fr-FR",
    ...devices["Desktop Chrome"],
    launchOptions: { executablePath: chromiumExecutable() },
  },
  projects: [{ name: "chromium" }],
});
