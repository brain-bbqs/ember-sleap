import { describe, expect, it, vi } from "vitest";
import { createHuggingFaceSource, mapHubModel } from "../../src/lib/modelHuggingFace";

const HUB = "https://hub.example";

function hubModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "talmolab/mouse-topdown",
    sha: "abc123",
    tags: ["sleap-nn", "centroid", "centered_instance", "license:mit", "pytorch"],
    cardData: {
      license: "cc-by-4.0",
      species: "Mus musculus",
      skeleton: { nodes: ["nose", "tail"], edges: [["nose", "tail"]] },
    },
    siblings: [
      { rfilename: "README.md" },
      { rfilename: "centroid/training_config.yaml" },
      { rfilename: "centroid/best.ckpt" },
      { rfilename: "training_config.yaml" },
      { rfilename: "best.ckpt" },
      { rfilename: "my model/best.ckpt" },
    ],
    ...overrides,
  };
}

describe("mapHubModel", () => {
  it("maps a full listing entry to a card", () => {
    expect(mapHubModel(hubModel(), HUB)).toEqual({
      id: "hf:talmolab/mouse-topdown",
      name: "talmolab/mouse-topdown",
      license: "cc-by-4.0",
      species: "Mus musculus",
      heads: ["centroid", "centered_instance"],
      skeleton: { nodes: ["nose", "tail"], edges: [["nose", "tail"]] },
      files: [
        { role: "config", url: `${HUB}/talmolab/mouse-topdown/resolve/abc123/centroid/training_config.yaml` },
        { role: "checkpoint", url: `${HUB}/talmolab/mouse-topdown/resolve/abc123/centroid/best.ckpt` },
        { role: "config", url: `${HUB}/talmolab/mouse-topdown/resolve/abc123/training_config.yaml` },
        { role: "checkpoint", url: `${HUB}/talmolab/mouse-topdown/resolve/abc123/best.ckpt` },
        { role: "checkpoint", url: `${HUB}/talmolab/mouse-topdown/resolve/abc123/my%20model/best.ckpt` },
      ],
    });
  });

  it("falls back to modelId, the main revision, and the license tag, leaving out what is missing", () => {
    const card = mapHubModel(
      {
        modelId: "lab/fly",
        sha: "",
        tags: ["license:apache-2.0", 7, "bottomup"],
        cardData: { license: "", species: "", skeleton: { nodes: ["a"], edges: [["a", "b"]] } },
        siblings: [{ rfilename: "training_config.yaml" }],
      },
      HUB,
    );
    expect(card).toEqual({
      id: "hf:lab/fly",
      name: "lab/fly",
      license: "apache-2.0",
      heads: ["bottomup"],
      files: [{ role: "config", url: `${HUB}/lab/fly/resolve/main/training_config.yaml` }],
    });
  });

  it("tolerates missing tags, card data and siblings that are not file entries", () => {
    const card = mapHubModel(
      { id: "lab/bare", siblings: ["x", { rfilename: 3 }, { rfilename: "training_config.yaml" }] },
      HUB,
    );
    expect(card).toEqual({
      id: "hf:lab/bare",
      name: "lab/bare",
      heads: [],
      files: [{ role: "config", url: `${HUB}/lab/bare/resolve/main/training_config.yaml` }],
    });
  });

  it.each([
    ["not an object", "lab/model"],
    ["missing an id", { siblings: [{ rfilename: "training_config.yaml" }] }],
    ["an empty id", { id: "", siblings: [{ rfilename: "training_config.yaml" }] }],
    ["without a config", hubModel({ siblings: [{ rfilename: "best.ckpt" }] })],
    ["without siblings", hubModel({ siblings: undefined })],
  ])("returns null for an entry %s", (_label, model) => {
    expect(mapHubModel(model, HUB)).toBe(null);
  });
});

describe("createHuggingFaceSource", () => {
  function respond(status: number, body: unknown) {
    return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  }

  it("asks the Hub for models carrying the tag, with card data, and maps them", async () => {
    const fetch = respond(200, [hubModel(), hubModel({ id: "lab/no-config", siblings: [] })]);
    const signal = new AbortController().signal;
    const source = createHuggingFaceSource({ fetch, hubUrl: `${HUB}/`, tag: "sleap-nn", limit: 10 });
    expect(source.name).toBe("Hugging Face");
    const models = await source.list({ text: "  mouse " }, signal);
    expect(models.map((m) => m.id)).toEqual(["hf:talmolab/mouse-topdown"]);
    expect(fetch).toHaveBeenCalledWith(
      `${HUB}/api/models?filter=sleap-nn&full=true&cardData=true&limit=10&search=mouse`,
      { signal },
    );
  });

  it("leaves out the search when there is no text", async () => {
    const fetch = respond(200, []);
    await createHuggingFaceSource({ fetch }).list({ text: " " });
    expect(fetch.mock.calls[0][0]).toBe(
      "https://huggingface.co/api/models?filter=sleap-nn&full=true&cardData=true&limit=50",
    );
  });

  it("throws on an HTTP error", async () => {
    await expect(createHuggingFaceSource({ fetch: respond(503, {}) }).list({})).rejects.toThrow(
      "Hugging Face returned HTTP 503.",
    );
  });

  it("throws on a response that is not a list", async () => {
    await expect(createHuggingFaceSource({ fetch: respond(200, { error: "x" }) }).list({})).rejects.toThrow(
      "Hugging Face returned something other than a model list.",
    );
  });

  it("uses the global fetch by default", async () => {
    const fetch = respond(200, []);
    vi.stubGlobal("fetch", fetch);
    try {
      expect(await createHuggingFaceSource().list({})).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
