import { describe, expect, it, vi } from "vitest";
import { createIndexSource, MODEL_INDEX_SCHEMA, MODEL_INDEX_URL, parseModelIndex } from "../../src/lib/modelIndex";

const SHA = "a".repeat(64);

function hfEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "mouse-topdown",
    name: "Mouse top-down",
    version: "1.0.0",
    license: "CC-BY-4.0",
    species: "Mus musculus",
    heads: ["centroid", "centered_instance"],
    skeleton: { nodes: ["nose", "tail"], edges: [["nose", "tail"]] },
    source: { huggingface: { repo: "talmolab/mouse", revision: "v1" } },
    files: [
      { role: "config", path: "centroid/training_config.yaml", sha256: SHA },
      { role: "checkpoint", path: "centroid/best.ckpt" },
    ],
    ...overrides,
  };
}

function index(models: unknown[]): unknown {
  return { schema: MODEL_INDEX_SCHEMA, models };
}

describe("MODEL_INDEX_URL", () => {
  it("stays unset until the index dandiset exists", () => {
    expect(MODEL_INDEX_URL).toBe(null);
  });
});

describe("parseModelIndex", () => {
  it("resolves a Hugging Face entry to a card", () => {
    const { models, problems } = parseModelIndex(index([hfEntry()]));
    expect(problems).toEqual([]);
    expect(models).toEqual([
      {
        id: "index:mouse-topdown",
        name: "Mouse top-down (1.0.0)",
        license: "CC-BY-4.0",
        species: "Mus musculus",
        heads: ["centroid", "centered_instance"],
        skeleton: { nodes: ["nose", "tail"], edges: [["nose", "tail"]] },
        files: [
          {
            role: "config",
            url: "https://huggingface.co/talmolab/mouse/resolve/v1/centroid/training_config.yaml",
            sha256: SHA,
          },
          { role: "checkpoint", url: "https://huggingface.co/talmolab/mouse/resolve/v1/centroid/best.ckpt" },
        ],
      },
    ]);
  });

  it("encodes the revision and path segments of a Hugging Face URL", () => {
    const entry = hfEntry({
      source: { huggingface: { repo: "lab/m", revision: "refs/pr/1" } },
      files: [{ role: "config", path: "my model/training config.yaml" }],
    });
    const { models } = parseModelIndex(index([entry]));
    expect(models[0].files[0].url).toBe(
      "https://huggingface.co/lab/m/resolve/refs%2Fpr%2F1/my%20model/training%20config.yaml",
    );
  });

  it("keeps an EMBER entry's files as ember:// references, without the optional fields", () => {
    const entry = hfEntry({
      species: undefined,
      skeleton: undefined,
      source: { ember: { dandiset: "000123", path: "derivatives/sleap/models/fly/" } },
      files: [{ role: "config", path: "training_config.yaml" }],
    });
    const { models, problems } = parseModelIndex(index([entry]));
    expect(problems).toEqual([]);
    expect(models[0]).toEqual({
      id: "index:mouse-topdown",
      name: "Mouse top-down (1.0.0)",
      license: "CC-BY-4.0",
      heads: ["centroid", "centered_instance"],
      files: [{ role: "config", url: "ember://000123/derivatives/sleap/models/fly/training_config.yaml" }],
    });
  });

  it.each([
    ["not an object", "models"],
    ["null", null],
    ["the wrong schema", { schema: "ember-sleap.models/v2", models: [] }],
    ["no models array", { schema: MODEL_INDEX_SCHEMA, models: {} }],
  ])("throws when the document is %s", (_label, json) => {
    expect(() => parseModelIndex(json)).toThrow(/Not a model index/);
  });

  it.each([
    ["a non-object entry", "x", "Entry #0: id must be a non-empty string."],
    ["a missing id", hfEntry({ id: "" }), "Entry #0: id must be a non-empty string."],
    ["a missing name", hfEntry({ name: " " }), 'Entry "mouse-topdown": name must be a non-empty string.'],
    ["a missing version", hfEntry({ version: 1 }), 'Entry "mouse-topdown": version must be a non-empty string.'],
    [
      "a missing license",
      hfEntry({ license: undefined }),
      'Entry "mouse-topdown": license must be a non-empty string.',
    ],
    [
      "an empty species",
      hfEntry({ species: "" }),
      'Entry "mouse-topdown": species must be a non-empty string when given.',
    ],
    ["no heads", hfEntry({ heads: [] }), "heads must be a non-empty array"],
    ["heads that are not an array", hfEntry({ heads: "centroid" }), "heads must be a non-empty array"],
    ["an unknown head", hfEntry({ heads: ["topdown"] }), "heads must be a non-empty array"],
    [
      "a bad skeleton",
      hfEntry({ skeleton: { nodes: ["a"], edges: [["a", "b"]] } }),
      "skeleton must be { nodes, edges }",
    ],
    ["a non-object source", hfEntry({ source: "hf" }), "source must be an object."],
    ["a source naming both", hfEntry({ source: { huggingface: {}, ember: {} } }), "source must name exactly one"],
    ["an unknown source", hfEntry({ source: { s3: {} } }), "source must name exactly one"],
    [
      "a malformed repo",
      hfEntry({ source: { huggingface: { repo: "mouse", revision: "v1" } } }),
      'look like "owner/name"',
    ],
    ["a missing repo", hfEntry({ source: { huggingface: { revision: "v1" } } }), 'look like "owner/name"'],
    ["a missing revision", hfEntry({ source: { huggingface: { repo: "a/b", revision: "" } } }), "revision must be"],
    ["a bad dandiset", hfEntry({ source: { ember: { dandiset: "123", path: "m" } } }), "six-digit id"],
    ["a missing dandiset", hfEntry({ source: { ember: { path: "m" } } }), "six-digit id"],
    ["an empty EMBER path", hfEntry({ source: { ember: { dandiset: "000123", path: "/" } } }), "relative folder path"],
    ["a missing EMBER path", hfEntry({ source: { ember: { dandiset: "000123" } } }), "relative folder path"],
    [
      "an EMBER path that climbs",
      hfEntry({ source: { ember: { dandiset: "000123", path: "a/../b" } } }),
      "relative folder path",
    ],
    ["no files", hfEntry({ files: [] }), "files must be a non-empty array"],
    ["files that are not an array", hfEntry({ files: "x" }), "files must be a non-empty array"],
    ["a non-object file", hfEntry({ files: ["x"] }), "every file must be an object"],
    ["an unknown role", hfEntry({ files: [{ role: "weights", path: "a" }] }), "file role must be"],
    ["an absolute path", hfEntry({ files: [{ role: "config", path: "/a" }] }), "file path must be a relative path"],
    ["a dot segment", hfEntry({ files: [{ role: "config", path: "./a" }] }), "file path must be a relative path"],
    ["a missing path", hfEntry({ files: [{ role: "config" }] }), "file path must be a relative path"],
    ["a bad sha256", hfEntry({ files: [{ role: "config", path: "a", sha256: "ABC" }] }), "sha256 must be"],
    ["a non-string sha256", hfEntry({ files: [{ role: "config", path: "a", sha256: 5 }] }), "sha256 must be"],
    ["no config", hfEntry({ files: [{ role: "checkpoint", path: "best.ckpt" }] }), "files must include a config"],
  ])("leaves out an entry with %s and says why", (_label, entry, problem) => {
    const { models, problems } = parseModelIndex(index([entry, hfEntry({ id: "good" })]));
    expect(models.map((m) => m.id)).toEqual(["index:good"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(problem);
  });

  it("keeps the first of two entries sharing an id", () => {
    const { models, problems } = parseModelIndex(index([hfEntry(), hfEntry({ name: "Other" })]));
    expect(models.map((m) => m.name)).toEqual(["Mouse top-down (1.0.0)"]);
    expect(problems).toEqual(['Entry "mouse-topdown": duplicate id.']);
  });

  it("does not let a rejected entry claim its id", () => {
    const { models } = parseModelIndex(index([hfEntry({ heads: [] }), hfEntry()]));
    expect(models.map((m) => m.id)).toEqual(["index:mouse-topdown"]);
  });
});

describe("createIndexSource", () => {
  const url = "https://ember.example/models.json";

  function respond(status: number, body: unknown) {
    return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  }

  it("fetches the index with the caller's signal and returns its cards", async () => {
    const fetch = respond(200, index([hfEntry()]));
    const signal = new AbortController().signal;
    const source = createIndexSource({ url, fetch });
    expect(source.name).toBe("Model index");
    const models = await source.list({ text: "ignored here" }, signal);
    expect(models.map((m) => m.id)).toEqual(["index:mouse-topdown"]);
    expect(fetch).toHaveBeenCalledWith(url, { signal });
  });

  it("reports entries it left out", async () => {
    const onProblems = vi.fn();
    const source = createIndexSource({ url, fetch: respond(200, index([hfEntry({ heads: [] })])), onProblems });
    expect(await source.list({})).toEqual([]);
    expect(onProblems).toHaveBeenCalledWith([expect.stringContaining("heads must be")]);
  });

  it("warns on the console by default, and stays quiet when nothing was left out", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await createIndexSource({ url, fetch: respond(200, index([hfEntry()])) }).list({});
    expect(warn).not.toHaveBeenCalled();
    await createIndexSource({ url, fetch: respond(200, index(["x"])) }).list({});
    expect(warn).toHaveBeenCalledWith("Model index entries left out:", ["Entry #0: id must be a non-empty string."]);
    warn.mockRestore();
  });

  it("throws on an HTTP error", async () => {
    await expect(createIndexSource({ url, fetch: respond(404, {}) }).list({})).rejects.toThrow(
      "The model index returned HTTP 404.",
    );
  });

  it("uses the global fetch by default", async () => {
    const fetch = respond(200, index([]));
    vi.stubGlobal("fetch", fetch);
    try {
      expect(await createIndexSource({ url }).list({})).toEqual([]);
      expect(fetch).toHaveBeenCalledWith(url, { signal: undefined });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
