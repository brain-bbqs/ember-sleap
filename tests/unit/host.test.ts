import { describe, expect, it, vi } from "vitest";
import { TRAIN_NEEDS_SAVED_PROJECT, type ComputeClient } from "../../src/lib/computeClient";
import type { ProjectStorage } from "../../src/lib/emberStorage";
import { buildJobRequest, createSleapHost } from "../../src/lib/host";
import { toHostRef } from "../../src/lib/hostRef";
import type { ModelSource } from "../../src/lib/modelCatalogue";
import type { JobEvent, ModelCard, ResolvedFile, TrackJobSpec, TrainJobSpec } from "../../src/lib/sleapContract";

const LABELS: ResolvedFile = { url: "https://s3.test/labels", fileType: "pkg.slp", name: "train.pkg.slp" };
const VAL: ResolvedFile = { url: "https://s3.test/val", fileType: "slp", name: "val.slp" };
const VIDEO: ResolvedFile = { url: "https://s3.test/video", fileType: "mp4", name: "session1.mp4" };
const CARD: ModelCard = {
  id: "hf:lab/mice",
  name: "lab/mice",
  heads: ["single_instance"],
  files: [{ role: "config", url: "https://hf.test/lab/mice/training_config.yaml" }],
};
const project = toHostRef({ dandisetId: "000398", path: "sub-01/train.pkg.slp" });

const filesOf = (...files: ResolvedFile[]) => new Map(files.map((f) => [f.url, f]));
const train = (extra: Partial<TrainJobSpec> = {}): TrainJobSpec => ({
  type: "train",
  config_contents: ["model_config: {}"],
  model_types: ["single_instance"],
  ...extra,
});
const track = (extra: Partial<TrackJobSpec> = {}): TrackJobSpec => ({
  type: "track",
  data_path: VIDEO.url,
  model_paths: [CARD.id],
  ...extra,
});

describe("buildJobRequest", () => {
  it("pairs a train job's labels with their known types, and names the project", () => {
    const spec = train({ labels_path: LABELS.url, val_labels_path: VAL.url });
    expect(buildJobRequest(spec, project, filesOf(LABELS, VAL), new Map())).toEqual({
      spec,
      inputs: [
        { url: LABELS.url, fileType: "pkg.slp", name: "train.pkg.slp" },
        { url: VAL.url, fileType: "slp", name: "val.slp" },
      ],
      models: [],
      project: { dandisetId: "000398", path: "sub-01/train.pkg.slp" },
    });
  });

  it("leaves out the validation labels a train job does not name, and the project when there is none", () => {
    const spec = train({ labels_path: LABELS.url });
    expect(buildJobRequest(spec, undefined, filesOf(LABELS), new Map())).toEqual({
      spec,
      inputs: [{ url: LABELS.url, fileType: "pkg.slp", name: "train.pkg.slp" }],
      models: [],
    });
  });

  it.each([
    ["no labels at all", {}],
    ["inline labels only", { labels_content: "AAAA" }],
    ["inline labels beside a saved project", { labels_path: LABELS.url, labels_content: "AAAA" }],
  ])("refuses a train job with %s, so no compute client is sent inline labels", (_label, labels) => {
    expect(() => buildJobRequest(train(labels), project, filesOf(LABELS), new Map())).toThrow(
      new Error(TRAIN_NEEDS_SAVED_PROJECT),
    );
  });

  it.each([[null], [""]])("accepts a saved project's train job whose labels_content is %j", (labelsContent) => {
    const spec = train({ labels_path: LABELS.url, labels_content: labelsContent });
    expect(buildJobRequest(spec, project, filesOf(LABELS), new Map()).spec).toBe(spec);
  });

  it("expands a track job's model ids to the files the worker downloads", () => {
    const spec = track();
    expect(buildJobRequest(spec, undefined, filesOf(VIDEO), new Map([[CARD.id, CARD]]))).toEqual({
      spec,
      inputs: [{ url: VIDEO.url, fileType: "mp4", name: "session1.mp4" }],
      models: [{ id: CARD.id, files: CARD.files }],
    });
  });

  it("refuses a URL this page did not hand out, since its type is unknown", () => {
    expect(() =>
      buildJobRequest(train({ labels_path: "https://elsewhere.test/x" }), project, new Map(), new Map()),
    ).toThrow("This page did not open https://elsewhere.test/x");
  });

  it("refuses a model the page never listed", () => {
    expect(() => buildJobRequest(track(), project, filesOf(VIDEO), new Map())).toThrow(
      "Model hf:lab/mice is not in the catalogue",
    );
  });
});

