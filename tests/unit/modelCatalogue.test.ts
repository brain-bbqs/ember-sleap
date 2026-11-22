import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isModelHead,
  listModels,
  matchesText,
  parseSkeleton,
  skeletonFit,
  type ModelSource,
} from "../../src/lib/modelCatalogue";
import type { ModelCard } from "../../src/lib/sleapContract";

function card(id: string, extra: Partial<ModelCard> = {}): ModelCard {
  return { id, name: id, heads: ["centroid"], files: [{ role: "config", url: `https://x/${id}` }], ...extra };
}

function source(name: string, cards: ModelCard[] | Error): ModelSource {
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
