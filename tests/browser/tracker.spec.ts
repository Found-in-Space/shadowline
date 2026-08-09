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
  await expect(page).toHaveTitle(/Found in Space/);
  await expect(page.getByText("Eclipse tracker", { exact: true })).toBeVisible();
  await expect(
    page.getByText("What this prediction can—and can’t—show", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('a[href="https://www.k-si.com/"]')).toHaveText(
    "Kaj Siebert",
  );
  await expect(page.getByText("You can see totality from this location.")).toBeVisible();
  await expect(page.locator('a[href*="shadow-cones"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Shadowline tracker");
  await expect(page.locator("#contact-list li")).toHaveCount(5);
  await expect
    .poll(() =>
      page
        .locator("#contact-list li")
        .first()
        .locator("div")
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(150);
  await expect(page.locator("#tracker-globe")).toHaveAttribute(
    "data-renderer-ready",
    "true",
  );
  for (const layer of [
    "center-and-limits",
    "local-penumbra",
    "local-central-shadow",
  ]) {
    await expect(page.locator("#tracker-globe")).toHaveAttribute(
      `data-layer-${layer}`,
      "true",
    );
  }
  for (const layer of [
    "central-path",
    "partial-extent",
    "horizon-limits",
    "contacts",
    "time-markers",
  ]) {
    await expect(page.locator("#tracker-globe")).toHaveAttribute(
      `data-layer-${layer}`,
      "false",
    );
  }
  await expect
    .poll(async () => Number((await page.locator("#tracker-globe").getAttribute("data-path-feature-count")) ?? 0))
    .toBeGreaterThan(0);

  await page.locator("#time-slider").evaluate((slider: HTMLInputElement) => {
    slider.value = String(Math.round(Number(slider.max) / 2));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#mode-badge")).toHaveText("PREVIEW");
  await expect(page.locator("#obscuration-value")).not.toHaveText("—");
  await expect
    .poll(async () => Number((await page.locator("#tracker-globe").getAttribute("data-shadow-feature-count")) ?? 0))
    .toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Map" }).click();
  await expect(page.locator("#tracker-map")).toHaveAttribute(
    "data-renderer-ready",
    "true",
  );
  await expect
    .poll(async () => Number((await page.locator("#tracker-map").getAttribute("data-path-feature-count")) ?? 0))
    .toBeGreaterThan(0);
  for (const layer of [
    "center-and-limits",
    "local-penumbra",
    "local-central-shadow",
  ]) {
    await expect(page.locator("#tracker-map")).toHaveAttribute(
      `data-layer-${layer}`,
      "true",
    );
  }
  for (const layer of [
    "central-path",
    "partial-extent",
    "horizon-limits",
    "contacts",
    "time-markers",
  ]) {
    await expect(page.locator("#tracker-map")).toHaveAttribute(
      `data-layer-${layer}`,
      "false",
    );
  }
  await expect(page.locator("#tracker-map")).toHaveAttribute(
    "data-global-feature-count",
    "0",
  );
  await expect
    .poll(async () => Number((await page.locator("#tracker-map").getAttribute("data-shadow-feature-count")) ?? 0))
    .toBeGreaterThan(0);
  await expect(page.locator("#tracker-map")).toHaveAttribute(
    "data-following-shadow",
    "true",
  );
  await expect(page.getByRole("button", { name: "Following shadow" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const mapBounds = await page.locator("#tracker-map").boundingBox();
  if (!mapBounds) throw new Error("The eclipse map has no visible bounds.");
  await page.mouse.move(mapBounds.x + mapBounds.width / 2, mapBounds.y + mapBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(mapBounds.x + mapBounds.width / 2 + 45, mapBounds.y + mapBounds.height / 2 + 20);
  await page.mouse.up();
  await expect(page.locator("#tracker-map")).toHaveAttribute(
    "data-following-shadow",
    "false",
  );
  await page.getByRole("button", { name: "Follow shadow", exact: true }).click();
  await expect(page.locator("#tracker-map")).toHaveAttribute(
    "data-following-shadow",
    "true",
  );

  await page.getByRole("tab", { name: "Shadow" }).click();
  await expect(page.locator("#tracker-shadow canvas")).toHaveCount(1);
  await expect(page.locator("#tracker-shadow")).toHaveAttribute(
    "data-renderer-ready",
    "true",
  );
  await expect(page.locator("#tracker-shadow")).toHaveAttribute(
    "data-following-shadow",
    "true",
  );
  const shadowBounds = await page.locator("#tracker-shadow canvas").boundingBox();
  if (!shadowBounds) throw new Error("The physical shadow view has no visible bounds.");
  await page.mouse.move(shadowBounds.x + shadowBounds.width / 2, shadowBounds.y + shadowBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(shadowBounds.x + shadowBounds.width / 2 + 45, shadowBounds.y + shadowBounds.height / 2 + 20);
  await page.mouse.up();
  await expect(page.locator("#tracker-shadow")).toHaveAttribute(
    "data-following-shadow",
    "false",
  );
  await page.getByRole("button", { name: "Follow shadow", exact: true }).click();
  await expect(page.locator("#tracker-shadow")).toHaveAttribute(
    "data-following-shadow",
    "true",
  );
  await page.getByRole("button", { name: "Earth + Moon" }).click();
  await expect(page.getByRole("button", { name: "Earth + Moon" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("tab", { name: "Globe" }).click();
  await expect(page.locator("#tracker-globe")).toBeVisible();

  await expect(page.locator("#offline-status")).toContainText(
    /ready for a poor connection/i,
  );
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "12 August 2026" }),
  ).toBeVisible();
  await expect(page.getByText("You can see totality from this location.")).toBeVisible();
  await expect(page.locator("#clock-status")).toHaveText("Time checked earlier");
  await page.getByRole("tab", { name: "Map" }).click();
  await expect(page.locator("#tracker-map")).toHaveAttribute(
    "data-renderer-ready",
    "true",
  );
  await page.getByRole("tab", { name: "Shadow" }).click();
  await expect(page.locator("#tracker-shadow canvas")).toHaveCount(1);
});

test("prepares optional views online without adding them to initial startup", async ({
  page,
}) => {
  await page.goto("/tracker/202608/?lat=65.1411&lon=-25.3272&elevation=0");

  const initiallyLoaded = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /leaflet-renderer|tracker-shadow-view/.test(name)),
  );
  expect(initiallyLoaded).toEqual([]);

  await expect
    .poll(
      () => page.locator("html").getAttribute("data-optional-views-ready"),
      { timeout: 20_000 },
    )
    .toBe("true");
  await expect(page.locator("#tracker-map")).toBeHidden();
  await expect(page.locator("#tracker-shadow")).toBeHidden();
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
    "The terrain map puts this location about 2 m above sea level.",
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

test("prefills manual location with valid, appropriately rounded GPS values", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: {
              accuracy: 8,
              altitude: 42.718281828,
              altitudeAccuracy: 12,
              heading: null,
              latitude: 65.141123456789,
              longitude: -25.327212345678,
              speed: null,
              toJSON() {
                return this;
              },
            },
            timestamp: Date.now(),
            toJSON() {
              return this;
            },
          });
        },
      },
    });
  });
  await page.goto("/tracker/202608/");

  await page.getByRole("button", { name: "Use my GPS" }).click();
  await expect(page.locator("#location-label")).toHaveText("Location from GPS");
  await page.getByRole("button", { name: "Enter a location" }).click();

  await expect(page.locator("#latitude-input")).toHaveValue("65.14112");
  await expect(page.locator("#longitude-input")).toHaveValue("-25.32721");
  await expect(page.locator("#elevation-input")).toHaveValue("43");
  expect(
    await page.locator("#manual-location").evaluate(
      (form: HTMLFormElement) => form.checkValidity(),
    ),
  ).toBe(true);
});

