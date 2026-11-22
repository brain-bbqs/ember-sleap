// The embed's isolation and host-callback checks from docs/DEVELOPMENT_PLAN.md ("Validation"),
// reached through `?test&mock_project` so no archive, sign-in or compute is involved. They run
// against the stand-in today and are meant to keep passing once the real component mounts.
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
    await page.goto("/?test");
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
    await page.locator("#theme-toggle").focus();
    await page.keyboard.press("Control+s");
    await expect(role(page, "save-status")).toHaveText("");

    await role(page, "edit").click();
    await page.keyboard.press("Control+s");
    await expect(page.locator("#host-status")).toHaveText(
      "Saved in memory (test injection): derivatives/sleap/sub-mock/beh/sub-mock_desc-labelsTestInjectionMockProject_pose.slp",
    );
    await expect(role(page, "dirty")).toBeHidden();
  });

  test("offers only the page's compute: no Local, no SLEAP Connect", async ({ page }) => {
    await openMockProject(page);
    await expect(role(page, "backend").locator("option")).toHaveText(["EMBER compute (host)"]);
  });

  test("submits training and inference through the host and shows their events", async ({ page }) => {
    await openMockProject(page);
    await role(page, "train").click();
    await expect(role(page, "job-state")).toHaveText("completed");
    await expect(role(page, "job-log")).toContainText("epoch 2: train loss 0.3333, val loss 0.4");
    // model_dir is a model card id a later track job can name; the folder is model_path.
    await expect(role(page, "job-log")).toContainText('"model_dir":"ember:mock/stub-model-1"');
    await expect(role(page, "job-log")).toContainText('"model_path":"derivatives/sleap/models/stub-model-1/"');

    await role(page, "list-models").click();
    await role(page, "predict").first().click();
    await expect(role(page, "job-id")).toHaveText("Job stub-2");
    await expect(role(page, "job-state")).toHaveText("completed");
    await expect(role(page, "job-log")).toContainText("Model: mock:single-instance");

    // The model just trained is listed as EMBER would list its folder, so it can predict too.
    await expect(role(page, "models")).toContainText("stub-model-1 (trained here on the stub)");
    await role(page, "predict").last().click();
    await expect(role(page, "job-id")).toHaveText("Job stub-3");
    await expect(role(page, "job-state")).toHaveText("completed");
    await expect(role(page, "job-log")).toContainText("Model: ember:mock/stub-model-1");
  });

  test("opens the predictions an inference job wrote, and saves them proofread as labels beside them", async ({
    page,
  }) => {
    const folder = "derivatives/sleap/sub-mock/beh";
    const predictions = `${folder}/sub-mock_desc-predictionsTestInjectionMockProject_pose.slp`;
    await openMockProject(page);
    await expect(page.locator("#predictions")).toBeHidden();
    await role(page, "list-models").click();
    await role(page, "predict").first().click();
    await expect(role(page, "job-state")).toHaveText("completed");
    await expect(page.locator("#predictions-list button")).toHaveText([predictions]);

    await page.locator(`.predictions-open[data-path="${predictions}"]`).click();
    await expect(role(page, "file-name")).toHaveText("sub-mock_desc-predictionsTestInjectionMockProject_pose.slp");
    await expect(page.locator("#project-location")).toHaveText(`Test injection · ${predictions}`);
    await expect(role(page, "file-probe")).toContainText("HDF5 signature");

    await role(page, "edit").click();
    await page.keyboard.press("Control+s");
    await expect(page.locator("#host-status")).toHaveText(
      `Saved in memory (test injection): ${folder}/sub-mock_desc-labelsTestInjectionMockProject_pose.slp`,
    );
    await expect(role(page, "dirty")).toBeHidden();
    // The predictions stay listed, to open again.
    await expect(page.locator("#predictions-list button")).toHaveText([predictions]);
  });

  test("trains on unsaved edits offline, keeping them in memory as a training package first", async ({ page }) => {
    const hosts = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http")) hosts.add(url.host);
    });
    const now = new Date("2026-11-22T15:30:00Z");
    await page.clock.setFixedTime(now);
    await openMockProject(page);
    await role(page, "edit").click();
    await role(page, "train").click();

    const name = "sub-mock_desc-trainingsetTestInjectionMockProject20261122153000_pose.pkg.slp";
    await expect(page.locator("#host-status")).toHaveText(
      `Saved in memory (test injection): derivatives/sleap/sub-mock/beh/${name}`,
    );
    await expect(role(page, "job-state")).toHaveText("completed");
    await expect(role(page, "job-log")).toContainText(`Input: ${name} (pkg.slp)`);
    await expect(role(page, "dirty")).toBeVisible();
    expect([...hosts]).toEqual([new URL(page.url()).host]);
  });

  test("cancels a running job", async ({ page }) => {
    await openMockProject(page);
    await role(page, "train").click();
    await expect(role(page, "job-state")).toHaveText("running");
    await role(page, "job-cancel").click();
    await expect(role(page, "job-state")).toHaveText("canceled");
    await expect(role(page, "job-cancel")).toBeHidden();
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
    await role(page, "train").click();
    await expect(role(page, "job-state")).toHaveText("completed");
    expect([...hosts]).toEqual([new URL(page.url()).host]);
  });
});
