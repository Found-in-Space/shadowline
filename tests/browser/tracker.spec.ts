import { expect, test } from "@playwright/test";

const LOCAL_ORIGIN = "http://127.0.0.1:4196";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === LOCAL_ORIGIN
      ? route.continue()
      : route.abort(),
  );
});

test("serves the tracker from its service worker while the browser is offline", async ({
  page,
  context,
}) => {
  await page.goto("/tracker/202608/?lat=65.1411&lon=-25.3272&elevation=0");
  const trackerUrl = page.url();

  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      throw new Error("This browser does not support service workers.");
    }
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  const response = await page.reload({ waitUntil: "load" });
  expect(response?.ok()).toBe(true);
  expect(page.url()).toBe(trackerUrl);

  const cachedManifest = await page.evaluate(async () => {
    const result = await fetch("./manifest.webmanifest");
    return { ok: result.ok, status: result.status };
  });
  expect(cachedManifest).toEqual({ ok: true, status: 200 });
});