test("splits a pasted Google Maps coordinate pair across the manual inputs", async ({
  page,
}) => {
  await page.goto("/tracker/202608/");
  await page.getByRole("button", { name: "Enter a location" }).click();

  await page.locator("#latitude-input").evaluate((input) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/plain",
      "52.17165814560727, 4.481946799114639",
    );
    input.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData }),
    );
  });

  await expect(page.locator("#latitude-input")).toHaveValue(
    "52.17165814560727",
  );
  await expect(page.locator("#longitude-input")).toHaveValue(
    "4.481946799114639",
  );
});

test("marks the solar preview when the Sun is below the horizon", async ({
  page,
}) => {
  await page.goto(
    "/tracker/202608/?lat=-33.8688&lon=151.2093&elevation=0&at=2026-08-12T17:46:00.000Z",
  );

  await expect(page.locator("#solar-disc")).toHaveAttribute(
    "data-horizon",
    "below",
  );
  await expect(page.locator("#solar-disc")).toHaveClass(/is-below-horizon/);
  await expect(page.locator("#solar-preview-canvas")).toHaveAttribute(
    "data-renderer-ready",
    "true",
  );
  await expect(page.locator("#solar-disc")).toHaveAttribute(
    "data-direct-sun-visible",
    "false",
  );
  await expect(page.locator("#solar-disc")).toHaveAttribute(
    "data-horizon-edge",
    "0.00",
  );
  await expect(page.locator("#horizon-marker")).toBeVisible();
  await expect(page.locator("#horizon-marker")).toHaveText("Below horizon");
  await expect(page.locator("#solar-disc")).toHaveAttribute(
    "aria-label",
    /degrees below the horizon/,
  );
});

test("moves the horizon edge across the solar preview at sunset", async ({
  page,
}) => {
  await page.goto(
    "/tracker/202608/?lat=0&lon=5.2&elevation=0&at=2026-08-12T17:46:00.000Z",
  );

  await expect(page.locator("#solar-disc")).toHaveAttribute(
    "data-horizon",
    "crossing",
  );
  await expect(page.locator("#solar-disc")).toHaveClass(/is-horizon-crossing/);
  await expect(page.locator("#horizon-marker")).toHaveText(
    "Partly below horizon",
  );
  const edgePosition = Number(
    await page.locator("#solar-disc").getAttribute("data-horizon-edge"),
  );
  expect(edgePosition).toBeGreaterThan(0);
  expect(edgePosition).toBeLessThan(100);
  await expect(page.locator("#solar-disc")).toHaveAttribute(
    "data-atmospheric-glow",
    "visible",
  );
  await expect(page.locator("#solar-disc")).toHaveAttribute(
    "aria-label",
    /The horizon crosses the solar disc/,
  );
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
