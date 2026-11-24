// The embed's isolation and host-callback checks from docs/DEVELOPMENT_PLAN.md ("Validation"),
// reached through `?test&mock_project` (the SLEAP stand-in, on a mock project) so no archive or
// sign-in is involved. sleap-app.spec.ts runs the real app's own checks.
import { test, expect, type Page } from "@playwright/test";
import { STORAGE_KEY } from "../../src/lib/settings";

const role = (page: Page, name: string) => page.locator(`[data-role="${name}"]`);

async function openMockProject(page: Page): Promise<void> {
  await page.goto("/?test&mock_project");
  await expect(role(page, "file-probe")).toContainText("HDF5 signature");
}

test.describe("the embedded SLEAP app", () => {
  test("mounts inside the app card without changing the page's header", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?test&stand_in");
    const before = await page.locator(".site-header").screenshot();
    await openMockProject(page);
    const after = await page.locator(".site-header").screenshot();
    expect(after.equals(before)).toBe(true);

    const box = (await page.locator("#sleap-root").boundingBox())!;
    const app = (await page.locator("#sleap-root .sleap-app").boundingBox())!;
    expect(app.x).toBeGreaterThanOrEqual(box.x);
    expect(app.y).toBeGreaterThanOrEqual(box.y);
    expect(app.x + app.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    expect(app.y + app.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    await expect(page).toHaveTitle("EMBER SLEAP");
  });

  test("saves on Ctrl+S only while focus is inside the app", async ({ page }) => {
    await openMockProject(page);
    await page.locator("#version-indicator").focus();
    await page.keyboard.press("Control+s");
    await expect(role(page, "save-status")).toHaveText("");

    await role(page, "edit").click();
    await page.keyboard.press("Control+s");
    await expect(page.locator("#host-status")).toHaveText(
      "Saved in memory (test injection): derivatives/sleap/sub-mock/beh/sub-mock_desc-labelsTestInjectionMockProject_pose.slp",
    );
    await expect(role(page, "dirty")).toBeHidden();
  });

  test("asks before signing out with unsaved edits", async ({ page }) => {
    // Signed in from storage; the archive is unreachable, so only the header's state matters.
    await page.route("https://api-dandi.emberarchive.org/**", (route) => route.abort());
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEY, JSON.stringify({ oauth: { accessToken: "tok", expiresAt: Date.now() + 3_600_000 } })],
    );
    await openMockProject(page);
    await expect(page.locator("#oauthSignedIn")).toBeVisible();
    await role(page, "edit").click();

    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.locator("#oauthAvatar").hover();
    await page.locator("#oauthSignoutBtn").click();
    await expect(page.locator("#oauthSignedIn")).toBeVisible();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator("#oauthAvatar").hover();
    await page.locator("#oauthSignoutBtn").click();
    await expect(page.locator("#oauthSigninBtn")).toBeVisible();
  });

  test("loads everything from this page's own host", async ({ page }) => {
    const hosts = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http")) hosts.add(url.host);
    });
    await openMockProject(page);
    await role(page, "edit").click();
    await role(page, "save").click();
    await expect(role(page, "dirty")).toBeHidden();
    expect([...hosts]).toEqual([new URL(page.url()).host]);
  });

  test("saves a new project as an .slp written in the browser, its writer loaded from this page's own host", async ({
    page,
  }) => {
    const hosts = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http")) hosts.add(url.host);
    });
    await page.goto("/?test&mock_new_project");
    await expect(role(page, "file-type")).toHaveText("new project");
    await expect(role(page, "video-list").locator("button")).toHaveCount(2);
    await role(page, "save").click();
    await expect(page.locator("#host-status")).toHaveText(
      "Saved in memory (test injection): derivatives/sleap/sub-mock/beh/sub-mock_desc-labelsTestInjectionMockVideo1_pose.slp",
      { timeout: 20_000 },
    );
    await expect(role(page, "dirty")).toBeHidden();
    expect([...hosts]).toEqual([new URL(page.url()).host]);
  });
});
