import { expect, test } from "@playwright/test";

const LOCAL_ORIGIN = "http://127.0.0.1:4196";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === LOCAL_ORIGIN
      ? route.continue()
      : route.abort(),
  );
});

test("updates the WebGL view in response to pointer navigation", async ({
  page,
}) => {
  await page.goto("/spacefarer/");
  const canvas = page.locator("#scene-root canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The WebGL canvas has no visible bounds.");

  const before = await canvas.screenshot();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 120,
    bounds.y + bounds.height / 2 + 60,
    { steps: 4 },
  );
  await page.mouse.up();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  expect(await canvas.screenshot()).not.toEqual(before);
});
