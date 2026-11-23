import { test, expect } from "@chromatic-com/playwright";
import { expectNoHorizontalOverflow, forEachViewport } from "@brain-bbqs/test-utils/playwright";

// forEachViewport registers each state once per viewport, sized and named in the title, since
// Chromatic keys a capture by the test's title alone.

forEachViewport(test, "Main page - default", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("EMBER SLEAP");
  await expectNoHorizontalOverflow(page);
});
