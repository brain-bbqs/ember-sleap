// @vitest-environment jsdom
// A visitor on `?dandiset=000123` with the compute proxy configured predicts on a project, and the
// proxy's result names the predictions files its worker wrote (and some it may not open). The page
// lists them under the app and opens them from a routed archive, which holds a file only once the
// test has "written" it: a file not written yet, opens racing each other, unsaved edits (made before
// a click or while a file loads) and closing the project mid-open or mid-job.
import { jsonResponse, routeFetch, type FetchRouter } from "@brain-bbqs/test-utils/vitest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { notOnEmberYet } from "../../src/lib/emberStorage";
import { bootMain, el, redirectedResponse, role } from "./helpers/mainHarness";

vi.mock("../../src/lib/computeClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/computeClient")>()),
  COMPUTE_PROXY_URL: "https://proxy.example/v1",
}));

const API = "https://api-dandi.emberarchive.org/api";
const STORE = "https://s3.example/";
const PROXY = "https://proxy.example/v1";
const HDF5 = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const FOLDER = "derivatives/sleap/sub-01/ses-02/beh";
const TOP = `${FOLDER}/sub-01_ses-02_desc-predictionsCamTop_pose.slp`;
const SIDE = `${FOLDER}/sub-01_ses-02_desc-predictionsCamSide_pose.pkg.slp`;
const ESCAPE = "derivatives/sleap/../../sub-01/ses-02/beh/cam-top.slp";
const DISCARD = "The open project has unsaved changes. Open the predictions without saving them?";

/** The draft's assets: the project and a model folder to begin with, then whatever a test writes. */
const assets = [
  { asset_id: "a1", path: "sub-01/ses-02/beh/cam-top.slp", size: 12 },
  { asset_id: "c1", path: "derivatives/sleap/models/mouse/training_config.yaml", size: 1 },
];
const write = (asset_id: string, path: string) => assets.push({ asset_id, path, size: 12 });
// Requests the test holds back by name (`download:<asset>`, `read:<asset>`, `submit`, `events`),
// each until it releases them; a held download can be set to fail once released.
const holds = new Map<string, { until: Promise<void>; fail: boolean }>();
function hold(name: string, fail = false): () => void {
  let release!: () => void;
  holds.set(name, { until: new Promise<void>((resolve) => (release = resolve)), fail });
  return release;
}
/** Waits out the test's hold on `name`, if any, and says whether the request is to fail. */
async function heldBack(name: string): Promise<boolean> {
  const held = holds.get(name);
  holds.delete(name);
  await held?.until;
  return held?.fail ?? false;
}

let fetchMock: FetchRouter;
let jobs = 0;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const listed = () => [...el("predictions-list").querySelectorAll<HTMLButtonElement>("button")];
const predictionsButton = (path: string) => listed().find((b) => b.dataset.path === path)!;
const submits = () => fetchMock.calls.filter((c) => c.url === `${PROXY}/jobs`);

async function openListedProject(): Promise<void> {
  el("project-list").querySelector("button")!.click();
  await vi.waitFor(() => expect(role("file-probe").textContent).toMatch(/HDF5 signature/));
}

beforeAll(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock = routeFetch([
    {
      match: (url) => url.startsWith(`${API}/dandisets/000123/versions/draft/assets/?`),
      respond: (url) => {
        const params = new URL(url).searchParams;
        const glob = params.get("glob");
        const prefix = params.get("path");
        const results = assets.filter((a) =>
          glob ? a.path.endsWith(glob.replace(/^\*/, "")) : a.path.startsWith(prefix!),
        );
        return jsonResponse({ results, next: null });
      },
    },
    { match: `${API}/dandisets/000123/versions/draft/`, respond: jsonResponse({ description: "Mice." }) },
    { match: `${API}/dandisets/000123/`, respond: jsonResponse({ identifier: "000123" }) },
    {
      match: /\/assets\/\w+\/download\/$/,
      respond: async (url) => {
        const assetId = /\/assets\/(\w+)\//.exec(url)![1];
        const fail = await heldBack(`download:${assetId}`);
        return fail ? jsonResponse({}, 404) : redirectedResponse(`${STORE}${assetId}`);
      },
    },
    {
      match: STORE,
      respond: async (url) => {
        await heldBack(`read:${url.slice(STORE.length)}`);
        return new Response(HDF5, { status: 206 });
      },
    },
    {
      match: /\/jobs\/t\d+\/events/,
      respond: async () => {
        await heldBack("events");
        return jsonResponse({
          events: [
            { topic: "job.status", seq: 1, data: { state: "running" } },
            { topic: "job.result", seq: 2, data: { predictions: [TOP, SIDE, ESCAPE, TOP] } },
            { topic: "job.status", seq: 3, data: { state: "completed" } },
          ],
        });
      },
    },
    {
      match: `${PROXY}/jobs`,
      respond: async () => {
        await heldBack("submit");
        return jsonResponse({ job_id: `t${++jobs}` });
      },
    },
  ]);
  await bootMain({ url: "?dandiset=000123", fetch: fetchMock });
  await vi.waitFor(() => expect(el("project-list").hidden).toBe(false));
  await openListedProject();
});

