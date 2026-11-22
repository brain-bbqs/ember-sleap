import { ApiError, type ArchiveConfig } from "@brain-bbqs/ember-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closestAsset,
  downloadUrl,
  fetchDandiset,
  findAssetByPath,
  findAssetsByName,
  listOwnDandisets,
  listProjects,
  resolveDownloadUrl,
} from "../../src/lib/emberAssets";

const API = "https://api.test/api";
const cfg = (accessToken = ""): ArchiveConfig => ({
  api: API,
  web: "https://web.test",
  accessToken,
  dandisetId: "000398",
});

/** Stubs the global fetch `apiFetch` uses with JSON bodies keyed by request path (after the API root). */
function stubApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    const path = url.startsWith(API) ? url.slice(API.length) : url;
    if (!(path in routes)) return Promise.resolve(new Response("missing", { status: 404 }));
    return Promise.resolve(Response.json(routes[path]));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const assetsPath = (filter: string, page = "") =>
  `/dandisets/000398/versions/draft/assets/?${filter}&metadata=false&order=path&page_size=1000${page}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDandiset", () => {
  it("reads the draft's title and embargo status", async () => {
    stubApi({
      "/dandisets/000398/": {
        identifier: "000398",
        embargo_status: "EMBARGOED",
        draft_version: { name: "SLEAP Training Data Example" },
      },
    });
    expect(await fetchDandiset(cfg())).toEqual({
      identifier: "000398",
      title: "SLEAP Training Data Example",
      embargoed: true,
    });
  });

  it("treats missing fields as an untitled, open dandiset", async () => {
    stubApi({ "/dandisets/000398/": {} });
    expect(await fetchDandiset(cfg())).toEqual({ identifier: "000398", title: "", embargoed: false });
  });
});

describe("listOwnDandisets", () => {
  it("lists the account's dandisets, embargoed ones included", async () => {
    const fetchMock = stubApi({
      "/dandisets/?user=me&embargoed=true&page_size=1000": {
        results: [
          { identifier: "000001", embargo_status: "OPEN", draft_version: { name: "Draft" } },
          { identifier: "000002", embargo_status: "EMBARGOED", most_recent_published_version: { name: "Published" } },
          { identifier: "000003" },
        ],
      },
    });
    expect(await listOwnDandisets(cfg("tok"))).toEqual([
      { identifier: "000001", title: "Draft", embargoed: false },
      { identifier: "000002", title: "Published", embargoed: true },
      { identifier: "000003", title: "", embargoed: false },
    ]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("is empty when the page has no results", async () => {
    stubApi({ "/dandisets/?user=me&embargoed=true&page_size=1000": {} });
    expect(await listOwnDandisets(cfg("tok"))).toEqual([]);
  });
});

describe("listProjects", () => {
  it("keeps the .slp and .pkg.slp assets the glob matched, following pages", async () => {
    stubApi({
      [assetsPath("glob=*.slp")]: {
        results: [{ asset_id: "a", path: "sub-NONE/sub-NONE_sourcedata.slp", size: 1 }],
        next: `${API}${assetsPath("glob=*.slp", "&page=2")}`,
      },
      [assetsPath("glob=*.slp", "&page=2")]: {
        results: [
          { asset_id: "b", path: "sub-NONE/train.pkg.slp", size: 2 },
          // A glob on "*.slp" can only match names ending in .slp, but the check stays honest.
          { asset_id: "c", path: "sub-NONE/odd.slp.json", size: 3 },
        ],
        next: null,
      },
    });
    expect(await listProjects(cfg())).toEqual([
      { asset_id: "a", path: "sub-NONE/sub-NONE_sourcedata.slp", size: 1, fileType: "slp" },
      { asset_id: "b", path: "sub-NONE/train.pkg.slp", size: 2, fileType: "pkg.slp" },
    ]);
  });

  it("stops at a next page on another host", async () => {
    const fetchMock = stubApi({
      [assetsPath("glob=*.slp")]: { next: "https://elsewhere.test/api/next" },
    });
    expect(await listProjects(cfg())).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops after twenty pages", async () => {
    const fetchMock = stubApi({
      [assetsPath("glob=*.slp")]: { results: [], next: `${API}${assetsPath("glob=*.slp")}` },
    });
    expect(await listProjects(cfg())).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });
});

describe("findAssetByPath", () => {
  const path = "derivatives/sleap/dataset_description.json";

  it("returns the asset at exactly that path, not one the prefix filter also matched", async () => {
    stubApi({
      [assetsPath(`path=${encodeURIComponent(path)}`)]: {
        results: [
          { asset_id: "longer", path: `${path}.bak`, size: 1 },
          { asset_id: "exact", path, size: 2 },
        ],
      },
    });
    expect(await findAssetByPath(cfg(), path)).toEqual({ asset_id: "exact", path, size: 2 });
  });

  it("returns null when nothing is there", async () => {
    stubApi({
      [assetsPath(`path=${encodeURIComponent(path)}`)]: { results: [{ asset_id: "x", path: `${path}x`, size: 1 }] },
    });
    expect(await findAssetByPath(cfg(), path)).toBe(null);
  });
});

describe("findAssetsByName", () => {
  it("keeps only assets whose file name is exactly the one asked for", async () => {
    stubApi({
      [assetsPath(`glob=${encodeURIComponent("*session1.mp4")}`)]: {
        results: [
          { asset_id: "1", path: "sub-01/session1.mp4", size: 1 },
          { asset_id: "2", path: "sub-01/old-session1.mp4", size: 1 },
          { asset_id: "3", path: "sub-02/beh/session1.mp4", size: 1 },
        ],
      },
    });
    expect((await findAssetsByName(cfg(), "session1.mp4")).map((a) => a.asset_id)).toEqual(["1", "3"]);
  });
});

describe("closestAsset", () => {
  const candidates = [
    { path: "sub-02/beh/session1.mp4" },
    { path: "sub-01/ses-01/beh/session1.mp4" },
    { path: "sub-01/ses-02/session1.mp4" },
  ];

  it.each([
    ["the stored path ends with its full path", "D:\\data\\sub-01\\ses-02\\session1.mp4", "sub-02/x.slp", 2],
    ["the stored path is its path", "sub-02/beh/session1.mp4", "sub-01/ses-01/x.slp", 0],
    ["it shares the most folders with the project", "/lab/session1.mp4", "sub-01/ses-01/beh/labels.slp", 1],
    ["ties keep listing order", "/lab/session1.mp4", "labels.slp", 0],
  ])("picks the one where %s", (_, stored, project, index) => {
    expect(closestAsset(candidates, project, stored)).toBe(candidates[index]);
  });

  it.each([
    [
      "the stored path ends with the longest of several candidates",
      ["sub-02/session1.mp4", "session1.mp4", "beh/session1.mp4", "lab/sub-02/session1.mp4"],
      "labels.slp",
      "/lab/sub-02/session1.mp4",
      "lab/sub-02/session1.mp4",
    ],
    [
      "it holds the project's folders, however deep it sits",
      ["other/session1.mp4", "lab/videos/session1.mp4"],
      "lab/labels.slp",
      "/elsewhere/session1.mp4",
      "lab/videos/session1.mp4",
    ],
    [
      "a saved project mirrors its source's subject folder",
      ["sub-01/session1.mp4", "sub-02/session1.mp4"],
      "derivatives/sleap/sub-02/beh/sub-02_desc-labels_pose.slp",
      "D:\\videos\\mouse2\\session1.mp4",
      "sub-02/session1.mp4",
    ],
    [
      "a saved project mirrors its source's subject and session folders",
      ["sub-01/ses-01/beh/session1.mp4", "sub-02/ses-01/beh/session1.mp4"],
      "derivatives/sleap/sub-02/ses-01/beh/sub-02_ses-01_desc-labels_pose.slp",
      "/lab/session1.mp4",
      "sub-02/ses-01/beh/session1.mp4",
    ],
    [
      "it names the project's subject, below other folders",
      ["rawdata/sub-01/session1.mp4", "rawdata/sub-02/session1.mp4"],
      "derivatives/sleap/sub-02/beh/sub-02_desc-labels_pose.slp",
      "/lab/session1.mp4",
      "rawdata/sub-02/session1.mp4",
    ],
    [
      "it names the project's session, even with fewer folders in common",
      ["sub-02/ses-01/session1.mp4", "videos/sub-02_ses-02/session1.mp4"],
      "sub-02/ses-02/labels.slp",
      "/lab/session1.mp4",
      "videos/sub-02_ses-02/session1.mp4",
    ],
    [
      "its session matches only within the project's subject",
      ["sub-01/ses-02/session1.mp4", "sub-02/ses-09/session1.mp4"],
      "derivatives/sleap/sub-02/ses-02/beh/sub-02_ses-02_desc-labels_pose.slp",
      "/lab/session1.mp4",
      "sub-02/ses-09/session1.mp4",
    ],
  ])("picks the one where %s", (_, paths, project, stored, expected) => {
    expect(
      closestAsset(
        paths.map((path) => ({ path })),
        project,
        stored,
      ).path,
    ).toBe(expected);
  });
});

describe("downloadUrl / resolveDownloadUrl", () => {
  const presigned = "https://bucket.test/blobs/abc?X-Amz-Signature=1";

  it("builds the stable download endpoint", () => {
    expect(downloadUrl(cfg(), "asset-1")).toBe(`${API}/assets/asset-1/download/`);
  });

  it("follows the redirect anonymously and drops the request once it has the address", async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return Promise.resolve({ ok: true, status: 200, url: presigned } as Response);
    });
    expect(await resolveDownloadUrl(cfg(), "asset-1", fetchMock)).toBe(presigned);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/assets/asset-1/download/`);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({});
    expect(signal?.aborted).toBe(true);
  });

  it("sends the token for an embargoed asset", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, url: presigned } as Response));
    await resolveDownloadUrl(cfg("tok"), "asset-1", fetchMock);
    expect(fetchMock.mock.calls[0]).toEqual([
      `${API}/assets/asset-1/download/`,
      expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
    ]);
  });

  it("throws an ApiError carrying the status on a refusal", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 403, url: "" } as Response));
    const error = await resolveDownloadUrl(cfg(), "asset-1", fetchMock).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
  });

  it("uses the global fetch by default", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, url: presigned } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveDownloadUrl(cfg(), "asset-1")).toBe(presigned);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
