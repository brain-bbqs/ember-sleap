import type { ArchiveConfig } from "@brain-bbqs/ember-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmberModelSource, MODELS_PREFIX } from "../../src/lib/modelEmber";

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
          { role: "config", url: `${API}/assets/c1/download/` },
          { role: "checkpoint", url: `${API}/assets/k1/download/` },
        ],
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(`${API}/assets/m1/download/`, {
      headers: { Authorization: "Bearer tok" },
      signal,
    });
  });

  it("follows the listing's pages and skips folders without a config", async () => {
    const page2 = `${API}/dandisets/000123/versions/draft/assets/?page=2`;
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [asset("c1", `${MODELS_PREFIX}a/training_config.yaml`), asset("k2", `${MODELS_PREFIX}b/best.ckpt`)],
          next: page2,
        }),
      [page2]: () => json({ results: [asset("c3", `${MODELS_PREFIX}c/training_config.yaml`)] }),
    });
    vi.stubGlobal("fetch", fetch);
    const models = await createEmberModelSource({ getConfig: listed(), fetch }).list({});
    expect(models.map((m) => [m.id, m.name, m.heads])).toEqual([
      ["ember:000123/a", "a", []],
      ["ember:000123/c", "c", []],
    ]);
  });

  it("stops at a page whose next link leaves the archive, and ignores paths outside the prefix", async () => {
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [
            asset("o1", "derivatives/sleap/other/training_config.yaml"),
            asset("o2", `${MODELS_PREFIX}training_config.yaml`),
            asset("c1", `${MODELS_PREFIX}a/training_config.yaml`),
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
            asset("c1", `${MODELS_PREFIX}mouse/training_config.yaml`),
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
        files: [{ role: "config", url: `${API}/assets/c1/download/` }],
      },
    ]);
  });

  it("ignores empty or mistyped card fields", async () => {
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [
            asset("c1", `${MODELS_PREFIX}mouse/training_config.yaml`),
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
      files: [{ role: "config", url: `${API}/assets/c1/download/` }],
    });
  });

  it("reads a public card anonymously when signed out, through the global fetch by default", async () => {
    const fetch = router({
      [LISTING]: () =>
        json({
          results: [
            asset("c1", `${MODELS_PREFIX}mouse/training_config.yaml`),
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
