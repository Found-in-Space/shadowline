import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.route("https://tiles.mapterhorn.com/**", (route) => route.abort());
  await page.route("https://data.foundin.space/api/v1/location", (route) => route.abort());
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
  await expect(page.getByText("You can see totality from this location.")).toBeVisible();
  await expect(page.locator('a[href*="shadow-cones"]')).toHaveCount(0);
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

  await expect(page.locator("#offline-status")).toContainText(
    "Ready to work offline",
  );
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "12 August 2026" }),
  ).toBeVisible();
  await expect(page.getByText("You can see totality from this location.")).toBeVisible();
  await expect(page.locator("#clock-status")).toHaveText("Time checked earlier");
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
    "Height estimated from the terrain map: 2 m above sea level.",
  );
  await expect(page.locator("#contact-list li")).toHaveCount(5);
  await context.close();
});

test("does not invent a zero-zero observer when coordinates are absent", async ({
  page,
}) => {
  await page.goto("/tracker/202608/");
  await expect(page.locator("#location-label")).toHaveText(
    "Choose a location to see your eclipse times",
  );
  expect(new URL(page.url()).searchParams.has("lat")).toBe(false);
});

test("uses a clearly labelled rough location only as a fallback", async ({
  page,
}) => {
  await page.unroute("https://data.foundin.space/api/v1/location");
  await page.route("https://data.foundin.space/api/v1/location", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
      body: JSON.stringify({
        available: true,
        precision: "ip",
        latitude: 65.1411,
        longitude: -25.3272,
        city: "Reykjavik",
        region: "Capital Region",
        countryName: "Iceland",
        countryCode: "IS",
        postalCode: null,
        timezone: "Atlantic/Reykjavik",
      }),
    }),
  );
  await page.goto("/tracker/202608/");

  await expect(page.locator("#location-label")).toHaveText(
    "Rough location",
  );
  await expect(page.locator("#location-message")).toContainText(
    "Use GPS or enter a location before relying on these times",
  );
  await expect(page.locator("#contact-list li")).toHaveCount(5);
  const currentUrl = new URL(page.url());
  expect(currentUrl.searchParams.get("location")).toBe("geoip");
  expect(currentUrl.searchParams.get("lat")).toBe("65.141100");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("shadowline-tracker-202608-location"),
    ),
  ).toBeNull();
});
