// @vitest-environment jsdom
// A signed-out visitor whose archive answers out of order, with responses the test releases by
// hand: listings and opens where the latest one wins, and a dandiset whose human-subjects flag
// cannot be read, which refuses saves until a read succeeds.
import { jsonResponse, routeFetch, type FetchRouter } from "@brain-bbqs/test-utils/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bootMain, el, redirectedResponse, role } from "./helpers/mainHarness";

const holds = vi.hoisted(() => {
  const waiting = new Map<string, { promise: Promise<void>; release: () => void }>();
  return {
    /** Settles once the test releases `name`; every caller waiting on one name shares it. */
    until(name: string): Promise<void> {
      let hold = waiting.get(name);
      if (!hold) {
        let release: () => void = () => undefined;
        const promise = new Promise<void>((resolve) => {
          release = resolve;
        });
        hold = { promise, release };
        waiting.set(name, hold);
      }
      return hold.promise;
    },
    waiting: (name: string) => waiting.has(name),
    componentAsked: false,
    componentLoaded: false,
    release(name: string): void {
      const hold = waiting.get(name);
      if (!hold) throw new Error(`nothing is waiting on ${name}`);
      waiting.delete(name);
      hold.release();
    },
  };
});

// The SLEAP app first loads when the test says, so a click can land while it is still loading.
vi.mock("../../src/ui/sleapComponent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/ui/sleapComponent")>();
  const firstLoad = holds.until("component");
  return {
    ...actual,
    loadSleapComponent: async () => {
      holds.componentAsked = true;
      await firstLoad;
      const component = await actual.loadSleapComponent();
      holds.componentLoaded = true;
      return component;
    },
  };
});

const STORE = "https://s3.example/";
const HDF5 = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const FLAGGED = { description: "Pilot. CONTAINS HUMAN SUBJECTS." };
const UNREAD =
  "Could not check this dandiset's human-subjects flag, so saving to it is refused. Save again to retry the check.";

const PROJECTS: Record<string, { asset_id: string; path: string; size: number }[]> = {
  "000111": [{ asset_id: "b1", path: "sub-01/early.slp", size: 1 }],
  "000222": [
    { asset_id: "a1", path: "sub-01/one.slp", size: 1 },
    { asset_id: "a2", path: "sub-01/two.slp", size: 1 },
    { asset_id: "a9", path: "sub-01/gone.slp", size: 1 },
  ],
  "000333": [{ asset_id: "a3", path: "sub-02/three.slp", size: 1 }],
  "000444": [],
};
// What 000333's draft metadata answers with, changed as the tests go.
let flag333: "unreadable" | "clear" | "flagged" = "unreadable";

let fetchMock: FetchRouter;

const idIn = (url: string) => /\/dandisets\/(\d{6})\//.exec(url)![1];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const projectButton = (path: string) => el("project-list").querySelector<HTMLButtonElement>(`[data-path="${path}"]`)!;

function submitDandiset(value: string): void {
  el<HTMLInputElement>("dandiset-input").value = value;
  el("open-form").dispatchEvent(new Event("submit", { cancelable: true }));
}

function draftMetadata(id: string): Response | Promise<Response> {
  if (id === "000111") return holds.until("meta-000111").then(() => jsonResponse({}));
  if (id === "000222") return jsonResponse(FLAGGED);
  if (id === "000333" && flag333 !== "clear")
    return flag333 === "flagged" ? jsonResponse(FLAGGED) : jsonResponse({}, 503);
  return jsonResponse({});
}

function download(assetId: string): Response | Promise<Response> {
  const link = () => redirectedResponse(`${STORE}${assetId}`);
  if (assetId === "a1") return holds.until("a1").then(link);
  if (assetId === "a9") return holds.until("a9").then(() => jsonResponse({}, 404));
  return link();
}

function closeProject(): void {
  el("close-project-btn").click();
  expect(el("open-card").hidden).toBe(false);
}

