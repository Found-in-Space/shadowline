import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGIN = "http://127.0.0.1:4196";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === LOCAL_ORIGIN
      ? route.continue()
      : route.abort(),
  );
});

test("lays out the projections for wide and narrow browser viewports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/browse/?eclipse=solar-2026-08-12-total");

  const selectors = [
    ".mercator-panel",
    ".spacefarer-map-panel",
    ".world-panel",
    ".ground-panel",
  ];
  const wide = await page.evaluate((panelSelectors) =>
    panelSelectors.map((selector) => {
      const panel = document.querySelector(selector);
      const map = panel?.querySelector(".map-viewport");
      if (!panel || !map) {
        throw new Error(`The ${selector} projection has no viewport.`);
      }
      const panelBox = panel.getBoundingClientRect();
      const mapBox = map.getBoundingClientRect();
      return {
        panel: {
          top: panelBox.top,
          right: panelBox.right,
          bottom: panelBox.bottom,
          left: panelBox.left,
        },
        map: {
          top: mapBox.top,
          right: mapBox.right,
          bottom: mapBox.bottom,
          left: mapBox.left,
        },
      };
    }), selectors,
  );

  for (const { panel, map } of wide) {
    expect(map.top).toBeCloseTo(panel.top, 5);
    expect(map.right).toBeCloseTo(panel.right, 5);
    expect(map.bottom).toBeCloseTo(panel.bottom, 5);
    expect(map.left).toBeCloseTo(panel.left, 5);
  }
  expect(wide[0]!.panel.right).toBeCloseTo(wide[1]!.panel.left, 5);
  expect(wide[0]!.panel.bottom).toBeCloseTo(wide[2]!.panel.top, 5);

  await page.setViewportSize({ width: 640, height: 900 });
  const narrow = await Promise.all(
    selectors.slice(0, 3).map((selector) =>
      page.locator(selector).boundingBox(),
    ),
  );
  expect(narrow.every((box) => box !== null)).toBe(true);
  expect(narrow[1]!.y).toBeGreaterThan(narrow[0]!.y + narrow[0]!.height - 2);
  expect(narrow[2]!.y).toBeGreaterThan(narrow[1]!.y + narrow[1]!.height - 2);
});

test("turns clicks in either map into a shareable observer", async ({ page }) => {
  await page.goto("/browse/?eclipse=solar-2026-08-12-total");

  for (const id of ["mercator-map", "world-map"]) {
    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.delete("lat");
      url.searchParams.delete("lon");
      history.replaceState(null, "", url);
    });

    await page.locator(`#${id}`).click();
    await expect(page).toHaveURL((url) => {
      const latitude = Number(url.searchParams.get("lat"));
      const longitude = Number(url.searchParams.get("lon"));
      return (
        url.searchParams.has("lat") &&
        url.searchParams.has("lon") &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180
      );
    });
  }
});

test("shows the same selected instant in all four views", async ({ page }) => {
  await page.goto(
    "/browse/?eclipse=solar-2026-08-12-total&lat=65.21900&lon=-25.25200",
  );
  await expect(page.getByText("Total at this point")).toBeVisible();

  const instant = await page.locator("#mercator-map").getAttribute(
    "data-comparison-utc",
  );
  expect(instant).not.toBeNull();
  for (const id of ["world-map", "spacefarer-view", "ground-map"]) {
    await expect(page.locator(`#${id}`)).toHaveAttribute(
      "data-comparison-utc",
      instant!,
    );
  }
  for (const id of ["mercator-map", "world-map"]) {
    await expect
      .poll(async () =>
        Number(
          (await page
            .locator(`#${id}`)
            .getAttribute("data-shadow-feature-count")) ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  }
  await expect(page.locator("#spacefarer-view")).toHaveAttribute(
    "data-frame-utc",
    instant!,
  );
});

test("keeps the browser map interactive when WebGL is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      contextId: string,
      ...args: unknown[]
    ) {
      if (contextId.startsWith("webgl")) return null;
      return Reflect.apply(original, this, [contextId, ...args]);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/browse/?eclipse=solar-2026-08-12-total");

  await page.locator("#mercator-map").click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.has("lat") && url.searchParams.has("lon"),
  );
});

test("downloads a valid browser-generated GeoJSON artifact", async ({ page }) => {
  await page.goto("/browse/?eclipse=solar-2026-08-12-total");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#geojson-button").click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error("The browser did not provide the downloaded file.");
  const artifact = JSON.parse(await readFile(path, "utf8")) as {
    type?: unknown;
    features?: unknown[];
  };

  expect(artifact.type).toBe("FeatureCollection");
  expect(artifact.features?.length).toBeGreaterThan(0);
});
