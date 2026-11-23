import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeSource,
  filesByFolder,
  folderOf,
  isModelHead,
  listModels,
  matchesText,
  modelFileRole,
  modelFilesProblem,
  modelsInFolders,
  parseSkeleton,
  skeletonFit,
  type HostModelCard,
  type ModelCardSource,
  type ModelLocation,
  type ModelSource,
} from "../../src/lib/modelCatalogue";
import type { ModelFile } from "../../src/lib/sleapContract";

function card(id: string, extra: Partial<HostModelCard> = {}): HostModelCard {
  return { id, name: id, heads: ["centroid"], files: folder("", id), ...extra };
}

/** A complete model folder: one config and one checkpoint. */
function folder(name: string, id = "m"): ModelFile[] {
  return [
    { role: "config", folder: name, url: `https://x/${id}/${name}/training_config.yaml` },
    { role: "checkpoint", folder: name, url: `https://x/${id}/${name}/best.ckpt` },
  ];
}

const config = (name: string): ModelFile => folder(name)[0];
const checkpoint = (name: string): ModelFile => folder(name)[1];

function source(name: string, cards: HostModelCard[] | Error): ModelSource {
  return {
    name,
    list: vi.fn(() => (cards instanceof Error ? Promise.reject(cards) : Promise.resolve(cards))),
  };
}

const MOUSE = { nodes: ["nose", "tail"], edges: [["nose", "tail"]] as [string, string][] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isModelHead", () => {
  it.each([
    ["centroid", true],
    ["centered_instance", true],
    ["bottomup", true],
    ["single_instance", true],
    ["topdown", false],
    [3, false],
  ])("%s -> %s", (value, expected) => {
    expect(isModelHead(value)).toBe(expected);
  });
});

describe("parseSkeleton", () => {
  it("returns a copy of a valid skeleton", () => {
    const parsed = parseSkeleton(MOUSE);
    expect(parsed).toEqual(MOUSE);
    expect(parsed?.nodes).not.toBe(MOUSE.nodes);
  });

  it.each([
    ["not an object", "skeleton"],
    ["an array", []],
    ["null", null],
    ["nodes missing", { edges: [] }],
    ["a non-string node", { nodes: ["a", 1], edges: [] }],
    ["edges missing", { nodes: ["a"] }],
    ["an edge that is not a pair", { nodes: ["a", "b"], edges: [["a"]] }],
    ["an edge that is not an array", { nodes: ["a", "b"], edges: ["a-b"] }],
    ["a non-string edge end", { nodes: ["a", "b"], edges: [["a", 2]] }],
    ["a non-string edge start", { nodes: ["a", "b"], edges: [[1, "b"]] }],
    ["an edge to an unlisted node", { nodes: ["a", "b"], edges: [["a", "c"]] }],
    ["an edge from an unlisted node", { nodes: ["a", "b"], edges: [["c", "a"]] }],
  ])("rejects %s", (_label, value) => {
    expect(parseSkeleton(value)).toBe(undefined);
  });
});

describe("modelFileRole", () => {
  it.each([
    ["training_config.yaml", "config"],
    ["best.ckpt", "checkpoint"],
    ["model_card.json", undefined],
    ["last.ckpt", undefined],
    ["centroid/best.ckpt", undefined],
  ])("%s -> %s", (name, expected) => {
    expect(modelFileRole(name)).toBe(expected);
  });
});

describe("folderOf", () => {
  it.each([
    ["training_config.yaml", ""],
    ["centroid/best.ckpt", "centroid"],
    ["models/centered_instance/best.ckpt", "models/centered_instance"],
  ])("%s -> %j", (path, expected) => {
    expect(folderOf(path)).toBe(expected);
  });
});

describe("filesByFolder", () => {
  it("groups files by folder, in the order each folder is first named", () => {
    const files = [config("b"), config("a"), checkpoint("b")];
    expect([...filesByFolder(files)]).toEqual([
      ["b", [config("b"), checkpoint("b")]],
      ["a", [config("a")]],
    ]);
  });
});

