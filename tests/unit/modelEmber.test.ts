import type { ArchiveConfig } from "@brain-bbqs/ember-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmberModelSource, emberModelLocation, MODELS_PREFIX } from "../../src/lib/modelEmber";

const API = "https://api.example/api";

function config(overrides: Partial<ArchiveConfig> = {}): ArchiveConfig {
  return { api: API, web: "https://web.example", accessToken: "tok", dandisetId: "000123", ...overrides };
}

/** A getConfig answering with the config, as the page's does once a dandiset is listed. */
function listed(overrides: Partial<ArchiveConfig> = {}): () => Promise<ArchiveConfig> {
  return () => Promise.resolve(config(overrides));
}

const LISTING = `${API}/dandisets/000123/versions/draft/assets/?path=${encodeURIComponent(MODELS_PREFIX)}&metadata=false&page_size=1000`;

type Route = (init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A fetch that answers from a URL-keyed table and refuses anything else. */
function router(routes: Record<string, Route>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const route = routes[url];
    return route ? Promise.resolve(route(init)) : Promise.reject(new Error(`unexpected fetch ${url}`));
  });
}

function asset(id: string, path: string) {
  return { asset_id: id, path };
}

const download = (assetId: string) => `${API}/assets/${assetId}/download/`;

/** A model folder's two assets, with ids `<key>c` and `<key>k`. */
function folderAssets(key: string, folder: string) {
  return [asset(`${key}c`, `${folder}/training_config.yaml`), asset(`${key}k`, `${folder}/best.ckpt`)];
}