beforeAll(async () => {
  fetchMock = routeFetch([
    { match: /\/versions\/draft\/assets\/\?glob=/, respond: (url) => jsonResponse({ results: PROJECTS[idIn(url)] }) },
    { match: /\/versions\/draft\/$/, respond: (url) => draftMetadata(idIn(url)) },
    {
      match: /\/dandisets\/\d{6}\/$/,
      respond: (url) =>
        idIn(url) === "000444"
          ? holds.until("dandiset-000444").then(() => jsonResponse({}, 500))
          : jsonResponse({ identifier: idIn(url) }),
    },
    { match: /\/assets\/\w+\/download\/$/, respond: (url) => download(/\/assets\/(\w+)\//.exec(url)![1]) },
    { match: STORE, respond: () => new Response(HDF5, { status: 206 }) },
  ]);
  await bootMain({ fetch: fetchMock });
});

afterEach(() => vi.restoreAllMocks());

describe("listings and opens that resolve out of order", () => {
  it("drops a listing that resolves after a newer one, keeping the list and the notice on the newer dandiset", async () => {
    submitDandiset("000111");
    submitDandiset("000222");
    await vi.waitFor(() => expect(el("open-status").textContent).toBe("Dandiset 000222: 3 projects."));
    expect(el("humanSubjectsBanner").hidden).toBe(false);

    holds.release("meta-000111");
    await settle();
    expect(el("open-status").textContent).toBe("Dandiset 000222: 3 projects.");
    expect(el("humanSubjectsBanner").hidden).toBe(false);
    expect(projectButton("sub-01/early.slp")).toBeNull();
    expect(projectButton("sub-01/one.slp")).not.toBeNull();
  });

  it("keeps a listing that fails after a newer one from replacing its status", async () => {
    submitDandiset("000444");
    await vi.waitFor(() => expect(holds.waiting("dandiset-000444")).toBe(true));
    submitDandiset("000222");
    await vi.waitFor(() => expect(el("open-status").textContent).toBe("Dandiset 000222: 3 projects."));

    holds.release("dandiset-000444");
    await settle();
    expect(el("open-status").textContent).toBe("Dandiset 000222: 3 projects.");
    expect(el("open-status").classList.contains("err")).toBe(false);
  });

  it("drops an open overtaken by another click while the app is still loading", async () => {
    projectButton("sub-01/two.slp").click();
    await vi.waitFor(() => expect(holds.componentAsked).toBe(true));
    projectButton("sub-01/one.slp").click();
    holds.release("component");
    await vi.waitFor(() => expect(holds.componentLoaded).toBe(true));
    await settle();
    expect(el("app-card").hidden).toBe(true);
    expect(el("open-status").textContent).toBe("Opening sub-01/one.slp…");

    holds.release("a1");
    await vi.waitFor(() => expect(role("file-probe").textContent).toMatch(/HDF5 signature/));
    expect(el("project-location").textContent).toBe("Dandiset 000222 · sub-01/one.slp");
    expect(el("open-status").textContent).toBe("");
    closeProject();
  });

  it("drops an earlier click that resolves after a later one", async () => {
    projectButton("sub-01/one.slp").click();
    projectButton("sub-01/two.slp").click();
    await vi.waitFor(() => expect(role("file-probe").textContent).toMatch(/HDF5 signature/));
    expect(el("project-location").textContent).toBe("Dandiset 000222 · sub-01/two.slp");

    holds.release("a1");
    await settle();
    expect(el("project-location").textContent).toBe("Dandiset 000222 · sub-01/two.slp");
    expect(role("file-name").textContent).toBe("two.slp");
    closeProject();
  });

  it("drops an open still on its way when a new listing starts, and says when a flag could not be read", async () => {
    projectButton("sub-01/gone.slp").click();
    submitDandiset("000333");
    const listed =
      "Dandiset 000333: 1 project. Could not check its human-subjects flag: list it again before saving to it.";
    await vi.waitFor(() => expect(el("open-status").textContent).toBe(listed));
    expect(el("open-status").classList.contains("err")).toBe(true);
    expect(el("humanSubjectsBanner").hidden).toBe(true);

    holds.release("a9");
    await settle();
    expect(el("open-status").textContent).toBe(listed);
    expect(el("app-card").hidden).toBe(true);
  });
});

describe("a dandiset whose human-subjects flag cannot be read", () => {
  async function openAndSave(): Promise<void> {
    projectButton("sub-02/three.slp").click();
    await vi.waitFor(() => expect(role("file-probe").textContent).toMatch(/HDF5 signature/));
    await save();
  }

  async function save(): Promise<void> {
    const before = el("host-status").textContent;
    role("save").click();
    await vi.waitFor(() => expect(role("save-status").textContent).toMatch(/^Save failed/));
    await vi.waitFor(() => expect(el("host-status").textContent).not.toBe(before));
  }

  it("lets saving through once listing it again reads the flag", async () => {
    flag333 = "clear";
    submitDandiset("000333");
    await vi.waitFor(() => expect(el("open-status").textContent).toBe("Dandiset 000333: 1 project."));
    expect(el("open-status").classList.contains("err")).toBe(false);

    await openAndSave();
    expect(el("host-status").textContent).toBe("Sign in with EMBER to save.");
    closeProject();
  });

  it("refuses saves while the flag cannot be read, and reads it again at each save", async () => {
    flag333 = "unreadable";
    submitDandiset("000333");
    await vi.waitFor(() => expect(el("open-status").classList.contains("err")).toBe(true));
    const reads = () => fetchMock.calls.filter((c) => c.url.endsWith("/dandisets/000333/versions/draft/")).length;
    const listingReads = reads();

    await openAndSave();
    expect(el("host-status").textContent).toBe(UNREAD);
    expect(reads()).toBe(listingReads + 1);

    flag333 = "flagged";
    await save();
    expect(el("host-status").textContent).toBe(
      "Confirm the human-subjects notice above before saving to this dandiset.",
    );
    expect(el("humanSubjectsBanner").hidden).toBe(false);

    el("humanSubjectsConfirmBtn").click();
    await save();
    expect(el("host-status").textContent).toBe("Sign in with EMBER to save.");
    expect(fetchMock.callsTo("/uploads/").length).toBe(0);
  });

  it("keeps a flag it read earlier when a later read fails", async () => {
    closeProject();
    flag333 = "unreadable";
    submitDandiset("000333");
    await vi.waitFor(() => expect(el("open-status").classList.contains("err")).toBe(true));
    expect(el("humanSubjectsBanner").hidden).toBe(false);
  });
});
