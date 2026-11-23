// @vitest-environment jsdom
// The page coming back from EMBER's sign-in: this boot is the OAuth redirect, with a token that
// needs refreshing. OAuth is a fake, and storage a recording one, so this file is about main.ts's
// wiring, not the archive calls (main.ember.test.ts has those).
import { jsonResponse, routeFetch, type FetchRouter } from "@brain-bbqs/test-utils/vitest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { EmberStorageOptions } from "../../src/lib/emberStorage";
import { STORAGE_KEY } from "../../src/lib/settings";
import { STAND_IN_VERSION } from "../../src/ui/sleapStandIn";
import { bootMain, el, role } from "./helpers/mainHarness";

const fakes = vi.hoisted(() => {
  const signedIn = { accessToken: "first", refreshToken: "r", expiresAt: 1 };
  const refreshed = { accessToken: "fresh", refreshToken: "r", expiresAt: 2 };
  const oauth = {
    startLogin: vi.fn(() => Promise.resolve()),
    handleRedirectCallback: vi.fn(() => Promise.resolve(signedIn)),
    ensureFreshToken: vi.fn(() => Promise.resolve(refreshed)),
    revokeToken: vi.fn(() => Promise.resolve()),
  };
  const warning = "Could not write derivatives/sleap/.bidsignore: HTTP 400.";
  const path = "derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.slp";
  const saved = {
    ref: { key: `ember:000123:${path}` },
    file: { url: "https://s3.example/s1", fileType: "slp" as const, name: path.split("/").pop()! },
  };
  return { signedIn, refreshed, oauth, warning, saved, storageOptions: null as EmberStorageOptions | null };
});

vi.mock("../../src/lib/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/oauth")>()),
  createOAuth: () => fakes.oauth,
}));
vi.mock("../../src/lib/emberStorage", () => ({
  createEmberStorage: (options: EmberStorageOptions) => {
    fakes.storageOptions = options;
    let opens = 0;
    let saves = 0;
    return {
      open: (dandisetId: string, project: { path: string }) =>
        ++opens === 1
          ? Promise.reject(new Error("The link expired."))
          : Promise.resolve({
              url: "data:application/octet-stream;base64,iUhERg0KGgoAAAAA",
              fileType: "slp",
              name: "labels.slp",
              ref: { key: `ember:${dandisetId}:${project.path}` },
            }),
      // The first save's scaffolding is refused; later ones find it written.
      save: () => {
        options.onProgress?.("hashing", 0.25);
        options.onProgress?.("uploading", 0.5);
        if (++saves === 1) options.onWarning?.(fakes.warning);
        return Promise.resolve(fakes.saved);
      },
      resolveVideo: () => Promise.resolve(null),
      refreshUrl: (file: unknown) => Promise.resolve(file),
    };
  },
}));

const API = "https://api-dandi.emberarchive.org/api";
const LANDED = "Saved to the draft of dandiset 000123: derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.slp";
const WARNING = fakes.warning;
let fetchMock: FetchRouter;

/** Every text `target` is given, in order, however briefly it shows. */
function recordTexts(target: HTMLElement): { texts: string[]; stop: () => void } {
  const texts: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) texts.push(node.textContent ?? "");
  });
  observer.observe(target, { childList: true });
  return { texts, stop: () => observer.disconnect() };
}

beforeAll(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const realFetch = globalThis.fetch;
  const routed = routeFetch([
    { match: `${API}/users/me/`, respond: jsonResponse({ username: "ada", name: null }) },
    { match: `${API}/dandisets/?user=me`, respond: jsonResponse({ detail: "down" }, 503) },
    {
      match: (url) => url.startsWith(`${API}/dandisets/000123/versions/draft/assets/`),
      respond: jsonResponse({ results: [{ asset_id: "a1", path: "sub-01/labels.slp", size: 12 }], next: null }),
    },
    { match: `${API}/dandisets/000123/versions/draft/`, respond: jsonResponse({ description: "Pilot." }) },
    { match: `${API}/dandisets/000123/`, respond: jsonResponse({ identifier: "000123" }) },
  ]);
  fetchMock = Object.assign(
    (input: string | URL | Request, init?: RequestInit) =>
      typeof input === "string" && input.startsWith("data:") ? realFetch(input, init) : routed(input, init),
    { calls: routed.calls, callsTo: routed.callsTo },
  );
  await bootMain({ url: "?dandiset=000123", fetch: fetchMock });
  await vi.waitFor(() => expect(el("project-list").hidden).toBe(false));
});

