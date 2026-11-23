// @vitest-environment jsdom
// A returning, signed-in visitor lands on `?dandiset=000123`, an embargoed dandiset flagged for
// human subjects, against a routed archive: listing, opening through a presigned link, the
// human-subjects gate refusing a save, and the unsaved-work check on sign-out.
import { jsonResponse, routeFetch, type FetchRouter } from "@brain-bbqs/test-utils/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../../src/lib/settings";
import { bootMain, el, redirectedResponse, role } from "./helpers/mainHarness";

const API = "https://api-dandi.emberarchive.org/api";
const PRESIGNED = "https://ember-embargo.s3.example/blobs/abc?X-Amz-Signature=sig";
const HDF5 = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const TOKENS = { accessToken: "tok", refreshToken: "ref", expiresAt: Date.now() + 3_600_000 };
const MODELS = encodeURIComponent("derivatives/sleap/models/");

let fetchMock: FetchRouter;

beforeAll(async () => {
  fetchMock = routeFetch([
    { match: `${API}/users/me/`, respond: jsonResponse({ username: "ada", name: "Ada Lovelace" }) },
    {
      match: `${API}/dandisets/?user=me`,
      respond: jsonResponse({
        results: [{ identifier: "000123", embargo_status: "EMBARGOED", draft_version: { name: "Incoming: Lab" } }],
      }),
    },
    {
      match: (url) => url.startsWith(`${API}/dandisets/000123/versions/draft/assets/?glob=`),
      respond: jsonResponse({
        results: [
          { asset_id: "a1", path: "sub-01/ses-02/labels.slp", size: 2048 },
          { asset_id: "a2", path: "sub-01/ses-02/train.pkg.slp", size: 4096 },
        ],
        next: null,
      }),
    },
    {
      match: (url) => url.startsWith(`${API}/dandisets/000123/versions/draft/assets/?path=${MODELS}`),
      respond: jsonResponse({
        results: [
          { asset_id: "c1", path: "derivatives/sleap/models/mouse/training_config.yaml" },
          { asset_id: "k1", path: "derivatives/sleap/models/mouse/best.ckpt" },
          { asset_id: "m1", path: "derivatives/sleap/models/mouse/model_card.json" },
        ],
      }),
    },
    {
      match: `${API}/dandisets/000123/versions/draft/`,
      respond: jsonResponse({ description: "Pilot. CONTAINS HUMAN SUBJECTS." }),
    },
    {
      match: `${API}/dandisets/000123/`,
      respond: jsonResponse({
        identifier: "000123",
        embargo_status: "EMBARGOED",
        draft_version: { name: "Incoming: Lab" },
      }),
    },
    { match: `${API}/assets/m1/download/`, respond: () => new Response(JSON.stringify({ name: "Mouse" })) },
    { match: `${API}/assets/a1/download/`, respond: () => redirectedResponse(PRESIGNED) },
    { match: PRESIGNED, respond: () => new Response(HDF5, { status: 206 }) },
  ]);
  await bootMain({
    url: "?dandiset=000123",
    fetch: fetchMock,
    localStorage: { [STORAGE_KEY]: JSON.stringify({ dandisetId: "000999", oauth: TOKENS }) },
  });
  await vi.waitFor(() => expect(el("project-list").hidden).toBe(false));
});

afterEach(() => vi.restoreAllMocks());

const bearer = (url: string) => new Headers(fetchMock.callsTo(url)[0]?.init?.headers).get("Authorization");

/** Clicks "Find models" and returns the Authorization header of each EMBER call it made. */
async function findModels(): Promise<(string | null)[]> {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const before = fetchMock.calls.length;
  role("list-models").click();
  await vi.waitFor(() => expect(role("models").textContent).toContain("Mouse"));
  return fetchMock.calls
    .slice(before)
    .filter((c) => c.url.startsWith(API))
    .map((c) => new Headers(c.init?.headers).get("Authorization"));
}