describe("modelsInFolders", () => {
  const files = [
    config("centroid"),
    config("lonely"),
    config("twice"),
    checkpoint("centered_instance"),
    config("twice"),
    checkpoint("centroid"),
    config("centered_instance"),
    checkpoint("twice"),
  ];
  const centroid = folder("centroid");
  const centered = [checkpoint("centered_instance"), config("centered_instance")];

  it("keeps a top-down model's two complete folders together, leaving incomplete ones out", () => {
    expect(modelsInFolders(["centroid", "centered_instance"], files)).toEqual([[...centroid, ...centered]]);
  });

  it("makes one model of each complete folder of a model that is not top-down", () => {
    expect(modelsInFolders(["single_instance"], files)).toEqual([centroid, centered]);
  });

  it.each([
    ["named after the heads", "centroid", "centered_instance", 1],
    ["named as SLEAP names its runs", "m/250101.centroid.n=80", "m/250101.centered_instance.n=80", 1],
    ["named after one head only", "centroid", "other", 2],
    ["named after the same head", "a.centroid", "b.centroid", 2],
  ])("with no heads declared, pairs two folders %s", (_label, a, b, models) => {
    expect(modelsInFolders([], [...folder(a), ...folder(b)])).toHaveLength(models);
  });

  it("splits three folders of unknown heads, even when two of them are named after top-down's heads", () => {
    const three = [...folder("centroid"), ...folder("centered_instance"), ...folder("old")];
    expect(modelsInFolders([], three)).toHaveLength(3);
  });

  it("finds no model without a complete folder", () => {
    expect(modelsInFolders(["centroid"], [config("a"), checkpoint("b")])).toEqual([]);
  });
});

describe("modelFilesProblem", () => {
  it.each([
    ["a single folder", ["single_instance"], folder(""), null],
    ["a top-down model's two folders", ["centroid", "centered_instance"], [...folder("c"), ...folder("ci")], null],
    ["a centroid model alone", ["centroid"], folder(""), null],
    ["no files", ["single_instance"], [], "a model needs at least one model folder"],
    [
      "a top-level folder without its checkpoint",
      ["single_instance"],
      [config("")],
      "the top-level model folder must hold exactly one config and one checkpoint",
    ],
    [
      "a folder with two checkpoints",
      [],
      [...folder("centroid"), checkpoint("centroid")],
      'model folder "centroid" must hold exactly one config and one checkpoint',
    ],
    [
      "a top-down model in one folder",
      ["centroid", "centered_instance"],
      folder(""),
      "a top-down model (centroid and centered_instance) needs two model folders, one per head, not 1",
    ],
    [
      "a top-down model in three folders",
      ["centered_instance", "centroid"],
      [...folder("a"), ...folder("b"), ...folder("c")],
      "a top-down model (centroid and centered_instance) needs two model folders, one per head, not 3",
    ],
    [
      "a single-head model in two folders",
      ["single_instance"],
      [...folder("fly"), ...folder("mouse")],
      "a model that is not top-down needs one model folder, not 2",
    ],
    [
      "unknown heads in two folders not named after top-down's heads",
      [],
      [...folder("fly"), ...folder("mouse")],
      "a model that is not top-down needs one model folder, not 2",
    ],
    ["unknown heads in top-down's two folders", [], [...folder("centroid"), ...folder("centered_instance")], null],
    [
      "two incomplete folders",
      ["centroid", "centered_instance"],
      [config("centroid"), checkpoint("centered_instance")],
      'model folder "centroid" and model folder "centered_instance" must each hold exactly one config and one checkpoint',
    ],
  ] as const)("%s -> %j", (_label, heads, files, expected) => {
    expect(modelFilesProblem(heads, files)).toBe(expected);
  });
});

describe("matchesText", () => {
  const mouse = card("hf:lab/mouse-top", { name: "Mouse top-down", species: "Mus musculus" });

  it.each([
    ["", true],
    ["   ", true],
    ["LAB/MOUSE", true],
    ["top-down", true],
    ["musculus", true],
    ["zebrafish", false],
  ])("%j -> %s", (text, expected) => {
    expect(matchesText(mouse, text)).toBe(expected);
  });

  it("does not match on a species the card lacks", () => {
    expect(matchesText(card("a"), "musculus")).toBe(false);
  });

  it.each([
    [{ kind: "huggingface", repo: "talmolab/mice", revision: "abc" }, true],
    [{ kind: "index", target: { kind: "huggingface", repo: "talmolab/mice", revision: "v1" } }, true],
    [{ kind: "index", target: { kind: "ember", dandisetId: "000123", path: "talmolab/mice" } }, false],
    [{ kind: "ember", dandisetId: "000123", path: "talmolab/mice" }, false],
  ] as const)("matches the Hugging Face repository a card is kept in: %j -> %s", (source, expected) => {
    expect(matchesText(card("index:mouse", { source }), "TALMOLAB/MICE")).toBe(expected);
  });
});

