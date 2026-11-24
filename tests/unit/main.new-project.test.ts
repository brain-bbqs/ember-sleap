// @vitest-environment jsdom
// A signed-in visitor starting projects from the picker, against a routed archive: a dandiset with
// videos but no SLEAP project starts a new one on them, one with neither says so, New Project…
// starts one even beside projects, and starting one over unsaved edits asks first.
import { jsonResponse, routeFetch, type FetchRouter } from "@brain-bbqs/test-utils/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../../src/lib/settings";
import { bootMain, el, redirectedResponse, role } from "./helpers/mainHarness";

const API = "https://api-dandi.emberarchive.org/api";
const STORE = "https://s3.example/";
const TOKENS = { accessToken: "tok", refreshToken: "ref", expiresAt: Date.now() + 3_600_000 };
const HDF5 = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

type Asset = { asset_id: string; path: string; size: number };
const DRAFTS: Record<string, Record<string, Asset[]>> = {
  "000639": {
    "*.slp": [],
    "*.mp4": [
      { asset_id: "v1", path: "sub-01/ses-01/behavior/sub-01_ses-01_top.mp4", size: 10 },
      { asset_id: "v2", path: "sub-01/ses-02/behavior/sub-01_ses-02_top.mp4", size: 10 },
    ],
    "*.avi": [],
  },
  "000700": { "*.slp": [], "*.mp4": [], "*.avi": [] },
  "000398": {
    "*.slp": [{ asset_id: "p1", path: "sub-01/labels.slp", size: 2048 }],
    "*.mp4": [{ asset_id: "v9", path: "sub-01/top.mp4", size: 10 }],
    "*.avi": [],
  },
  // Its human-subjects flag cannot be read.
  "000640": { "*.slp": [], "*.mp4": [], "*.avi": [{ asset_id: "v40", path: "sub-04/side.avi", size: 10 }] },
  // Its one video's link cannot be had.
  "000642": { "*.slp": [], "*.mp4": [{ asset_id: "v42", path: "sub-42/top.mp4", size: 10 }], "*.avi": [] },
};
const DISCARD_FOR_NEW = "The open project has unsaved changes. Start a new project without saving them?";
const DISCARD_FOR_OPEN = "The open project has unsaved changes. Open another project without saving them?";
const UNCHECKED =
  " Could not check its human-subjects flag: each save tries again, and is refused until a check succeeds.";

let fetchMock: FetchRouter;
// Downloads the test holds back until it releases them, by asset id.
const held = new Map<string, { promise: Promise<void>; release: () => void }>();

function hold(assetId: string): () => void {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => (release = resolve));
  held.set(assetId, { promise, release });
  return () => {
    held.delete(assetId);
    release();
  };
}

const downloaded = (assetId: string) => fetchMock.callsTo(`${API}/assets/${assetId}/download/`).length;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function download(url: string): Promise<Response> {
  const assetId = /assets\/([a-z0-9]+)\//.exec(url)![1];
  await held.get(assetId)?.promise;
  return assetId === "v42" ? jsonResponse({ detail: "Not found." }, 404) : redirectedResponse(`${STORE}${assetId}`);
}

/** Opens the listed project of 000398 and waits until the app has read it. */
async function openListed(): Promise<void> {
  choose("open", "000398");
  await vi.waitFor(() => expect(el("project-list").hidden).toBe(false));
  el("project-list").querySelector("button")!.click();
  await vi.waitFor(() => expect(role("file-probe").textContent).toMatch(/HDF5 signature/));
}

const idIn = (url: string) => /\/dandisets\/(\d{6})\//.exec(url)![1];
const globIn = (url: string) => decodeURIComponent(/glob=([^&]+)/.exec(url)![1]);

function choose(intent: "new" | "open", dandisetId: string): void {
  role(intent === "new" ? "start-new" : "start-open").click();
  el<HTMLInputElement>("dandiset-input").value = dandisetId;
  el("open-form").dispatchEvent(new Event("submit", { cancelable: true }));
}

/** Returns to the start screen, saying yes to dropping whatever the project still has unsaved. */
async function closeProject(): Promise<void> {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  el("close-project-btn").click();
  await vi.waitFor(() => expect(role("start").hidden).toBe(false));
  vi.restoreAllMocks();
}

