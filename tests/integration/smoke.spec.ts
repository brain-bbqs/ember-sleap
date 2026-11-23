import { test, expect } from "@playwright/test";
import { STORAGE_KEY } from "../../src/lib/settings";

test.describe("EMBER SLEAP shell", () => {
  test("renders the header, the SLEAP app filling the window, and the footer's version and brand marks", async ({
    page,
  }) => {
    // Wide enough that the corner watermark stays in its fixed, viewport-anchored spot instead of
    // the narrow-screen fallback in @brain-bbqs/ui's shell.css.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page).toHaveTitle("EMBER SLEAP");
    await expect(page.locator("h1")).toHaveText("EMBER SLEAP");
    await expect(page.locator(".header-logo")).toBeVisible();
    await expect(page.locator(".header-logo")).toHaveAttribute("alt", "SLEAP");
    await expect(page.locator(".brand-watermark-logo")).toBeVisible();
    await expect(page.locator("#oauthSigninBtn")).toBeVisible();
    await expect(page.locator('[data-role="start"]')).toBeVisible();
    await expect(page.locator("#open-dialog")).toBeHidden();

    const footer = page.locator(".page-footer-bar");
    const versionLink = footer.locator(".footer-left #version-indicator");
    await expect(versionLink).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(versionLink).toHaveAttribute("href", "https://github.com/brain-bbqs/ember-sleap");
    const talmo = footer.locator('.footer-brands a[href="https://talmolab.org/"]');
    await expect(talmo).toBeVisible();
    await expect(talmo).toContainText("Talmo Lab");
    await expect(footer.locator('.footer-brands a[href="https://centerforopenneuroscience.org"]')).toBeVisible();
    await expect(footer.locator("button")).toHaveCount(0);

    // The app ends where the footer begins, and the footer at the window's bottom edge, with the
    // version stamp bottom-left and the brand marks bottom-right.
    const app = (await page.locator("#sleap-root").boundingBox())!;
    const bar = (await footer.boundingBox())!;
    expect(Math.round(app.y + app.height)).toBe(Math.round(bar.y));
    expect(Math.round(bar.y + bar.height)).toBe(900);
    expect((await versionLink.boundingBox())!.x).toBeLessThan(100);
    expect((await talmo.boundingBox())!.x).toBeGreaterThan(1200);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(900);
  });

  test("is dark only, whatever the system prefers, with no theme toggle", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("#theme-toggle")).toHaveCount(0);
    // @brain-bbqs/ui's dark --bg.
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(18, 20, 28)");
  });

  test("ignores a light theme stored by an earlier version, and still draws a returning visitor signed in", async ({
    page,
  }) => {
    await page.addInitScript(
      ([key, value]) => {
        localStorage.setItem("ember-sleap.theme", "light");
        localStorage.setItem(key, value);
      },
      [STORAGE_KEY, JSON.stringify({ oauth: { accessToken: "tok", expiresAt: Date.now() + 3_600_000 } })],
    );
    await page.route("https://api-dandi.emberarchive.org/**", (route) => route.abort());
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("#oauthSignedIn")).toBeVisible();
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

  test("drops the fixed watermark once the viewport is too narrow to frame the page", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".brand-watermark-link")).toBeHidden();
  });
});