describe("describeSource", () => {
  it.each([
    [{ kind: "huggingface", repo: "lab/mouse", revision: "abc" }, "from Hugging Face lab/mouse"],
    [{ kind: "ember", dandisetId: "000123", path: "derivatives/sleap/models/m" }, "from EMBER dandiset 000123"],
    [
      { kind: "index", target: { kind: "ember", dandisetId: "000123", path: "derivatives/sleap/models/m" } },
      "from the model index (EMBER dandiset 000123)",
    ],
  ] as const)("%j -> %s", (source, expected) => {
    expect(describeSource(source)).toBe(expected);
  });
});

describe("skeletonFit", () => {
  it.each([
    [["tail", "nose"], "match"],
    [["nose", "tail", "nose"], "match"],
    [["nose"], "mismatch"],
    [["nose", "ear"], "mismatch"],
  ])("%j -> %s", (nodes, expected) => {
    expect(skeletonFit(card("a", { skeleton: MOUSE }), nodes)).toBe(expected);
  });

  it("is unknown for a card without a skeleton", () => {
    expect(skeletonFit(card("a"), ["nose"])).toBe("unknown");
  });
});

describe("listModels", () => {
  it("merges sources in order, the first source keeping a shared id", async () => {
    const index = source("Model index", [card("a", { name: "from index" }), card("b")]);
    const hub = source("Hugging Face", [card("a", { name: "from hub" }), card("c")]);
    const models = await listModels([index, hub], {});
    expect(models.map((m) => `${m.id}:${m.name}`)).toEqual(["a:from index", "b:b", "c:c"]);
  });

  describe("an index entry and the repository or folder it names", () => {
    const hf = (repo: string, revision = "abc"): ModelLocation => ({ kind: "huggingface", repo, revision });
    const ember = (dandisetId: string, path: string): ModelLocation => ({ kind: "ember", dandisetId, path });
    const indexed = (target: ModelLocation): ModelCardSource => ({ kind: "index", target });

    it("lists the index entry alone, whatever revision and source order", async () => {
      const hub = source("Hugging Face", [
        card("hf:lab/mouse", { source: hf("lab/mouse") }),
        card("hf:lab/fly", { source: hf("lab/fly") }),
      ]);
      const archive = source("EMBER", [
        card("ember:000123/rat", { source: ember("000123", "derivatives/sleap/models/rat") }),
        card("ember:000999/rat", { source: ember("000999", "derivatives/sleap/models/rat") }),
      ]);
      const index = source("Model index", [
        card("index:mouse", { source: indexed(hf("lab/mouse", "v1")) }),
        card("index:rat", { source: indexed(ember("000123", "derivatives/sleap/models/rat/")) }),
      ]);
      const onReplaced = vi.fn();
      const models = await listModels([hub, archive, index, source("unsourced", [card("mock:x")])], {}, { onReplaced });
      expect(models.map((m) => [m.id, m.sourceLabel])).toEqual([
        ["hf:lab/fly", "from Hugging Face lab/fly"],
        ["ember:000999/rat", "from EMBER dandiset 000999"],
        ["index:mouse", "from the model index (Hugging Face lab/mouse)"],
        ["index:rat", "from the model index (EMBER dandiset 000123)"],
        ["mock:x", undefined],
      ]);
      expect(onReplaced.mock.calls.map(([replaced]: [HostModelCard]) => replaced.id)).toEqual([
        "hf:lab/mouse",
        "ember:000123/rat",
      ]);
    });

    it("matches a repository whatever case either names it, and a folder however the entry splits its path", async () => {
      const hub = source("Hugging Face", [card("hf:talmolab/mice", { source: hf("talmolab/mice") })]);
      const archive = source("EMBER", [
        card("ember:000123/m", { source: ember("000123", "derivatives/sleap/models/m") }),
      ]);
      const index = source("Model index", [
        card("index:mice", { source: indexed(hf("Talmolab/Mice", "v1")) }),
        card("index:m", { files: folder("m"), source: indexed(ember("000123", "derivatives/sleap/models")) }),
      ]);
      const models = await listModels([hub, archive, index], {});
      expect(models.map((m) => m.id)).toEqual(["index:mice", "index:m"]);
    });

    it("keeps a direct listing whose model folders the index entries name only some of", async () => {
      const topDown = [...folder("centroid"), ...folder("centered_instance")];
      const hub = source("Hugging Face", [
        card("hf:lab/zoo/fly", { files: folder("fly"), source: hf("lab/zoo") }),
        card("hf:lab/zoo/mouse", { files: folder("mouse"), source: hf("lab/zoo") }),
        card("hf:lab/td", { files: topDown, source: hf("lab/td") }),
        card("hf:lab/empty", { files: [], source: hf("lab/empty") }),
      ]);
      const index = source("Model index", [
        card("index:fly", { files: folder("fly"), source: indexed(hf("lab/zoo", "v1")) }),
        card("index:centroid", { files: folder("centroid"), source: indexed(hf("lab/td", "v1")) }),
        card("index:empty", { source: indexed(hf("lab/empty", "v1")) }),
      ]);
      const models = await listModels([hub, index], {});
      expect(models.map((m) => m.id)).toEqual([
        "hf:lab/zoo/mouse",
        "hf:lab/td",
        "hf:lab/empty",
        "index:fly",
        "index:centroid",
        "index:empty",
      ]);
    });

    it("keeps the first source's card for a shared id, and only an index entry kept replaces a listing", async () => {
      const first = source("first", [card("index:mouse", { name: "first" })]);
      const second = source("second", [
        card("index:mouse", { name: "second", source: indexed(hf("lab/mouse")) }),
        card("hf:lab/mouse", { source: hf("lab/mouse") }),
      ]);
      const models = await listModels([first, second], {});
      expect(models.map((m) => `${m.id}:${m.name}`)).toEqual(["index:mouse:first", "hf:lab/mouse:hf:lab/mouse"]);
    });

    it("finds the index entry by the repository it replaced", async () => {
      const hub = source("Hugging Face", [card("hf:lab/mouse", { source: hf("lab/mouse") })]);
      const index = source("Model index", [card("index:m", { name: "Mouse", source: indexed(hf("lab/mouse")) })]);
      const models = await listModels([index, hub], { text: "lab/mouse" });
      expect(models.map((m) => m.id)).toEqual(["index:m"]);
    });
  });

  it("passes the query and signal to every source", async () => {
    const hub = source("Hugging Face", []);
    const signal = new AbortController().signal;
    await listModels([hub], { text: "mouse" }, { signal });
    expect(hub.list).toHaveBeenCalledWith({ text: "mouse" }, signal);
  });

  it("skips a failed source and reports it", async () => {
    const onWarning = vi.fn();
    const error = new Error("offline");
    const models = await listModels([source("Hugging Face", error), source("EMBER", [card("e")])], {}, { onWarning });
    expect(models.map((m) => m.id)).toEqual(["e"]);
    expect(onWarning).toHaveBeenCalledWith("Hugging Face", error);
  });

  it("warns on the console by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("offline");
    await listModels([source("Hugging Face", error)], {});
    expect(warn).toHaveBeenCalledWith("Could not list models from Hugging Face:", error);
  });

  it("throws rather than returning a partial list once aborted", async () => {
    const controller = new AbortController();
    const slow: ModelSource = {
      name: "slow",
      list: () => {
        controller.abort(new Error("closed"));
        return Promise.resolve([card("a")]);
      },
    };
    await expect(listModels([slow], {}, { signal: controller.signal })).rejects.toThrow("closed");
  });

  it("filters by text", async () => {
    const models = await listModels([source("s", [card("mouse"), card("fly")])], { text: "MOU" });
    expect(models.map((m) => m.id)).toEqual(["mouse"]);
  });

  it("puts skeleton matches first, then unknown skeletons, and drops mismatches", async () => {
    const cards = [
      card("unknown-1"),
      card("mismatch", { skeleton: { nodes: ["head"], edges: [] } }),
      card("match", { skeleton: MOUSE }),
      card("unknown-2"),
    ];
    const models = await listModels([source("s", cards)], { skeletonNodes: ["tail", "nose"] });
    expect(models.map((m) => m.id)).toEqual(["match", "unknown-1", "unknown-2"]);
  });

  it("treats an empty skeleton query as no filter", async () => {
    const cards = [card("x", { skeleton: { nodes: ["head"], edges: [] } }), card("y")];
    const models = await listModels([source("s", cards)], { skeletonNodes: [] });
    expect(models.map((m) => m.id)).toEqual(["x", "y"]);
  });
});
