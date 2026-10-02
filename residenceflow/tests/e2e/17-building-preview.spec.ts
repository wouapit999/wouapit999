import { test, expect } from "@playwright/test";
import { USERS, login } from "./helpers";

const uuid = /[0-9a-f]{8}-[0-9a-f-]{27}/;

test("17. hovering a building link shows a picture of the building", async ({ page, request }) => {
  await login(page, USERS.admin);
  await page.goto("/properties");
  const hrefs = await page.locator("main a[href^='/properties/']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  const href = hrefs.find((h) => uuid.test(h))!;
  const id = href.match(uuid)![0];
  const link = page.locator(`main a[href='${href}']`).first();
  await expect(link).toBeVisible();

  await link.hover();
  const card = page.locator("[data-testid=building-preview]");
  await expect(card).toBeVisible();
  const img = card.locator("img");
  await expect(img).toHaveAttribute("src", `/api/properties/${id}/preview`);
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(card).toContainText(await link.innerText());

  await page.mouse.move(0, 0);
  await expect(card).toBeHidden();

  // The picture endpoint is scoped: it answers SVG for the signed-in user and refuses anonymous callers.
  const ok = await page.request.get(`/api/properties/${id}/preview`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toContain("image/svg+xml");
  expect(await ok.text()).toContain("<svg");
  const anon = await request.get(`/api/properties/${id}/preview`);
  expect(anon.status()).toBe(401);
});
