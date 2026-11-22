import { describe, expect, it, vi } from "vitest";
import { listModels } from "../../src/lib/modelCatalogue";
import { createHuggingFaceSource, mapHubModel, nextPageUrl } from "../../src/lib/modelHuggingFace";

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
      { rfilename: "centered_instance/training_config.yaml" },
      { rfilename: "centered_instance/best.ckpt" },
      { rfilename: "drafts/training_config.yaml" },
      { rfilename: "my model/best.ckpt" },
      { rfilename: "centroid/last.ckpt" },
    ],
    ...overrides,
  };
}

/** A model folder's two files on the Hub, as rfilenames. */
const folderSiblings = (prefix: string) => [
  { rfilename: `${prefix}training_config.yaml` },
  { rfilename: `${prefix}best.ckpt` },
];

describe("mapHubModel", () => {
  it("maps a top-down listing entry to a card holding both model folders, leaving incomplete ones out", () => {
    const base = `${HUB}/talmolab/mouse-topdown/resolve/abc123`;
    expect(mapHubModel(hubModel(), HUB)).toEqual([
      {
        id: "hf:talmolab/mouse-topdown",
        name: "talmolab/mouse-topdown",
        license: "cc-by-4.0",
        species: "Mus musculus",
        heads: ["centroid", "centered_instance"],
        skeleton: { nodes: ["nose", "tail"], edges: [["nose", "tail"]] },
        files: [
          { role: "config", folder: "centroid", url: `${base}/centroid/training_config.yaml` },
          { role: "checkpoint", folder: "centroid", url: `${base}/centroid/best.ckpt` },
          { role: "config", folder: "centered_instance", url: `${base}/centered_instance/training_config.yaml` },
          { role: "checkpoint", folder: "centered_instance", url: `${base}/centered_instance/best.ckpt` },
        ],
        source: { kind: "huggingface", repo: "talmolab/mouse-topdown", revision: "abc123" },
      },
    ]);
  });

  it("falls back to modelId, the main revision, and the license tag, leaving out what is missing", () => {
    const card = mapHubModel(
      {
        modelId: "lab/fly",
        sha: "",
        tags: ["license:apache-2.0", 7, "bottomup"],
        cardData: { license: "", species: "", skeleton: { nodes: ["a"], edges: [["a", "b"]] } },
        siblings: [...folderSiblings(""), { rfilename: "my model/best.ckpt" }],
      },
      HUB,
    );
    expect(card).toEqual([
      {
        id: "hf:lab/fly",
        name: "lab/fly",
        license: "apache-2.0",
        heads: ["bottomup"],
        files: [
          { role: "config", folder: "", url: `${HUB}/lab/fly/resolve/main/training_config.yaml` },
          { role: "checkpoint", folder: "", url: `${HUB}/lab/fly/resolve/main/best.ckpt` },
        ],
        source: { kind: "huggingface", repo: "lab/fly", revision: "main" },
      },
    ]);
  });

  it("tolerates missing tags, card data and siblings that are not file entries", () => {
    const card = mapHubModel({ id: "lab/bare", siblings: ["x", { rfilename: 3 }, ...folderSiblings("m/")] }, HUB);
    expect(card).toEqual([
      {
        id: "hf:lab/bare",
        name: "lab/bare",
        heads: [],
        files: [
          { role: "config", folder: "m", url: `${HUB}/lab/bare/resolve/main/m/training_config.yaml` },
          { role: "checkpoint", folder: "m", url: `${HUB}/lab/bare/resolve/main/m/best.ckpt` },
        ],
        source: { kind: "huggingface", repo: "lab/bare", revision: "main" },
      },
    ]);
  });

  it.each([
    ["single-head models", ["sleap-nn", "single_instance"]],
    ["models of unknown heads", ["sleap-nn"]],
  ])("lists a repository holding several %s as one card per folder, named after it", (_label, tags) => {
    const siblings = [...folderSiblings("fly/"), ...folderSiblings(""), ...folderSiblings("old/mouse/")];
    const cards = mapHubModel(hubModel({ id: "lab/zoo", tags, siblings }), HUB);
    const base = `${HUB}/lab/zoo/resolve/abc123`;
    expect(cards.map((card) => typeof card === "object" && [card.id, card.name, card.files])).toEqual([
      [
        "hf:lab/zoo/fly",
        "lab/zoo/fly",
        [
          { role: "config", folder: "fly", url: `${base}/fly/training_config.yaml` },
          { role: "checkpoint", folder: "fly", url: `${base}/fly/best.ckpt` },
        ],
      ],
      ["hf:lab/zoo", "lab/zoo", expect.arrayContaining([expect.objectContaining({ folder: "" })])],
      [
        "hf:lab/zoo/old/mouse",
        "lab/zoo/old/mouse",
        expect.arrayContaining([expect.objectContaining({ folder: "old/mouse" })]),
      ],
    ]);
  });

  it("lists an untagged repository whose two folders are named after top-down's heads as one card", () => {
    const siblings = [...folderSiblings("centroid/"), ...folderSiblings("centered_instance/")];
    const cards = mapHubModel(hubModel({ tags: ["sleap-nn"], siblings }), HUB);
    expect(cards.map((card) => typeof card === "object" && [card.id, card.heads, card.files.length])).toEqual([
      ["hf:talmolab/mouse-topdown", [], 4],
    ]);
  });

  it.each([
    ["not an object", "lab/model"],
    ["missing an id", { siblings: folderSiblings("") }],
    ["an empty id", { id: "", siblings: folderSiblings("") }],
    ["without a config", hubModel({ siblings: [{ rfilename: "best.ckpt" }] })],
    ["without a checkpoint", hubModel({ siblings: [{ rfilename: "training_config.yaml" }] })],
    [
      "whose files sit in different folders",
      hubModel({ siblings: [{ rfilename: "a/best.ckpt" }, ...folderSiblings("b/").slice(0, 1)] }),
    ],
    ["without siblings", hubModel({ siblings: undefined })],
  ])("lists nothing for an entry %s", (_label, model) => {
    expect(mapHubModel(model, HUB)).toEqual([]);
  });

  it("says why a top-down model without a folder per head is left out", () => {
    const model = hubModel({ siblings: folderSiblings("centroid/") });
    expect(mapHubModel(model, HUB)).toEqual([
      'Model "hf:talmolab/mouse-topdown": a top-down model (centroid and centered_instance) needs two model folders, one per head, not 1.',
    ]);
  });
});

