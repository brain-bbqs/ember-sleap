import { test, expect } from "@playwright/test";
import { seedTheme } from "@brain-bbqs/test-utils/playwright";
import { THEME_KEY } from "../../src/lib/settings";

test.describe("EMBER SLEAP shell", () => {
  test("renders branding, version, and the EMBER picker", async ({ page }) => {
    // Wide enough that the corner watermark and footer bar stay in their fixed, viewport-anchored
    // spots instead of the narrow-screen fallback in @brain-bbqs/ui's shell.css.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page).toHaveTitle("EMBER SLEAP");
    await expect(page.locator("h1")).toHaveText("EMBER SLEAP");
    await expect(page.locator(".site-subtitle")).toContainText("SLEAP on data in the EMBER archive");
    await expect(page.locator(".header-logo")).toBeVisible();
    await expect(page.locator(".brand-watermark-logo")).toBeVisible();
    const versionLink = page.locator("#version-indicator");
    await expect(versionLink).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(versionLink).toHaveAttribute("href", "https://github.com/brain-bbqs/ember-sleap");
    await expect(page.locator('a.footer-brand-link[href="https://centerforopenneuroscience.org"]')).toBeVisible();
    await expect(page.locator("#oauthSigninBtn")).toBeVisible();
    await expect(page.locator("#dandiset-input")).toBeVisible();
    await expect(page.locator("#app-card")).toBeHidden();
  });

  test("boots for real when ?test names nothing to fake", async ({ page }) => {
    await page.goto("/?test");
    await expect(page.locator("#open-card")).toBeVisible();
    await expect(page.locator("#app-card")).toBeHidden();
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

  test("opens What's New from the footer and from the #changelog fragment", async ({ page }) => {
    await page.goto("/");
    const modal = page.locator("#whats-new-modal");
    await page.locator("#whats-new-button").click();
    await expect(modal).toBeVisible();
    await expect(modal.locator(".changelog-version").first()).toBeVisible();
    await expect(page).toHaveURL(/#changelog$/);
    await page.locator("#whats-new-close").click();
    await expect(modal).toBeHidden();
    await expect(page).not.toHaveURL(/#changelog/);
    await page.goto("/#changelog");
    await expect(modal).toBeVisible();
  });

  test("drops the fixed watermark once the viewport is too narrow to frame the page", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".brand-watermark-link")).toBeHidden();
    await expect(page.locator(".page-footer-bar")).toHaveCSS("position", "static");
  });
});
