import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.route("https://data.foundin.space/api/v1/time", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ unixTimeMs: Date.now() }),
    }),
  );
});

test("provides a mobile local eclipse field view and manual preview", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tracker/202608/?lat=65.1411&lon=-25.3272&elevation=0");

  await expect(
    page.getByRole("heading", { name: "12 August 2026" }),
  ).toBeVisible();
  await expect(page.getByText("Totality is visible from this position.")).toBeVisible();
  await expect(page.locator("#contact-list li")).toHaveCount(5);
  await expect(page.locator("#tracker-globe")).toHaveAttribute(
    "data-renderer-ready",
    "true",
  );
  await expect
    .poll(async () => Number((await page.locator("#tracker-globe").getAttribute("data-path-feature-count")) ?? 0))
    .toBeGreaterThan(0);

  await page.locator("#time-slider").evaluate((slider: HTMLInputElement) => {
    slider.value = String(Math.round(Number(slider.max) / 2));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#mode-badge")).toHaveText("PREVIEW");
  await expect(page.locator("#obscuration-value")).not.toHaveText("—");
  const modelHref = await page.getByRole("link", { name: /Explore the 3D Sun–Moon–Earth model/ }).getAttribute("href");
  expect(new URL(modelHref!, page.url()).pathname).toBe("/shadow-cones/");
  const modelUrl = new URL(modelHref!, page.url());
  const modelTime = modelUrl.searchParams.get("at");
  expect(modelTime).toMatch(/^2026-08-12T/);

  const modelPage = await context.newPage();
  await modelPage.goto(modelUrl.href);
  await expect(modelPage.locator("#time-label")).toHaveText(
    new Date(modelTime!).toISOString().slice(11, 19) + " UTC",
  );
  const returnHref = await modelPage.locator("#back-link").getAttribute("href");
  const returnUrl = new URL(returnHref!, modelPage.url());
  expect(returnUrl.pathname).toBe("/tracker/202608/");
  expect(returnUrl.searchParams.get("lat")).toBe("65.141100");
  expect(returnUrl.searchParams.get("at")).toBe(modelTime);
  await modelPage.close();

  await expect(page.locator("#offline-status")).toContainText(
    "App shell ready offline",
  );
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "12 August 2026" }),
  ).toBeVisible();
  await expect(page.getByText("Totality is visible from this position.")).toBeVisible();
  await expect(page.locator("#clock-status")).toHaveText("Last edge sync");
});

test("refines a missing observer elevation without blocking contacts", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await context.route("https://tiles.mapterhorn.com/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoYGz4DwAEBwIBci+7zgAAAABJRU5ErkJggg==",
        "base64",
      ),
    }),
  );
  await context.route("https://data.foundin.space/api/v1/time", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ unixTimeMs: Date.now() }),
    }),
  );
  const page = await context.newPage();
  await page.goto("/tracker/202608/?lat=65.1411&lon=-25.3272");

  await expect(page.locator("#location-message")).toContainText(
    "Terrain elevation refined to 2 m from GLO-30.",
  );
  await expect(page.locator("#contact-list li")).toHaveCount(5);
  await context.close();
});

test("does not invent a zero-zero observer when coordinates are absent", async ({
  page,
}) => {
  await page.goto("/tracker/202608/");
  await expect(page.locator("#location-label")).toHaveText(
    "Choose a location for local predictions",
  );
  expect(new URL(page.url()).searchParams.has("lat")).toBe(false);
});