describe("nextPageUrl", () => {
  it.each([
    ["no header", null, null],
    ["no next link", '<https://hub.example/api/models?cursor=a>; rel="prev"', null],
    [
      "a next link among others",
      '<https://hub.example/api/models?cursor=a>; rel="prev", <https://hub.example/api/models?cursor=b>; rel="next"',
      "https://hub.example/api/models?cursor=b",
    ],
    ["an unquoted rel with more parameters", "</api/models?cursor=c>; rel=next; title=x", `${HUB}/api/models?cursor=c`],
    ["a rel that only starts with next", '<https://hub.example/x>; rel="nextish"', null],
    ["a next link to another host", '<https://evil.example/api/models?cursor=d>; rel="next"', null],
    ["a next link that is not a URL", '<https://[>; rel="next"', null],
  ])("reads %s", (_label, header, expected) => {
    expect(nextPageUrl(header, HUB)).toBe(expected);
  });
});

describe("createHuggingFaceSource", () => {
  function respond(status: number, body: unknown) {
    return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  }

  /** One Hub page per call, each linking to the next until the last. */
  function pages(...listings: unknown[][]) {
    return vi.fn<typeof fetch>((input) => {
      const cursor = Number(new URL(String(input)).searchParams.get("cursor") ?? 0);
      const more = cursor + 1 < listings.length;
      const headers = more ? { Link: `<${HUB}/api/models?cursor=${cursor + 1}>; rel="next"` } : undefined;
      return Promise.resolve(new Response(JSON.stringify(listings[cursor]), { status: 200, headers }));
    });
  }

  it("asks the Hub for every model carrying the tag, with card data, and maps them, whatever the text", async () => {
    const fetch = respond(200, [hubModel(), hubModel({ id: "lab/no-config", siblings: [] })]);
    const onProblems = vi.fn();
    const signal = new AbortController().signal;
    const source = createHuggingFaceSource({ fetch, hubUrl: `${HUB}/`, tag: "sleap-nn", limit: 10, onProblems });
    expect(source.name).toBe("Hugging Face");
    const models = await source.list({ text: "  musculus " }, signal);
    expect(models.map((m) => m.id)).toEqual(["hf:talmolab/mouse-topdown"]);
    expect(onProblems).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${HUB}/api/models?filter=sleap-nn&full=true&cardData=true&limit=10`, {
      signal,
    });
  });

  it("reports the models it left out across pages, once per listing", async () => {
    const lopsided = (id: string) => hubModel({ id, siblings: folderSiblings("centroid/") });
    const fetch = pages([lopsided("lab/a"), hubModel({ id: "lab/b" })], [lopsided("lab/c")]);
    const onProblems = vi.fn();
    const models = await createHuggingFaceSource({ fetch, hubUrl: HUB, onProblems }).list({});
    expect(models.map((m) => m.id)).toEqual(["hf:lab/b"]);
    expect(onProblems).toHaveBeenCalledTimes(1);
    expect(onProblems).toHaveBeenCalledWith([
      expect.stringMatching(/^Model "hf:lab\/a": a top-down model/),
      expect.stringMatching(/^Model "hf:lab\/c": a top-down model/),
    ]);
  });

  it("warns on the console about models it left out by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = respond(200, [hubModel({ siblings: folderSiblings("") })]);
    expect(await createHuggingFaceSource({ fetch, hubUrl: HUB }).list({})).toEqual([]);
    expect(warn).toHaveBeenCalledWith("Hugging Face models left out:", [
      expect.stringContaining('Model "hf:talmolab/mouse-topdown"'),
    ]);
    warn.mockRestore();
  });

  it("lets the picker's text find a model by the species on its card, not only by its id", async () => {
    const fetch = respond(200, [hubModel({ id: "talmolab/topdown-v1" }), hubModel({ id: "lab/fly", cardData: {} })]);
    const models = await listModels([createHuggingFaceSource({ fetch, hubUrl: HUB })], { text: "Mus musculus" });
    expect(models.map((m) => m.id)).toEqual(["hf:talmolab/topdown-v1"]);
  });

  it("follows the Hub's next links, so tagged models past the first page are listed", async () => {
    const fetch = pages([hubModel({ id: "lab/a" })], [hubModel({ id: "lab/b" })], [hubModel({ id: "lab/c" })]);
    const models = await createHuggingFaceSource({ fetch, hubUrl: HUB }).list({});
    expect(models.map((m) => m.id)).toEqual(["hf:lab/a", "hf:lab/b", "hf:lab/c"]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${HUB}/api/models?filter=sleap-nn&full=true&cardData=true&limit=50`,
      `${HUB}/api/models?cursor=1`,
      `${HUB}/api/models?cursor=2`,
    ]);
  });

  it.each([
    [2, 2],
    [undefined, 4],
  ])("stops after maxPages (%s), however many the Hub offers", async (maxPages, fetched) => {
    const fetch = pages(...[0, 1, 2, 3, 4, 5].map((i) => [hubModel({ id: `lab/m${i}` })]));
    const models = await createHuggingFaceSource({ fetch, hubUrl: HUB, maxPages }).list({});
    expect(models.length).toBe(fetched);
    expect(fetch).toHaveBeenCalledTimes(fetched);
  });

  it.each([
    ["an HTTP error", () => new Response("down", { status: 502 })],
    ["something other than a list", () => Response.json({ error: "x" })],
  ])("keeps the pages it read when a later one answers with %s", async (_, later) => {
    const first = pages([hubModel({ id: "lab/a" })], []);
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) =>
      String(input).includes("cursor=1") ? Promise.resolve(later()) : first(input, init),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const models = await createHuggingFaceSource({ fetch, hubUrl: HUB }).list({});
    expect(models.map((m) => m.id)).toEqual(["hf:lab/a"]);
    expect(warn).toHaveBeenCalledWith("Hugging Face stopped listing after page 1:", expect.any(Error));
    warn.mockRestore();
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
