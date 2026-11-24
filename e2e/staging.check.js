import { test, expect } from "@playwright/test";

// muse staging gate: the staging preview must load, show the STAGING
// banner, and render the sign-in gate without console errors. Login is
// not performed here (read-only check): with no session the sign-in
// gate is the expected first screen.
test("muse staging page loads with banner and sign-in gate", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const resp = await page.goto("/muse/staging/");
  expect(resp.status()).toBe(200);
  await expect(page.getByText("STAGING")).toBeVisible();
  await expect(page.locator(".brand-name")).toHaveText("Muse");
  await expect(page.getByText("Googleログインが必要です")).toBeVisible();
  const footer = page.locator(".site-footer");
  await expect(footer).toBeVisible();
  const topLink = footer.getByRole("link", { name: /トップ/ });
  await expect(topLink).toHaveAttribute("href", "https://freddiefujiwara.com/");
  await expect(footer.locator(".copy")).toContainText("freddiefujiwara.com");
  await expect(footer.locator(".copy")).toContainText("©");
  expect(errors).toEqual([]);
});

test("muse staging header keeps the brand on one line at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const resp = await page.goto("/muse/staging/");
  expect(resp.status()).toBe(200);
  const box = await page.locator(".brand-name").boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeLessThan(30);
});
