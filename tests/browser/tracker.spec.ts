import { expect, test } from "@playwright/test";

const LOCAL_ORIGIN = "http://127.0.0.1:4196";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === LOCAL_ORIGIN
      ? route.continue()
      : route.abort(),
  );
});

for (const eclipse of [
  { slug: "202608", eventId: "solar-2026-08-12-total", atUtc: "2026-08-12T17:45:46.794Z" },
  { slug: "202708", eventId: "solar-2027-08-02-total", atUtc: "2027-08-02T10:06:34.636Z" },
  { slug: "202807", eventId: "solar-2028-07-22-total", atUtc: "2028-07-22T02:55:24.627Z" },
]) {
  test(`renders the ${eclipse.slug} shadow at the selected preview time`, async ({ page }) => {
    await page.goto(`/tracker/${eclipse.slug}/?at=${eclipse.atUtc}`);
    await page.getByRole("tab", { name: "Shadow", exact: true }).click();

    const shadow = page.locator("#tracker-shadow");
    await expect(shadow).toHaveAttribute("data-event-id", eclipse.eventId);
    await expect(shadow).toHaveAttribute("data-frame-utc", eclipse.atUtc);
    await expect(page.locator("#overview-caption")).toContainText("The narrow purple cone reaches Earth.");

    await page.locator('[data-nudge="60"]').click();
    const nudgedUtc = new Date(Date.parse(eclipse.atUtc) + 60_000).toISOString();
    await expect(shadow).toHaveAttribute("data-frame-utc", nudgedUtc);
    await expect(shadow).toHaveAttribute("data-event-id", eclipse.eventId);
    await expect(page).toHaveURL((url) => url.searchParams.get("at") === nudgedUtc);
  });
}

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
