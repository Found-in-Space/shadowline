import { expect, test } from "@playwright/test";

test("loads and updates the physical Spacefarer model", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/spacefarer/");
  const canvas = page.locator("#scene-root canvas");
  await expect(canvas).toHaveCount(1);
  await expect(page.locator("#loading-state")).toBeHidden({ timeout: 20_000 });

  const timeSlider = page.locator("#time-slider");
  await expect
    .poll(async () => Number(await timeSlider.getAttribute("max")))
    .toBeGreaterThan(15_000);
  const extentSeconds = Number(await timeSlider.getAttribute("max"));
  expect(extentSeconds).toBeLessThan(16_000);

  const timeLabel = page.locator("#time-label");
  const initialTime = await timeLabel.textContent();
  await timeSlider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = input.min;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect
    .poll(() => timeLabel.textContent())
    .not.toBe(initialTime);

  const startTime = await timeLabel.textContent();
  const startFrame = await canvas.screenshot();
  await timeSlider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = input.max;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect
    .poll(() => timeLabel.textContent())
    .not.toBe(startTime);
  expect(await canvas.screenshot()).not.toEqual(startFrame);

  await page.getByRole("button", { name: /Shadow corridor/ }).click();
  await expect(
    page.getByRole("button", { name: /Shadow corridor/ }),
  ).toHaveAttribute("aria-pressed", "true");
});