describe("main.ts coming back from EMBER sign-in", () => {
  it("completes the sign-in redirect, refreshes the token once for every call at boot, and stores the fresh one", async () => {
    expect(fakes.oauth.handleRedirectCallback).toHaveBeenCalledTimes(1);
    expect(el("oauthSignedIn").hidden).toBe(false);
    await vi.waitFor(() => expect(el("oauthUsername").textContent).toBe("ada"));
    expect(fakes.oauth.ensureFreshToken.mock.calls).toEqual([[fakes.signedIn]]);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as { oauth: unknown };
    expect(stored.oauth).toEqual(fakes.refreshed);
  });

  it("lists a dandiset with no title by its id, and no suggestions when the owner listing fails", () => {
    expect(el("open-status").textContent).toBe("Dandiset 000123: 1 project.");
    expect(el("dandiset-options").children.length).toBe(0);
    expect(el("humanSubjectsBanner").hidden).toBe(true);
  });

  it("sends the person to EMBER's sign-in page", () => {
    el("oauthSigninBtn").click();
    expect(fakes.oauth.startLogin).toHaveBeenCalled();
  });

  it("records the version of the SLEAP app it mounted at boot in what it saves", async () => {
    await vi.waitFor(() => expect(fakes.storageOptions!.versions().sleap).toBe(STAND_IN_VERSION));
  });

  it("reports a project that fails to open, and opens it on a second try", async () => {
    const open = () => el("project-list").querySelector("button")!.click();
    open();
    await vi.waitFor(() => expect(el("open-status").textContent).toBe("The link expired."));
    open();
    await vi.waitFor(() => expect(role("file-probe").textContent).toMatch(/HDF5 signature/));
    expect(el("open-status").textContent).toBe("");
  });

  it("reports each save stage's progress, then where the save landed with the scaffold warning kept beside it", async () => {
    const shown = recordTexts(el("host-status"));
    role("save").click();
    await vi.waitFor(() => expect(el("host-status").textContent).toBe(`${LANDED}. ${WARNING}`));
    shown.stop();
    expect(shown.texts).toEqual([
      "Checking the file… 25%",
      "Uploading to EMBER… 50%",
      WARNING,
      `${LANDED}. ${WARNING}`,
    ]);
    expect(el("host-status").classList.contains("err")).toBe(true);
    expect(fakes.storageOptions!.hash).toEqual(expect.any(Function));
    expect(fakes.storageOptions!.versions()).toEqual({ app: expect.any(String), sleap: "0.0.0-stand-in" });
  });

  it("says plainly where a save landed when nothing went wrong", async () => {
    role("save").click();
    await vi.waitFor(() => expect(el("host-status").textContent).toBe(LANDED));
    expect(el("host-status").classList.contains("ok")).toBe(true);
    expect(el("host-status").classList.contains("err")).toBe(false);
  });

  it.each([
    ["overwrite-replace", "replace"],
    ["overwrite-keep", "keep-both"],
    ["overwrite-cancel", "cancel"],
  ])("asks in the page's own dialog what to do with labels already saved (%s)", async (button, choice) => {
    const asked = fakes.storageOptions!.askOverwrite("derivatives/sleap/sub-01/beh/x.slp");
    expect(el<HTMLDialogElement>("overwrite-dialog").open).toBe(true);
    expect(el("overwrite-path").textContent).toBe("derivatives/sleap/sub-01/beh/x.slp");
    el(button).click();
    expect(await asked).toBe(choice);
  });

  it("revokes the token on sign-out", () => {
    el("oauthSignoutBtn").click();
    expect(fakes.oauth.revokeToken).toHaveBeenCalledWith(fakes.refreshed);
    expect(el("oauthSigninBtn").hidden).toBe(false);
  });
});