function setup(cards: ModelCard[] = [CARD]) {
  const saved = toHostRef({ dandisetId: "000398", path: "derivatives/sleap/x.slp" });
  const storage = {
    save: vi.fn(() => Promise.resolve(saved)),
    resolveVideo: vi.fn((): Promise<ResolvedFile | null> => Promise.resolve(VIDEO)),
    refreshUrl: vi.fn((file: ResolvedFile) => Promise.resolve({ ...file, url: `${file.url}?fresh` })),
  } satisfies ProjectStorage;
  const unsubscribe = vi.fn();
  const compute = {
    submit: vi.fn(() => Promise.resolve({ jobId: "job-1" })),
    subscribe: vi.fn(() => unsubscribe),
    cancel: vi.fn(() => Promise.resolve()),
  } satisfies ComputeClient;
  const failing: ModelSource = { name: "broken", list: () => Promise.reject(new Error("down")) };
  const working: ModelSource = { name: "working", list: () => Promise.resolve(cards) };
  const onModelWarning = vi.fn();
  const host = createSleapHost({ storage, modelSources: [failing, working], compute, onModelWarning });
  return { host, storage, compute, unsubscribe, onModelWarning, saved };
}

describe("createSleapHost", () => {
  it("delegates saving to storage", async () => {
    const { host, storage, saved } = setup();
    const blob = new Blob(["x"]);
    expect(await host.save(blob, "x.slp", project)).toBe(saved);
    expect(storage.save).toHaveBeenCalledWith(blob, "x.slp", project);
  });

  it("can submit a job on a file it was told the page opened", async () => {
    const { host, compute } = setup();
    host.remember({ ...LABELS, ref: project });
    expect(await host.submitJob(train({ labels_path: LABELS.url }), project)).toEqual({ jobId: "job-1" });
    expect(compute.submit).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: [{ url: LABELS.url, fileType: "pkg.slp", name: "train.pkg.slp" }] }),
    );
  });

  it("refuses to train from inline labels before compute sees the job", async () => {
    const { host, compute } = setup();
    const refused = host.submitJob(train({ labels_content: "AAAA" }), project);
    await expect(refused).rejects.toThrow(TRAIN_NEEDS_SAVED_PROJECT);
    expect(compute.submit).not.toHaveBeenCalled();
  });

  it("refuses a job on a file it never saw", async () => {
    const { host, compute } = setup();
    await expect(host.submitJob(train({ labels_path: LABELS.url }), project)).rejects.toThrow("did not open");
    expect(compute.submit).not.toHaveBeenCalled();
  });

  it("remembers the videos it resolves and the cards it lists, for a later track job", async () => {
    const { host, compute, onModelWarning } = setup();
    expect(await host.resolveVideo("C:\\lab\\session1.mp4", project)).toBe(VIDEO);
    expect(await host.listModels({})).toEqual([CARD]);
    expect(onModelWarning).toHaveBeenCalledWith("broken", new Error("down"));
    await host.submitJob(track(), project);
    expect(compute.submit).toHaveBeenCalledWith(
      expect.objectContaining({ models: [{ id: CARD.id, files: CARD.files }] }),
    );
  });

  it("lists models once more before refusing a track job on a card it has not listed, such as one just trained", async () => {
    const cards: ModelCard[] = [];
    const { host, compute, onModelWarning } = setup(cards);
    host.remember({ ...VIDEO, ref: project });
    cards.push(CARD);
    await host.submitJob(track(), project);
    expect(onModelWarning).toHaveBeenCalledTimes(1);
    expect(compute.submit).toHaveBeenCalledWith(
      expect.objectContaining({ models: [{ id: CARD.id, files: CARD.files }] }),
    );

    await host.submitJob(track(), project);
    expect(onModelWarning).toHaveBeenCalledTimes(1);

    const unknown = host.submitJob(track({ model_paths: ["ember:000398/never"] }), project);
    await expect(unknown).rejects.toThrow("Model ember:000398/never is not in the catalogue this page listed.");
    expect(onModelWarning).toHaveBeenCalledTimes(2);
    expect(compute.submit).toHaveBeenCalledTimes(2);
  });

  it("remembers nothing when no video is found", async () => {
    const { host, storage } = setup();
    storage.resolveVideo.mockResolvedValueOnce(null);
    expect(await host.resolveVideo("missing.mp4", project)).toBe(null);
    await expect(host.submitJob(track({ data_path: VIDEO.url }), project)).rejects.toThrow("did not open");
  });

  it("remembers a refreshed link under its new address", async () => {
    const { host, compute } = setup();
    const fresh = await host.refreshUrl(LABELS);
    expect(fresh.url).toBe(`${LABELS.url}?fresh`);
    await host.submitJob(train({ labels_path: fresh.url }), project);
    expect(compute.submit).toHaveBeenCalledTimes(1);
  });

  it("passes job subscriptions and cancels through to compute", async () => {
    const { host, compute, unsubscribe } = setup();
    const onEvent = vi.fn<(event: JobEvent) => void>();
    expect(host.subscribeJob("job-1", onEvent)).toBe(unsubscribe);
    expect(compute.subscribe).toHaveBeenCalledWith("job-1", onEvent);
    await host.cancelJob("job-1");
    expect(compute.cancel).toHaveBeenCalledWith("job-1");
  });
});