describe("a signed-in visitor on an embargoed, human-subjects dandiset", () => {
  it("shows the account and suggests the dandisets it owns", async () => {
    expect(el("oauthSignedIn").hidden).toBe(false);
    await vi.waitFor(() => expect(el("oauthUsername").textContent).toBe("ada"));
    await vi.waitFor(() => expect(el("dandiset-options").children.length).toBe(1));
    const option = el("dandiset-options").firstElementChild as HTMLOptionElement;
    expect([option.value, option.label]).toEqual(["000123", "Incoming: Lab"]);
  });

  it("lists the URL's dandiset rather than the remembered one, with the account's token", () => {
    expect(el<HTMLInputElement>("dandiset-input").value).toBe("000123");
    expect(el("open-status").textContent).toBe("Incoming: Lab (000123), embargoed: 2 projects.");
    expect([...el("project-list").querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "sub-01/ses-02/labels.slp",
      "sub-01/ses-02/train.pkg.slp",
    ]);
    expect(bearer(`${API}/dandisets/000123/`)).toBe("Bearer tok");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).dandisetId).toBe("000123");
  });

  it("raises the human-subjects notice for the listed dandiset", async () => {
    await vi.waitFor(() => expect(el("humanSubjectsBanner").hidden).toBe(false));
    expect(el("humanSubjectsUnconfirmed").hidden).toBe(false);
  });

  it("opens a project through a presigned link and reads it by its declared type", async () => {
    el("project-list").querySelector<HTMLButtonElement>('[data-path="sub-01/ses-02/labels.slp"]')!.click();
    await vi.waitFor(() => expect(role("file-probe").textContent).toMatch(/HDF5 signature/));
    expect(el("close-project-btn").hidden).toBe(false);
    expect(el<HTMLDialogElement>("open-dialog").open).toBe(false);
    expect(el("project-location").textContent).toBe("Dandiset 000123 · sub-01/ses-02/labels.slp");
    expect(bearer(`${API}/assets/a1/download/`)).toBe("Bearer tok");
    // The app is handed the storage link, never the token.
    expect(bearer(PRESIGNED)).toBeNull();
  });

  it("finds the dandiset's own models with the account's token", async () => {
    expect(await findModels()).toEqual(["Bearer tok", "Bearer tok"]);
  });

  it("refuses to save until the human-subjects notice is confirmed", async () => {
    role("edit").click();
    role("save").click();
    const refusal = "Confirm the human-subjects notice above before saving to this dandiset.";
    await vi.waitFor(() => expect(el("host-status").textContent).toBe(refusal));
    expect(role("save-status").textContent).toBe(`Save failed: ${refusal}`);
    expect(fetchMock.callsTo("/uploads/initialize/").length).toBe(0);
  });

  it("keeps the edits a training job is sent to the same rule, and submits nothing", async () => {
    role("train").click();
    const refusal = "Confirm the human-subjects notice above before saving to this dandiset.";
    await vi.waitFor(() => expect(role("compute-status").textContent).toBe(`Could not submit: ${refusal}`));
    expect(el("host-status").textContent).toBe(refusal);
    expect(role("job").hidden).toBe(true);
    expect(fetchMock.callsTo("/uploads/initialize/").length).toBe(0);
  });

  it("asks before signing out with unsaved edits, saying they could not be saved after, and stays if told no", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    el("oauthSignoutBtn").click();
    expect(confirm.mock.calls).toEqual([
      [
        "The open project has unsaved changes. Signing out means they cannot be saved to EMBER: " +
          "signing back in reloads the page and discards them. Sign out anyway?",
      ],
    ]);
    expect(el("oauthSignedIn").hidden).toBe(false);

    confirm.mockReturnValue(true);
    el("oauthSignoutBtn").click();
    expect(el("oauthSignedIn").hidden).toBe(true);
    expect(el("oauthSigninBtn").hidden).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ dandisetId: "000123" });
    expect(el("dandiset-options").children.length).toBe(0);
  });

  it("finds models anonymously once signed out", async () => {
    expect(await findModels()).toEqual([null, null]);
  });

  it("says a save needs sign-in once signed out", async () => {
    el("humanSubjectsConfirmBtn").click();
    role("save").click();
    await vi.waitFor(() => expect(el("host-status").textContent).toBe("Sign in with EMBER to save."));
  });
});
