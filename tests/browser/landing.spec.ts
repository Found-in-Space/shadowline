import { expect, test } from "@playwright/test";

test("counts down to the first global penumbral contact", async ({ page }) => {
  await page.clock.setFixedTime("2026-08-12T15:34:00.000Z");
  await page.goto("/");

  await expect(page.locator("#eclipse-countdown")).toHaveAttribute(
    "data-state",
    "upcoming",
  );
  await expect(page.locator("#eclipse-countdown-value")).toHaveText(
    "00:00:06",
  );
  await expect(page.locator("#eclipse-countdown-detail")).toContainText(
    "15:34 UTC",
  );
});

test("shows the eclipse as live between global P1 and P4", async ({ page }) => {
  await page.clock.setFixedTime("2026-08-12T17:45:46.794Z");
  await page.goto("/");

  await expect(page.locator("#eclipse-countdown")).toHaveAttribute(
    "data-state",
    "live",
  );
  await expect(page.locator("#eclipse-countdown-value")).toHaveText("Now!");
  await expect(page.locator("#eclipse-countdown-detail")).toContainText(
    "until 19:57 UTC",
  );
});

test("rolls forward to the next eclipse after the shadow leaves Earth", async ({
  page,
}) => {
  await page.clock.setFixedTime("2026-08-12T20:00:00.000Z");
  await page.goto("/");

  await expect(page.locator("#eclipse-countdown")).toHaveAttribute(
    "data-state",
    "upcoming",
  );
  await expect(page.locator("#eclipse-countdown-value")).toHaveText(
    "177d 16:57:34",
  );
  await expect(page.locator("#eclipse-countdown-detail")).toContainText(
    "6 February 2027",
  );
});

test("continues rolling forward beyond the featured 2026 eclipse", async ({
  page,
}) => {
  await page.clock.setFixedTime("2027-02-06T19:02:00.000Z");
  await page.goto("/");

  await expect(page.locator("#eclipse-countdown")).toHaveAttribute(
    "data-state",
    "upcoming",
  );
  await expect(page.locator("#eclipse-countdown-detail")).toContainText(
    "2 August 2027",
  );
});