afterAll(() => vi.restoreAllMocks());

describe("the predictions an inference job wrote", () => {
  it("are listed under the app once the job completes, leaving out what the page may not open", async () => {
    expect(el("predictions").hidden).toBe(true);
    role("list-models").click();
    await vi.waitFor(() => expect(document.querySelector('[data-role="predict"]')).not.toBeNull());
    role("predict").click();
    await vi.waitFor(() => expect(role("job-state").textContent).toBe("completed"));
    expect(el("predictions").hidden).toBe(false);
    expect(listed().map((b) => b.textContent)).toEqual([TOP, SIDE]);
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      `Ignored predictions job t1 reported: "${ESCAPE}" has an empty, '.' or '..' segment.`,
    );
    const sent = JSON.parse(String(submits()[0].init?.body)) as { spec: { type: string } };
    expect(sent.spec.type).toBe("track");
  });

  it("says a file the job has not written yet is not on EMBER yet, and opens it once it is, on a second try", async () => {
    predictionsButton(TOP).click();
    expect(el("predictions-status").textContent).toBe(`Opening ${TOP}…`);
    await vi.waitFor(() => expect(el("predictions-status").textContent).toBe(notOnEmberYet(TOP)));
    expect(el("predictions-status").classList.contains("err")).toBe(true);
    expect(el("predictions-retry").hidden).toBe(false);
    expect(el("project-title").textContent).toBe("cam-top.slp");

    write("p1", TOP);
    el("predictions-retry").click();
    await vi.waitFor(() =>
      expect(el("project-title").textContent).toBe("sub-01_ses-02_desc-predictionsCamTop_pose.slp"),
    );
    expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${TOP}`);
    await vi.waitFor(() => expect(role("file-probe").textContent).toMatch(/HDF5 signature/));
    expect(role("file-type").textContent).toBe("slp");
    expect(el("predictions-status").textContent).toBe("");
    expect(el("predictions-retry").hidden).toBe(true);
    expect(listed().length).toBe(2);
  });

  it("opens the latest one clicked when two are on their way", async () => {
    write("p2", SIDE);
    const releaseTop = hold("download:p1");
    predictionsButton(TOP).click();
    predictionsButton(SIDE).click();
    await vi.waitFor(() => expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${SIDE}`));
    expect(role("file-type").textContent).toBe("pkg.slp");

    releaseTop();
    await settle();
    await settle();
    expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${SIDE}`);
    expect(el("predictions-status").textContent).toBe("");
  });

  it("leaves a later open's progress alone when an earlier one finishes reading in the app", async () => {
    const releaseRead = hold("read:p1");
    predictionsButton(TOP).click();
    await vi.waitFor(() => expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${TOP}`));
    const releaseSide = hold("download:p2");
    predictionsButton(SIDE).click();
    releaseRead();
    await settle();
    await settle();
    expect(el("predictions-status").textContent).toBe(`Opening ${SIDE}…`);

    releaseSide();
    await vi.waitFor(() => expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${SIDE}`));
    expect(el("predictions-status").textContent).toBe("");
  });

  it("says nothing of an earlier open that fails after a later one opened", async () => {
    const failTop = hold("download:p1", true);
    predictionsButton(TOP).click();
    predictionsButton(SIDE).click();
    await vi.waitFor(() => expect(el("predictions-status").textContent).toBe(""));
    failTop();
    await settle();
    await settle();
    expect(el("predictions-status").textContent).toBe("");
    expect(el("predictions-status").classList.contains("err")).toBe(false);
    expect(el("predictions-retry").hidden).toBe(true);
    expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${SIDE}`);
  });

  it("asks before opening one over edits not yet saved, and leaves the project alone when told no", async () => {
    role("edit").click();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const downloads = fetchMock.callsTo("/download/").length;
    predictionsButton(TOP).click();
    expect(confirm).toHaveBeenCalledWith(DISCARD);
    await settle();
    expect(fetchMock.callsTo("/download/").length).toBe(downloads);
    expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${SIDE}`);
    expect(role("dirty").hidden).toBe(false);

    confirm.mockReturnValue(true);
    predictionsButton(TOP).click();
    await vi.waitFor(() => expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${TOP}`));
    expect(role("dirty").hidden).toBe(true);
    confirm.mockRestore();
  });

  it("asks before replacing edits made while one was loading, and keeps them when told no", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const releaseSide = hold("download:p2");
    predictionsButton(SIDE).click();
    expect(confirm).not.toHaveBeenCalled();
    role("edit").click();
    releaseSide();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith(DISCARD));
    expect(el("predictions-status").textContent).toBe("");
    expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${TOP}`);
    expect(role("dirty").hidden).toBe(false);

    // Told yes when clicked, it is not asked again once loaded.
    confirm.mockClear().mockReturnValue(true);
    predictionsButton(SIDE).click();
    await vi.waitFor(() => expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${SIDE}`));
    expect(confirm).toHaveBeenCalledTimes(1);

    // Clicked with nothing to lose, then edited while loading and told yes once loaded, it opens.
    const releaseTop = hold("download:p1");
    predictionsButton(TOP).click();
    role("edit").click();
    releaseTop();
    await vi.waitFor(() => expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${TOP}`));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(role("dirty").hidden).toBe(true);
    confirm.mockRestore();
  });

  it("drops one still on its way when the person says no to another, since it would drop the same edits", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const releaseSide = hold("download:p2");
    predictionsButton(SIDE).click();
    expect(el("predictions-status").textContent).toBe(`Opening ${SIDE}…`);
    role("edit").click();
    predictionsButton(TOP).click();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(el("predictions-status").textContent).toBe("");

    releaseSide();
    await settle();
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${TOP}`);
    expect(role("dirty").hidden).toBe(false);

    confirm.mockReturnValue(true);
    predictionsButton(SIDE).click();
    await vi.waitFor(() => expect(el("project-location").textContent).toBe(`Dandiset 000123 · ${SIDE}`));
    expect(role("dirty").hidden).toBe(true);
    confirm.mockRestore();
  });

  it("drops one still opening when the project is closed, and empties the list", async () => {
    const releaseSide = hold("download:p2");
    predictionsButton(SIDE).click();
    el("close-project-btn").click();
    expect(el("app-card").hidden).toBe(true);
    expect(el("predictions").hidden).toBe(true);
    expect(listed()).toEqual([]);

    releaseSide();
    await settle();
    await settle();
    expect(el("app-card").hidden).toBe(true);
    expect(el("open-card").hidden).toBe(false);
    expect(el("predictions-status").textContent).toBe("");
  });

  // The closed app still follows a job whose submission lands after it is gone, as the stand-in
  // does; the next project open by the time that job ends must not list what it wrote.
  it.each([
    ["before its submission landed", true],
    ["after its submission landed, while it ran", false],
  ])("lists nothing under the next project from a job its closed one submitted, reopened %s", async (_, early) => {
    await openListedProject();
    role("list-models").click();
    await vi.waitFor(() => expect(document.querySelector('[data-role="predict"]')).not.toBeNull());
    const closedJobState = role("job-state");
    const before = submits().length;
    const releaseSubmit = hold("submit");
    const releaseEvents = hold("events");
    role("predict").click();
    await vi.waitFor(() => expect(submits().length).toBe(before + 1));
    el("close-project-btn").click();
    if (early) await openListedProject();
    releaseSubmit();
    await vi.waitFor(() => expect(closedJobState.textContent).toBe("submitted"));
    if (!early) await openListedProject();
    releaseEvents();
    await vi.waitFor(() => expect(closedJobState.textContent).toBe("completed"));

    expect(el("app-card").hidden).toBe(false);
    expect(el("predictions").hidden).toBe(true);
    expect(listed()).toEqual([]);
    el("close-project-btn").click();
  });
});