beforeAll(async () => {
  fetchMock = routeFetch([
    { match: `${API}/users/me/`, respond: jsonResponse({ username: "ada" }) },
    { match: `${API}/dandisets/?user=me`, respond: jsonResponse({ results: [] }) },
    {
      match: /\/versions\/draft\/assets\/\?glob=/,
      respond: (url) => jsonResponse({ results: DRAFTS[idIn(url)][globIn(url)], next: null }),
    },
    {
      match: /\/versions\/draft\/$/,
      respond: (url) => (idIn(url) === "000640" ? jsonResponse({}, 503) : jsonResponse({})),
    },
    {
      match: /\/dandisets\/\d{6}\/$/,
      respond: (url) => jsonResponse({ identifier: idIn(url), draft_version: { name: `Study ${idIn(url)}` } }),
    },
    { match: /\/assets\/[a-z0-9]+\/download\/$/, respond: download },
    { match: `${STORE}p1`, respond: () => new Response(HDF5, { status: 206 }) },
  ]);
  await bootMain({ fetch: fetchMock, localStorage: { [STORAGE_KEY]: JSON.stringify({ oauth: TOKENS }) } });
  await vi.waitFor(() => role("start"));
});

afterEach(() => vi.restoreAllMocks());

describe("starting a project from a dandiset", () => {
  it("starts a new project on the videos of a dandiset with no SLEAP project yet", async () => {
    choose("open", "000639");
    await vi.waitFor(() => expect(role("file-type").textContent).toBe("new project"));
    expect(el<HTMLDialogElement>("open-dialog").open).toBe(false);
    expect(el("project-title").textContent).toBe("Untitled.slp");
    expect(el("project-location").textContent).toBe("Dandiset 000639 · new project on 2 videos");
    expect(el("host-status").textContent).toBe(
      "New project on 2 videos from dandiset 000639: saving writes it into derivatives/sleap/.",
    );
    expect([...role("video-list").querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "sub-01/ses-01/behavior/sub-01_ses-01_top.mp4",
      "sub-01/ses-02/behavior/sub-01_ses-02_top.mp4",
    ]);
    expect(role<HTMLVideoElement>("video-player").getAttribute("src")).toBe(`${STORE}v1`);
    expect(role("dirty").hidden).toBe(false);
    await closeProject();
  });

  it("says so when the dandiset has neither a project nor a video to start one from", async () => {
    choose("open", "000700");
    await vi.waitFor(() =>
      expect(el("open-status").textContent).toBe(
        "Study 000700 (000700) holds no SLEAP projects, and no videos to start one from.",
      ),
    );
    expect(el("open-status").classList.contains("err")).toBe(true);
    expect(el<HTMLDialogElement>("open-dialog").open).toBe(true);
    expect(role("start").hidden).toBe(false);

    choose("new", "000700");
    await vi.waitFor(() =>
      expect(el("open-status").textContent).toBe("Study 000700 (000700) holds no videos to start a project from."),
    );
    el("open-dialog-close").click();
  });

  it("lists a dandiset's projects with a way to start a new one beside them", async () => {
    choose("open", "000398");
    await vi.waitFor(() => expect(el("project-list").hidden).toBe(false));
    expect(el("open-status").textContent).toBe("Study 000398 (000398): 1 project.");
    expect(el("new-project-btn").hidden).toBe(false);
    expect(el("new-project-btn").textContent).toBe("Start a new project from its 1 video");

    el("new-project-btn").click();
    await vi.waitFor(() => expect(role("file-type").textContent).toBe("new project"));
    expect(el("project-location").textContent).toBe("Dandiset 000398 · new project on 1 video");
    await closeProject();
  });

  it("starts a new project for New Project… even where projects already are", async () => {
    choose("new", "000398");
    expect(el("open-status").textContent).toBe("Finding the videos in dandiset 000398…");
    await vi.waitFor(() => expect(role("file-type").textContent).toBe("new project"));
    expect(el("project-list").hidden).toBe(true);
    await closeProject();
  });

  it("asks before a new project replaces unsaved edits, and keeps them on a no", async () => {
    choose("open", "000398");
    await vi.waitFor(() => expect(el("project-list").hidden).toBe(false));
    el("project-list").querySelector("button")!.click();
    await vi.waitFor(() => expect(role("file-probe").textContent).toMatch(/HDF5 signature/));
    role("edit").click();

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    choose("new", "000639");
    await vi.waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(
        "The open project has unsaved changes. Start a new project without saving them?",
      ),
    );
    expect(role("file-name").textContent).toBe("labels.slp");
    expect(role("dirty").hidden).toBe(false);

    confirm.mockReturnValue(true);
    el("open-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(role("file-type").textContent).toBe("new project"));
    await closeProject();
  });

  it("stops what the picker was doing once it is closed", async () => {
    const before = fetchMock.callsTo(`${API}/assets/v1/download/`).length;
    choose("open", "000639");
    el("open-dialog-close").click();
    await new Promise((r) => setTimeout(r, 50));
    expect(role("start").hidden).toBe(false);
    expect(el("close-project-btn").hidden).toBe(true);
    expect(fetchMock.callsTo(`${API}/assets/v1/download/`).length).toBe(before);
  });

  it("starts anyway when the dandiset's human-subjects flag cannot be read, and says so beside it", async () => {
    choose("open", "000640");
    await vi.waitFor(() => expect(role("file-type").textContent).toBe("new project"));
    expect(el("host-status").textContent).toBe(
      `New project on 1 video from dandiset 000640: saving writes it into derivatives/sleap/.${UNCHECKED}`,
    );
    expect(el("host-status").classList.contains("err")).toBe(true);
    await closeProject();
  });

  it("says why a new project could not start, and keeps the picker open", async () => {
    choose("open", "000642");
    await vi.waitFor(() => expect(el("open-status").classList.contains("err")).toBe(true));
    expect(el("open-status").textContent).not.toBe("");
    expect(el<HTMLDialogElement>("open-dialog").open).toBe(true);
    expect(role("start").hidden).toBe(false);
    el("open-dialog-close").click();
  });

  it.each([
    ["drops a new project", "v1", "000639"],
    ["says nothing of a failure", "v42", "000642"],
  ])("%s once its picker is closed while its video links are on their way", async (_, assetId, dandisetId) => {
    const release = hold(assetId);
    const before = downloaded(assetId);
    choose("open", dandisetId);
    await vi.waitFor(() => expect(downloaded(assetId)).toBe(before + 1));
    el("open-dialog-close").click();
    release();
    await settle();
    await settle();
    expect(role("start").hidden).toBe(false);
    expect(el("close-project-btn").hidden).toBe(true);
    expect(el("open-status").classList.contains("err")).toBe(false);
  });

  it("asks about edits made while a new project's videos were on their way, and keeps them on a no", async () => {
    await openListed();
    const release = hold("v1");
    const before = downloaded("v1");
    choose("new", "000639");
    await vi.waitFor(() => expect(downloaded("v1")).toBe(before + 1));
    role("edit").click();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    release();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith(DISCARD_FOR_NEW));
    await settle();
    expect(role("file-name").textContent).toBe("labels.slp");
    expect(el("open-status").textContent).toBe("");
    el("open-dialog-close").click();
    await closeProject();
  });

  it("asks before another project replaces unsaved edits, and keeps them on a no", async () => {
    await openListed();
    role("edit").click();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const before = downloaded("p1");
    choose("open", "000398");
    await vi.waitFor(() => expect(el("project-list").hidden).toBe(false));
    el("project-list").querySelector("button")!.click();
    expect(confirm).toHaveBeenCalledWith(DISCARD_FOR_OPEN);
    await settle();
    expect(downloaded("p1")).toBe(before);
    expect(role("dirty").hidden).toBe(false);
    el("open-dialog-close").click();
    await closeProject();
  });

  it("asks about edits made while another project was on its way, and keeps them on a no", async () => {
    await openListed();
    const release = hold("p1");
    choose("open", "000398");
    await vi.waitFor(() => expect(el("project-list").hidden).toBe(false));
    const before = downloaded("p1");
    el("project-list").querySelector("button")!.click();
    await vi.waitFor(() => expect(downloaded("p1")).toBe(before + 1));
    role("edit").click();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    release();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith(DISCARD_FOR_OPEN));
    await settle();
    expect(role("dirty").hidden).toBe(false);
    expect(el("open-status").textContent).toBe("");
    el("open-dialog-close").click();
    await closeProject();
  });
});
