import { test, expect } from "@playwright/test";
import { seedTheme } from "@brain-bbqs/test-utils/playwright";
import { THEME_KEY } from "../../src/lib/settings";

test.describe("EMBER SLEAP shell", () => {
  test("renders the header's branding and version, and the SLEAP app filling the window below it", async ({ page }) => {
    // Wide enough that the corner watermark stays in its fixed, viewport-anchored spot instead of
    // the narrow-screen fallback in @brain-bbqs/ui's shell.css.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page).toHaveTitle("EMBER SLEAP");
    await expect(page.locator("h1")).toHaveText("EMBER SLEAP");
    await expect(page.locator(".header-logo")).toBeVisible();
    await expect(page.locator(".header-logo")).toHaveAttribute("alt", "SLEAP");
    await expect(page.locator(".brand-watermark-logo")).toBeVisible();
    const talmo = page.locator('a.talmo-brand[href="https://talmolab.org/"]');
    await expect(talmo).toBeVisible();
    await expect(talmo).toContainText("Talmo Lab");
    // The white-stroked flask on the dark theme, the dark-stroked one on the light.
    await expect(talmo.locator(".talmo-logo.on-dark")).toBeVisible();
    await expect(talmo.locator(".talmo-logo.on-light")).toBeHidden();
    const versionLink = page.locator("#version-indicator");
    await expect(versionLink).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(versionLink).toHaveAttribute("href", "https://github.com/brain-bbqs/ember-sleap");
    await expect(page.locator("#oauthSigninBtn")).toBeVisible();

    await expect(page.locator('[data-role="start"]')).toBeVisible();
    await expect(page.locator("#open-dialog")).toBeHidden();
    await expect(page.locator(".page-footer-bar")).toHaveCount(0);
    const app = (await page.locator("#sleap-root").boundingBox())!;
    expect(Math.round(app.y + app.height)).toBe(900);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(900);
  });

  test("boots for real when ?test names nothing to fake", async ({ page }) => {
    await page.goto("/?test");
    await expect(page.locator('[data-role="start"]')).toBeVisible();
    await expect(page.locator('[data-role="project"]')).toBeHidden();
  });

  test("opens the EMBER picker from the start screen and the File menu, and closes it on Escape", async ({ page }) => {
    await page.goto("/");
    const dialog = page.locator("#open-dialog");
    await page.locator('[data-role="start-open"]').click();
    await expect(dialog).toBeVisible();
    await expect(page.locator("#open-dialog-title")).toHaveText("Open a project from EMBER");
    await expect(page.locator("#dandiset-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.locator('[data-role="menu-file"]').click();
    await page.locator('[data-role="menu-new"]').click();
    await expect(dialog).toBeVisible();
    await expect(page.locator("#open-dialog-title")).toHaveText("New project on EMBER");
    await page.locator("#open-dialog-close").click();
    await expect(dialog).toBeHidden();
  });

  test("flips the theme from the header toggle and keeps it across a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    expect(await page.locator("html").getAttribute("data-theme")).toBe(null);
    await page.locator("#theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("applies a stored theme before first paint", async ({ page }) => {
    await seedTheme(page, "dark", { storageKey: THEME_KEY });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("drops the fixed watermark once the viewport is too narrow to frame the page", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".brand-watermark-link")).toBeHidden();
  });
});