/** What a card lists for the folder `folderAssets` made. */
function folderFiles(key: string, folder: string) {
  return [
    { role: "config", folder, url: download(`${key}c`) },
    { role: "checkpoint", folder, url: download(`${key}k`) },
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createEmberModelSource", () => {
  it("lists nothing while no dandiset is open", async () => {
    const fetch = router({});
    vi.stubGlobal("fetch", fetch);
    const source = createEmberModelSource({ getConfig: () => Promise.resolve(null), fetch });
    expect(source.name).toBe("EMBER");
    expect(await source.list({})).toEqual([]);
    expect(await createEmberModelSource({ getConfig: listed({ dandisetId: "" }), fetch }).list({})).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("turns each model folder into a card, reading its model_card.json", async () => {
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [
            asset("c1", `${MODELS_PREFIX}mouse/training_config.yaml`),
            asset("k1", `${MODELS_PREFIX}mouse/best.ckpt`),
            asset("m1", `${MODELS_PREFIX}mouse/model_card.json`),
            asset("x1", `${MODELS_PREFIX}mouse/viz/plot.png`),
            asset("x2", `${MODELS_PREFIX}mouse/notes.txt`),
            asset("x3", `${MODELS_PREFIX}mouse/runs/1/best.ckpt`),
          ],
          next: null,
        }),
      [`${API}/assets/m1/download/`]: () =>
        json({
          name: "Mouse (EMBER)",
          license: "CC-BY-4.0",
          species: "Mus musculus",
          heads: ["single_instance", "nonsense"],
          skeleton: { nodes: ["nose", "tail"], edges: [["nose", "tail"]] },
        }),
    });
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    const models = await createEmberModelSource({ getConfig: listed(), fetch }).list({}, signal);
    expect(models).toEqual([
      {
        id: "ember:000123/mouse",
        name: "Mouse (EMBER)",
        license: "CC-BY-4.0",
        species: "Mus musculus",
        heads: ["single_instance"],
        skeleton: { nodes: ["nose", "tail"], edges: [["nose", "tail"]] },
        files: [
          { role: "config", folder: "", url: `${API}/assets/c1/download/` },
          { role: "checkpoint", folder: "", url: `${API}/assets/k1/download/` },
        ],
        source: { kind: "ember", dandisetId: "000123", path: `${MODELS_PREFIX}mouse` },
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(`${API}/assets/m1/download/`, {
      headers: { Authorization: "Bearer tok" },
      signal,
    });
  });

  it("follows the listing's pages and skips models without a config and a checkpoint side by side", async () => {
    const page2 = `${API}/dandisets/000123/versions/draft/assets/?page=2`;
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [
            asset("c1", `${MODELS_PREFIX}a/training_config.yaml`),
            asset("k2", `${MODELS_PREFIX}b/best.ckpt`),
            asset("m2", `${MODELS_PREFIX}b/model_card.json`),
            asset("c4", `${MODELS_PREFIX}d/training_config.yaml`),
            asset("k4", `${MODELS_PREFIX}d/x/best.ckpt`),
          ],
          next: page2,
        }),
      [page2]: () =>
        json({
          results: [...folderAssets("3", `${MODELS_PREFIX}c`), asset("k1", `${MODELS_PREFIX}a/best.ckpt`)],
        }),
    });
    vi.stubGlobal("fetch", fetch);
    const models = await createEmberModelSource({ getConfig: listed(), fetch }).list({});
    expect(models.map((m) => [m.id, m.name, m.heads])).toEqual([
      ["ember:000123/a", "a", []],
      ["ember:000123/c", "c", []],
    ]);
    expect(fetch).not.toHaveBeenCalledWith(download("m2"), expect.anything());
  });

  it("stops at a page whose next link leaves the archive, and ignores paths outside the prefix", async () => {
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [
            asset("o1", "derivatives/sleap/other/training_config.yaml"),
            asset("o2", `${MODELS_PREFIX}training_config.yaml`),
            asset("o3", `${MODELS_PREFIX}best.ckpt`),
            ...folderAssets("1", `${MODELS_PREFIX}a`),
          ],
          next: "https://elsewhere.example/api/next",
        }),
    });
    vi.stubGlobal("fetch", fetch);
    const models = await createEmberModelSource({ getConfig: listed(), fetch }).list({});
    expect(models.map((m) => m.id)).toEqual(["ember:000123/a"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("gives up on a listing that never ends", async () => {
    const fetch = router({ [LISTING]: () => json({ results: [], next: LISTING }) });
    vi.stubGlobal("fetch", fetch);
    expect(await createEmberModelSource({ getConfig: listed(), fetch }).list({})).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(20);
  });

  it("tolerates an empty listing body", async () => {
    const fetch = router({ [LISTING]: () => new Response(null, { status: 204 }) });
    vi.stubGlobal("fetch", fetch);
    expect(await createEmberModelSource({ getConfig: listed(), fetch }).list({})).toEqual([]);
  });

  it.each([
    ["an HTTP error", () => json({}, 404)],
    ["a card that is not an object", () => json(["mouse"])],
    ["a card that is not JSON", () => new Response("not json")],
    ["a network failure", () => Promise.reject(new Error("offline"))],
  ])("falls back to the folder name on %s", async (_label, cardRoute: Route) => {
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [
            ...folderAssets("1", `${MODELS_PREFIX}mouse`),
            asset("m1", `${MODELS_PREFIX}mouse/model_card.json`),
          ],
        }),
      [`${API}/assets/m1/download/`]: cardRoute,
    });
    vi.stubGlobal("fetch", fetch);
    const models = await createEmberModelSource({ getConfig: listed(), fetch }).list({});
    expect(models).toEqual([
      {
        id: "ember:000123/mouse",
        name: "mouse",
        heads: [],
        files: folderFiles("1", ""),
        source: emberModelLocation("000123", "mouse"),
      },
    ]);
  });

  it("ignores empty or mistyped card fields", async () => {
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [
            ...folderAssets("1", `${MODELS_PREFIX}mouse`),
            asset("m1", `${MODELS_PREFIX}mouse/model_card.json`),
          ],
        }),
      [`${API}/assets/m1/download/`]: () =>
        json({ name: "", license: 3, species: "", heads: "centroid", skeleton: {} }),
    });
    vi.stubGlobal("fetch", fetch);
    const models = await createEmberModelSource({ getConfig: listed(), fetch }).list({});
    expect(models[0]).toEqual({
      id: "ember:000123/mouse",
      name: "mouse",
      heads: [],
      files: folderFiles("1", ""),
      source: emberModelLocation("000123", "mouse"),
    });
  });

  it("reads a public card anonymously when signed out, through the global fetch by default", async () => {
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [
            ...folderAssets("1", `${MODELS_PREFIX}mouse`),
            asset("m1", `${MODELS_PREFIX}mouse/model_card.json`),
          ],
        }),
      [`${API}/assets/m1/download/`]: () => json({ name: "Mouse" }),
    });
    vi.stubGlobal("fetch", fetch);
    const models = await createEmberModelSource({ getConfig: listed({ accessToken: "" }) }).list({});
    expect(models[0].name).toBe("Mouse");
    expect(fetch).toHaveBeenCalledWith(`${API}/assets/m1/download/`, { headers: {}, signal: undefined });
  });

  it("lists a top-down model kept as a subfolder per head, with its card beside them", async () => {
    const td = `${MODELS_PREFIX}mouse-td`;
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [
            asset("m1", `${td}/model_card.json`),
            ...folderAssets("1", `${td}/centroid`),
            ...folderAssets("2", `${td}/centered_instance`),
            asset("x1", `${td}/centroid/model_card.json`),
            asset("x2", `${td}/centroid/viz/best.ckpt`),
            asset("x3", `${td}/drafts/training_config.yaml`),
          ],
        }),
      [download("m1")]: () => json({ name: "Mouse top-down", heads: ["centroid", "centered_instance"] }),
    });
    vi.stubGlobal("fetch", fetch);
    const onProblems = vi.fn();
    const models = await createEmberModelSource({ getConfig: listed(), fetch, onProblems }).list({});
    expect(models).toEqual([
      {
        id: "ember:000123/mouse-td",
        name: "Mouse top-down",
        heads: ["centroid", "centered_instance"],
        files: [...folderFiles("1", "centroid"), ...folderFiles("2", "centered_instance")],
        source: { kind: "ember", dandisetId: "000123", path: td },
      },
    ]);
    expect(onProblems).not.toHaveBeenCalled();
  });

  it("lists a model folder holding several models that are not top-down as one card per folder", async () => {
    const m = `${MODELS_PREFIX}m`;
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [
            asset("m1", `${m}/model_card.json`),
            ...folderAssets("1", m),
            ...folderAssets("2", `${m}/run-2025-01`),
            asset("x1", `${m}/run-2025-02/best.ckpt`),
          ],
        }),
      [download("m1")]: () => json({ name: "Mouse", heads: ["bottomup"] }),
    });
    vi.stubGlobal("fetch", fetch);
    const onProblems = vi.fn();
    const models = await createEmberModelSource({ getConfig: listed(), fetch, onProblems }).list({});
    expect(models).toEqual([
      {
        id: "ember:000123/m",
        name: "Mouse",
        heads: ["bottomup"],
        files: folderFiles("1", ""),
        source: { kind: "ember", dandisetId: "000123", path: m },
      },
      {
        id: "ember:000123/m/run-2025-01",
        name: "Mouse (run-2025-01)",
        heads: ["bottomup"],
        files: folderFiles("2", "run-2025-01"),
        source: { kind: "ember", dandisetId: "000123", path: m },
      },
    ]);
    expect(onProblems).not.toHaveBeenCalled();
  });

  it("leaves out a model whose card declares top-down heads its folders do not hold, and says why", async () => {
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [
            asset("m1", `${MODELS_PREFIX}flat/model_card.json`),
            ...folderAssets("1", `${MODELS_PREFIX}flat`),
            asset("m2", `${MODELS_PREFIX}half/model_card.json`),
            ...folderAssets("2", `${MODELS_PREFIX}half/centroid`),
            ...folderAssets("3", `${MODELS_PREFIX}ok`),
          ],
        }),
      [download("m1")]: () => json({ heads: ["centroid", "centered_instance"] }),
      [download("m2")]: () => json({ heads: ["centered_instance", "centroid"] }),
    });
    vi.stubGlobal("fetch", fetch);
    const onProblems = vi.fn();
    const models = await createEmberModelSource({ getConfig: listed(), fetch, onProblems }).list({});
    expect(models.map((m) => m.id)).toEqual(["ember:000123/ok"]);
    const why = "a top-down model (centroid and centered_instance) needs two model folders, one per head, not 1.";
    expect(onProblems).toHaveBeenCalledWith([`Model "ember:000123/flat": ${why}`, `Model "ember:000123/half": ${why}`]);
  });

  it("warns on the console about models it left out by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [asset("m1", `${MODELS_PREFIX}m/model_card.json`), ...folderAssets("1", `${MODELS_PREFIX}m`)],
        }),
      [download("m1")]: () => json({ heads: ["centroid", "centered_instance"] }),
    });
    vi.stubGlobal("fetch", fetch);
    expect(await createEmberModelSource({ getConfig: listed(), fetch }).list({})).toEqual([]);
    expect(warn).toHaveBeenCalledWith("EMBER models left out:", [expect.stringContaining('Model "ember:000123/m"')]);
    warn.mockRestore();
  });

  it("asks for the config at every listing, so each one carries the token current then", async () => {
    const fetch = router({ [LISTING]: () => json({ results: [] }) });
    vi.stubGlobal("fetch", fetch);
    const getConfig = vi
      .fn<() => Promise<ArchiveConfig | null>>()
      .mockResolvedValueOnce(config({ accessToken: "first" }))
      .mockResolvedValueOnce(config({ accessToken: "" }));
    const source = createEmberModelSource({ getConfig, fetch });
    await source.list({});
    await source.list({});
    const sent = fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get("Authorization"));
    expect(sent).toEqual(["Bearer first", null]);
  });

  it("stops listing once aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("closed"));
    const fetch = router({});
    vi.stubGlobal("fetch", fetch);
    await expect(createEmberModelSource({ getConfig: listed(), fetch }).list({}, controller.signal)).rejects.toThrow(
      "closed",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
