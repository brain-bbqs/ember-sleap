import { test, expect } from "@chromatic-com/playwright";
import type { Page } from "@playwright/test";
import { expectNoHorizontalOverflow, forEachViewport } from "@brain-bbqs/test-utils/playwright";

// forEachViewport registers each state once per viewport, sized and named in the title, since
// Chromatic keys a capture by the test's title alone.

/**
 * The shared overflow check, except that below tablet width the real SLEAP app's own menu bar runs
 * past the right edge (as it does in the standalone app; its layout is upstream's), so there only
 * the page itself is held to not scrolling sideways.
 */
async function expectPageFits(page: Page): Promise<void> {
  const { width } = page.viewportSize()!;
  if (width >= 768) return expectNoHorizontalOverflow(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
}

forEachViewport(test, "Main page - default", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New Project" })).toBeVisible();
  await expect(page.locator("#open-dialog")).toBeHidden();
  await expectPageFits(page);
});

forEachViewport(test, "Main page - project picker", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Project", exact: true }).click();
  await expect(page.locator("#open-dialog")).toBeVisible();
  await expectPageFits(page);
});

forEachViewport(test, "Main page - new project", async ({ page }) => {
  // The new project's videos are empty data: URLs no player can show, so the canvas is the same
  // on every run (see src/lib/testInjection.ts).
  await page.goto("/?test&mock_new_project");
  await expect(page.locator('[data-role="file-type"]')).toHaveText("new project");
  await expect(page.locator('[data-role="video-list"] button')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
});

forEachViewport(test, "Main page - project open", async ({ page }) => {
  // The mock project has a fixed name, size and signature (see src/lib/testInjection.ts), so the
  // capture is the same on every run.
  await page.goto("/?test&mock_project");
  await expect(page.locator('[data-role="file-probe"]')).toContainText("HDF5 signature");
  await expect(page.locator("#open-dialog")).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

// The listed path is where inference on the mock project writes, so it is fixed too.
const MOCK_PREDICTIONS = "derivatives/sleap/sub-mock/beh/sub-mock_desc-predictionsTestInjectionMockProject_pose.slp";

forEachViewport(test, "Main page - predictions listed", async ({ page }) => {
  await page.goto("/?test&mock_project&mock_predictions");
  await expect(page.locator('[data-role="file-probe"]')).toContainText("HDF5 signature");
  await expect(page.locator("#predictions-list button")).toHaveText([MOCK_PREDICTIONS]);
  await expectNoHorizontalOverflow(page);
});

forEachViewport(test, "Main page - predictions not on EMBER yet", async ({ page }) => {
  await page.goto("/?test&mock_project&mock_predictions&mock_predictions_missing");
  await expect(page.locator('[data-role="file-probe"]')).toContainText("HDF5 signature");
  await page.locator("#predictions-list button").click();
  await expect(page.locator("#predictions-status")).toHaveText(
    `${MOCK_PREDICTIONS} is not on EMBER yet: the job may still be writing it. Try again in a moment.`,
  );
  await expect(page.locator("#predictions-retry")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
