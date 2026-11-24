// The real SLEAP app (@talmolab/sleap-app, built from brain-bbqs/sleap-app's embed branch) mounted
// in the page against a routed EMBER archive: it loads from this page's own host, its New Project
// goes to the page's EMBER picker, a dandiset holding only a video starts a project the app opens
// and decodes, and its Save reaches the page's EMBER storage.
import { readFileSync } from "node:fs";
import { test, expect, type Page, type Route } from "@playwright/test";

const API = "https://api-dandi.emberarchive.org/api";
const VIDEO = readFileSync(new URL("../fixtures/testsrc-160x120-20f.mp4", import.meta.url));
const VIDEO_PATH = "sub-01/ses-01/behavior/sub-01_ses-01_top.mp4";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Range" };

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });
}

/** The video's bytes, by range as the app reads them, with no extension on the link. */
function video(route: Route) {
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? "");
  if (!range) return route.fulfill({ status: 200, headers: CORS, body: VIDEO });
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), VIDEO.length - 1) : VIDEO.length - 1;
  return route.fulfill({
    status: 206,
    headers: { ...CORS, "Content-Range": `bytes ${start}-${end}/${VIDEO.length}` },
    body: VIDEO.subarray(start, end + 1),
  });
}

/** Dandiset 000639: no SLEAP project yet, one video. */
async function routeArchive(page: Page): Promise<void> {
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice("/api".length);
    if (path === "/dandisets/000639/") return json(route, { identifier: "000639", draft_version: { name: "Testing" } });
    if (path === "/dandisets/000639/versions/draft/") return json(route, {});
    if (path === "/dandisets/000639/versions/draft/assets/") {
      const glob = url.searchParams.get("glob");
      const results = glob === "*.mp4" ? [{ asset_id: "v1", path: VIDEO_PATH, size: VIDEO.length }] : [];
      return json(route, { results, next: null });
    }
    // The real endpoint redirects to a presigned S3 link, but Playwright does not route the target of
    // a fulfilled redirect, so the download endpoint serves the bytes itself (see ember.spec.ts).
    if (path === "/assets/v1/download/") return video(route);
    return json(route, { detail: "Not found." }, 404);
  });
}

test.describe("the SLEAP app in the page", () => {
  // The start screen's SLEAP logo is baked into the middle of its background image (2752x1536, the
  // logo card on rows 495 to 1041), and our header and footer leave the app a short area for its
  // width. 1536x730 is a 1080p laptop at 125% with the browser's own bars, the tightest common case.
  test("keeps the start screen's logo above its New/Open panel on a short, wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 730 });
    await page.goto("/");
    const newProject = page.getByRole("button", { name: "New Project" });
    await expect(newProject).toBeVisible();
    const layout = await page.locator("#sleap-root").evaluate((root) => {
      const layer = [...root.querySelectorAll("div")].find((d) =>
        getComputedStyle(d).backgroundImage.includes("background.jpg"),
      );
      if (!layer) throw new Error("No element draws the start screen's background image.");
      const box = layer.getBoundingClientRect();
      const size = getComputedStyle(layer).backgroundSize;
      const scale =
        size === "cover" ? Math.max(box.width / 2752, box.height / 1536) : parseFloat(size.split(" ")[1]) / 1536;
      const imageTop = box.top + (box.height - 1536 * scale) / 2;
      return { logoTop: imageTop + 495 * scale, logoBottom: imageTop + 1041 * scale };
    });
    const panel = await newProject.locator("xpath=ancestor::div[contains(@class, 'z-10')][1]").boundingBox();
    const appTop = (await page.locator("#sleap-root").boundingBox())!.y;
    expect(layout.logoBottom).toBeLessThanOrEqual(panel!.y);
    expect(layout.logoTop).toBeGreaterThanOrEqual(appTop);
  });

  test("mounts between the header and footer, loading everything from this page's own host", async ({ page }) => {
    const hosts = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http")) hosts.add(url.host);
    });
    await page.goto("/");
    await expect(page.locator('#sleap-root[data-component="sleap-app"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "New Project" })).toBeVisible();
    await expect(page.locator("link[data-sleap-app]")).toHaveAttribute("href", /\/sleap-app\/sleap-app\.css$/);
    expect([...hosts]).toEqual([new URL(page.url()).host]);
  });

  test("starts a new project on a dandiset's video from its New Project, and its Save reaches EMBER storage", async ({
    page,
  }) => {
    await routeArchive(page);
    await page.goto("/");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page.locator("#open-dialog")).toBeVisible();
    await expect(page.locator("#open-dialog-title")).toHaveText("New project on EMBER");
    // Typed, not filled: the app's own shortcuts must leave the picker's field alone.
    await page.locator("#dandiset-input").click();
    await page.keyboard.type("000639");
    await page.keyboard.press("Enter");

    await expect(page.locator("#project-location")).toHaveText("Dandiset 000639 · new project on 1 video");
    await expect(page.locator("#open-dialog")).toBeHidden();
    // The app read the extensionless link by its declared type, and records the dandiset path.
    const videos = page.locator("#sleap-root").getByRole("row", { name: /sub-01_ses-01_top\.mp4/ });
    await expect(videos).toContainText("20");
    await expect(videos).toContainText("160x120");

    // Into the app first, so its own Ctrl+S takes the key: the top canvas is the one that takes clicks.
    await page.locator("#sleap-root canvas").last().click();
    await page.keyboard.press("Control+s");
    await expect(page.locator("#host-status")).toHaveText("Sign in with EMBER to save.");
  });
});
