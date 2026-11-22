// Open and save against a routed EMBER archive and S3 bucket: every request the page makes to the
// archive is answered here, so the whole save sequence (dandi-etag hash, initialize, multipart PUT,
// complete, validate, create asset) runs in a real browser with no real archive behind it.
import { test, expect, type Page, type Route } from "@playwright/test";
import { STORAGE_KEY } from "../../src/lib/settings";

const API = "https://api-dandi.emberarchive.org/api";
const S3 = "https://s3.mock.test";
const HDF5 = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const PROJECT_BYTES = Buffer.from([...HDF5, ...new Array<number>(56).fill(7)]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  // A wildcard never covers Authorization, so it is named, as the real archive names it.
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Expose-Headers": "ETag",
};

interface Archive {
  assets: { asset_id: string; path: string; size: number }[];
  created: { method: string; path: string; blob_id: string }[];
  uploads: Map<string, Buffer>;
}

const role = (page: Page, name: string) => page.locator(`[data-role="${name}"]`);

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });
}

/** A small archive holding one dandiset, 000123, owned by the signed-in account. */
async function routeArchive(page: Page, assets: Archive["assets"]): Promise<Archive> {
  const archive: Archive = { assets, created: [], uploads: new Map() };
  let nextUpload = 0;

  /** The archive's read endpoints: the account, the dandiset, its listing and its downloads. */
  function read(route: Route, path: string, url: URL): Promise<void> | null {
    if (path === "/users/me/") return json(route, { username: "ada", name: "Ada" });
    if (path === "/dandisets/" && url.searchParams.get("user") === "me") {
      return json(route, { results: [{ identifier: "000123", draft_version: { name: "Lab data" } }] });
    }
    if (path === "/dandisets/000123/") {
      return json(route, { identifier: "000123", embargo_status: "OPEN", draft_version: { name: "Lab data" } });
    }
    if (path === "/dandisets/000123/versions/draft/") return json(route, { description: "Mouse behavior." });
    if (path === "/dandisets/000123/versions/draft/assets/") {
      const glob = url.searchParams.get("glob");
      const exact = url.searchParams.get("path");
      const results = archive.assets.filter((a) =>
        glob ? a.path.endsWith(glob.replace(/^\*/, "")) : exact !== null && a.path.startsWith(exact),
      );
      return json(route, { results, next: null });
    }
    // The real endpoint redirects to a presigned S3 link, but Playwright does not route the target of
    // a fulfilled redirect, so here it serves the bytes itself. Following the redirect to its final
    // URL is covered by tests/unit/main.ember.test.ts.
    if (/^\/assets\/[^/]+\/download\/$/.test(path)) {
      const range = route.request().headers()["range"];
      const body = range ? PROJECT_BYTES.subarray(0, 12) : PROJECT_BYTES;
      return route.fulfill({ status: range ? 206 : 200, headers: CORS, body });
    }
    return null;
  }

  /** The upload sequence's endpoints, and the asset create and replace they end with. */
  function write(route: Route, path: string): Promise<void> | null {
    const request = route.request();
    if (path === "/uploads/initialize/") {
      const { contentSize } = request.postDataJSON() as { contentSize: number };
      const id = `u${++nextUpload}`;
      return json(route, {
        upload_id: id,
        parts: [{ part_number: 1, size: contentSize, upload_url: `${S3}/upload/${id}` }],
      });
    }
    const complete = /^\/uploads\/([^/]+)\/complete\/$/.exec(path);
    if (complete) return json(route, { complete_url: `${S3}/complete/${complete[1]}`, body: "<Complete/>" });
    const validate = /^\/uploads\/([^/]+)\/validate\/$/.exec(path);
    if (validate) return json(route, { blob_id: `blob-${validate[1]}` });
    if (path.startsWith("/dandisets/000123/versions/draft/assets/")) {
      const { blob_id, metadata } = request.postDataJSON() as { blob_id: string; metadata: { path: string } };
      archive.created.push({ method: request.method(), path: metadata.path, blob_id });
      return json(route, { asset_id: `new-${archive.created.length}`, path: metadata.path });
    }
    return null;
  }

  await page.route(`${API}/**`, async (route) => {
    const method = route.request().method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api", "");
    const answered = method === "GET" ? read(route, path, url) : write(route, path);
    return answered ?? route.fulfill({ status: 404, headers: CORS, body: `unrouted ${method} ${path}` });
  });

  await page.route(`${S3}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname.startsWith("/upload/")) {
      archive.uploads.set(url.pathname.slice("/upload/".length), request.postDataBuffer() ?? Buffer.alloc(0));
      return route.fulfill({ status: 200, headers: { ...CORS, ETag: '"part-etag"' } });
    }
    if (url.pathname.startsWith("/complete/")) {
      return route.fulfill({ status: 200, headers: CORS, body: "<CompleteMultipartUploadResult/>" });
    }
    return route.fulfill({ status: 404, headers: CORS });
  });

  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify({ oauth: { accessToken: "tok", expiresAt: Date.now() + 3_600_000 } })],
  );
  return archive;
}

async function openProject(page: Page, path: string): Promise<void> {
  await page.goto("/?dandiset=000123");
  await page.locator(`.project-open[data-path="${path}"]`).click();
  await expect(role(page, "file-probe")).toContainText("HDF5 signature");
}

test.describe("EMBER storage", () => {
  test("lists a dandiset's projects and opens one through an extensionless link with its declared type", async ({
    page,
  }) => {
    await routeArchive(page, [
      { asset_id: "a1", path: "sub-01/ses-02/labels.slp", size: 64 },
      { asset_id: "a2", path: "sub-01/ses-02/train.pkg.slp", size: 64 },
    ]);
    await page.goto("/?dandiset=000123");
    await expect(page.locator("#open-status")).toHaveText("Lab data (000123): 2 projects.");
    await expect(page.locator("#oauthUsername")).toHaveText("ada");
    await page.locator('.project-open[data-path="sub-01/ses-02/train.pkg.slp"]').click();
    await expect(role(page, "file-type")).toHaveText("pkg.slp");
    await expect(role(page, "file-probe")).toHaveText("Read the first 12 bytes with a ranged request: HDF5 signature.");
  });

  test("saves into derivatives/sleap/ as a BIDS derivative, writing the dataset files once", async ({ page }) => {
    const archive = await routeArchive(page, [{ asset_id: "a1", path: "sub-01/ses-02/labels.slp", size: 64 }]);
    await openProject(page, "sub-01/ses-02/labels.slp");
    await role(page, "edit").click();
    await role(page, "save").click();

    const target = "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_desc-labels_pose.slp";
    await expect(page.locator("#host-status")).toHaveText(`Saved to the draft of dandiset 000123: ${target}`);
    expect(archive.created.map((c) => [c.method, c.path])).toEqual([
      ["POST", target],
      ["POST", "derivatives/sleap/dataset_description.json"],
      ["POST", "derivatives/sleap/.bidsignore"],
    ]);
    const uploaded = [...archive.uploads.values()];
    expect(uploaded[0].equals(PROJECT_BYTES)).toBe(true);
    const description = JSON.parse(uploaded[1].toString()) as Record<string, unknown>;
    expect(description.DatasetType).toBe("derivative");
    expect(description.SourceDatasets).toEqual([{ URL: "https://dandi.emberarchive.org/dandiset/000123/draft" }]);
    expect(uploaded[2].toString()).toBe("*.slp\n*.ckpt\nmodels/\n");

    // The next save goes back over the derivative it just wrote, which now exists.
    archive.assets.push({ asset_id: "d1", path: target, size: 64 });
    archive.assets.push({ asset_id: "d2", path: "derivatives/sleap/dataset_description.json", size: 1 });
    archive.assets.push({ asset_id: "d3", path: "derivatives/sleap/.bidsignore", size: 1 });
    await page.keyboard.press("Control+s");
    await expect.poll(() => archive.created.length).toBe(4);
    expect(archive.created[3]).toMatchObject({ method: "PUT", path: target });
  });

  test("gives each project of a session its own labels file", async ({ page }) => {
    const archive = await routeArchive(page, [
      { asset_id: "a1", path: "sub-01/ses-02/beh/cam-side.slp", size: 64 },
      { asset_id: "a2", path: "sub-01/ses-02/beh/cam-top.slp", size: 64 },
    ]);
    const folder = "derivatives/sleap/sub-01/ses-02/beh";
    const targets = [
      `${folder}/sub-01_ses-02_desc-labelsCamTop_pose.slp`,
      `${folder}/sub-01_ses-02_desc-labelsCamSide_pose.slp`,
    ];
    for (const [source, target] of [
      ["sub-01/ses-02/beh/cam-top.slp", targets[0]],
      ["sub-01/ses-02/beh/cam-side.slp", targets[1]],
    ]) {
      await openProject(page, source);
      await role(page, "save").click();
      await expect(page.locator("#host-status")).toContainText(target);
    }
    expect(archive.created.filter((c) => c.path.startsWith(folder)).map((c) => [c.method, c.path])).toEqual(
      targets.map((target) => ["POST", target]),
    );
  });

  test("saves a proofread predictions file beside it as labels, leaving the predictions alone", async ({ page }) => {
    const predictions = "derivatives/sleap/sub-01/beh/sub-01_desc-predictions_pose.slp";
    const archive = await routeArchive(page, [{ asset_id: "p1", path: predictions, size: 64 }]);
    await openProject(page, predictions);
    await role(page, "save").click();
    const target = "derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.slp";
    await expect(page.locator("#host-status")).toContainText(target);
    expect(archive.created[0]).toMatchObject({ method: "POST", path: target });
    expect(archive.created.map((c) => c.path)).not.toContain(predictions);
  });

  for (const [choice, button, landed] of [
    ["cancel", "#overwrite-cancel", null],
    ["keep both", "#overwrite-keep", ["POST", "sub-01_ses-02_desc-labels2_pose.slp"]],
    ["replace", "#overwrite-replace", ["PUT", "sub-01_ses-02_desc-labels_pose.slp"]],
  ] as const) {
    test(`asks before going over labels already saved there, and can ${choice}`, async ({ page }) => {
      const folder = "derivatives/sleap/sub-01/ses-02/beh";
      const target = `${folder}/sub-01_ses-02_desc-labels_pose.slp`;
      const archive = await routeArchive(page, [
        { asset_id: "a1", path: "sub-01/ses-02/labels.slp", size: 64 },
        { asset_id: "d1", path: target, size: 64 },
        { asset_id: "d2", path: "derivatives/sleap/dataset_description.json", size: 1 },
        { asset_id: "d3", path: "derivatives/sleap/.bidsignore", size: 1 },
      ]);
      await openProject(page, "sub-01/ses-02/labels.slp");
      await role(page, "save").click();
      await expect(page.locator("#overwrite-dialog")).toBeVisible();
      await expect(page.locator("#overwrite-path")).toHaveText(target);
      await page.locator(button).click();
      await expect(page.locator("#overwrite-dialog")).toBeHidden();

      if (landed) {
        await expect(page.locator("#host-status")).toHaveText(
          `Saved to the draft of dandiset 000123: ${folder}/${landed[1]}`,
        );
        expect(archive.created.map((c) => [c.method, c.path])).toEqual([[landed[0], `${folder}/${landed[1]}`]]);
      } else {
        await expect(page.locator("#host-status")).toHaveText(`Save cancelled: ${target} already holds labels.`);
        await expect(role(page, "save-status")).toHaveText(
          `Save failed: Save cancelled: ${target} already holds labels.`,
        );
        expect(archive.created).toEqual([]);
        expect(archive.uploads.size).toBe(0);
      }
    });
  }

  test("asks for a subject when the project's path names none", async ({ page }) => {
    const archive = await routeArchive(page, [{ asset_id: "a1", path: "raw/labels.slp", size: 64 }]);
    await openProject(page, "raw/labels.slp");
    await role(page, "save").click();
    await expect(page.locator("#entities-dialog")).toBeVisible();
    await expect(page.locator("#entities-source")).toHaveText("raw/labels.slp");
    await expect(page.locator("#entities-reason")).toHaveText("names no subject.");
    await page.locator("#entities-sub").fill("mouse7");
    await page.locator("#entities-save").click();
    await expect(page.locator("#host-status")).toContainText(
      "derivatives/sleap/sub-mouse7/beh/sub-mouse7_desc-labels_pose.slp",
    );
    expect(archive.created[0].path).toBe("derivatives/sleap/sub-mouse7/beh/sub-mouse7_desc-labels_pose.slp");
  });

  test("asks for a session the path names in a form BIDS cannot hold, offering it as a label", async ({ page }) => {
    const archive = await routeArchive(page, [{ asset_id: "a1", path: "sub-01/ses-day-1/labels.slp", size: 64 }]);
    await openProject(page, "sub-01/ses-day-1/labels.slp");
    await role(page, "save").click();
    await expect(page.locator("#entities-dialog-title")).toHaveText("Which subject and session is this?");
    await expect(page.locator("#entities-sub")).toHaveValue("01");
    await expect(page.locator("#entities-ses")).toHaveValue("day1");
    await page.locator("#entities-save").click();
    const target = "derivatives/sleap/sub-01/ses-day1/beh/sub-01_ses-day1_desc-labels_pose.slp";
    await expect(page.locator("#host-status")).toContainText(target);
    expect(archive.created[0].path).toBe(target);
  });

  test("finds a project's video in the dandiset by the path the project stored", async ({ page }) => {
    await routeArchive(page, [
      { asset_id: "a1", path: "sub-01/labels.slp", size: 64 },
      { asset_id: "v1", path: "sub-02/session1.mp4", size: 64 },
      { asset_id: "v2", path: "sub-01/session1.mp4", size: 64 },
    ]);
    await openProject(page, "sub-01/labels.slp");
    await role(page, "video-path").fill("C:\\lab\\videos\\session1.mp4");
    await role(page, "video-find").click();
    await expect(role(page, "video-result")).toHaveText("Found session1.mp4 (mp4).");
  });
});
