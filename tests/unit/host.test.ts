import { describe, expect, it, vi } from "vitest";
import {
  INLINE_LABELS_REFUSED,
  TRAIN_NEEDS_LABELS,
  type ArchiveRef,
  type ComputeClient,
  type JobRequest,
} from "../../src/lib/computeClient";
import type { ProjectStorage, SavedFile } from "../../src/lib/emberStorage";
import {
  buildJobRequest,
  createSleapHost,
  INLINE_LABELS_EMPTY,
  INLINE_LABELS_NOT_BASE64,
  type JobContext,
} from "../../src/lib/host";
import { toHostRef } from "../../src/lib/hostRef";
import type { ModelSource } from "../../src/lib/modelCatalogue";
import type {
  HostRef,
  JobEvent,
  ModelCard,
  ResolvedFile,
  TrackJobSpec,
  TrainJobSpec,
} from "../../src/lib/sleapContract";

const LABELS: ResolvedFile = { url: "https://s3.test/labels", fileType: "pkg.slp", name: "train.pkg.slp" };
const VAL: ResolvedFile = { url: "https://s3.test/val", fileType: "slp", name: "val.slp" };
const VIDEO: ResolvedFile = { url: "https://s3.test/video", fileType: "mp4", name: "session1.mp4" };
const SAVED_PATH = "derivatives/sleap/sub-01/beh/sub-01_desc-labelsTrain_pose.pkg.slp";
const SAVED: ResolvedFile = {
  url: "https://s3.test/saved",
  fileType: "pkg.slp",
  name: "sub-01_desc-labelsTrain_pose.pkg.slp",
};
const PACKAGE_PATH = "derivatives/sleap/sub-01/beh/sub-01_desc-trainingsetTrain20261122153000_pose.pkg.slp";
const PACKAGE: ResolvedFile = {
  url: "https://s3.test/package",
  fileType: "pkg.slp",
  name: "sub-01_desc-trainingsetTrain20261122153000_pose.pkg.slp",
};
const CARD: ModelCard = {
  id: "hf:lab/mice",
  name: "lab/mice",
  heads: ["single_instance"],
  files: [{ role: "config", url: "https://hf.test/lab/mice/training_config.yaml" }],
};
const project = toHostRef({ dandisetId: "000398", path: "sub-01/train.pkg.slp" });
const savedRef = toHostRef({ dandisetId: "000398", path: SAVED_PATH });
const archiveOf = (assetId: string, path: string): ArchiveRef => ({
  dandisetId: "000398",
  assetId,
  path,
  downloadUrl: `https://api.test/api/assets/${assetId}/download/`,
});

const filesOf = (...files: ResolvedFile[]) => new Map(files.map((f) => [f.url, f]));
const known = (overrides: Partial<JobContext> = {}): JobContext => ({
  files: new Map(),
  latestSave: () => undefined,
  cards: new Map(),
  describe: () => null,
  ...overrides,
});
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
    expect(buildJobRequest(spec, project, known({ files: filesOf(LABELS, VAL) }))).toEqual({
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
    expect(buildJobRequest(spec, undefined, known({ files: filesOf(LABELS) }))).toEqual({
      spec,
      inputs: [{ url: LABELS.url, fileType: "pkg.slp", name: "train.pkg.slp" }],
      models: [],
    });
  });

  it("names the EMBER asset behind each input it knows one for", () => {
    const describe = (url: string) => (url === LABELS.url ? archiveOf("a1", "sub-01/train.pkg.slp") : null);
    const spec = train({ labels_path: LABELS.url, val_labels_path: VAL.url });
    expect(buildJobRequest(spec, project, known({ files: filesOf(LABELS, VAL), describe })).inputs).toEqual([
      { ...LABELS, archive: archiveOf("a1", "sub-01/train.pkg.slp") },
      VAL,
    ]);
  });

  it.each([
    ["labels_path", train({ labels_path: LABELS.url, val_labels_path: VAL.url }), "labels_path"],
    ["val_labels_path", train({ labels_path: VAL.url, val_labels_path: LABELS.url }), "val_labels_path"],
    ["data_path", track({ data_path: LABELS.url }), "data_path"],
  ] as const)("sends a project saved since it was opened as its latest save, in %s", (_, spec, field) => {
    const context = known({
      files: filesOf(LABELS, VAL, SAVED),
      latestSave: (url) => (url === LABELS.url ? SAVED : undefined),
      cards: new Map([[CARD.id, CARD]]),
      describe: (url) => (url === SAVED.url ? archiveOf("s1", SAVED_PATH) : null),
    });
    const request = buildJobRequest(spec, project, context);
    expect((request.spec as unknown as Record<string, string>)[field]).toBe(SAVED.url);
    expect(request.inputs).toContainEqual({ ...SAVED, archive: archiveOf("s1", SAVED_PATH) });
    expect(request.inputs.map((i) => i.url)).not.toContain(LABELS.url);
  });

  it.each([
    ["no labels at all", {}, TRAIN_NEEDS_LABELS],
    ["only empty inline labels", { labels_content: "" }, INLINE_LABELS_EMPTY],
    ["no labels path and null inline labels", { labels_content: null }, TRAIN_NEEDS_LABELS],
    ["inline labels only", { labels_content: "AAAA" }, INLINE_LABELS_REFUSED],
    [
      "inline labels beside a saved project",
      { labels_path: LABELS.url, labels_content: "AAAA" },
      INLINE_LABELS_REFUSED,
    ],
  ])("refuses a train job with %s, so no compute client is sent inline labels", (_label, labels, message) => {
    expect(() => buildJobRequest(train(labels), project, known({ files: filesOf(LABELS) }))).toThrow(
      new Error(message),
    );
  });

  it.each([[null], [""]])("drops a labels_content of %j beside a saved project's labels_path", (labelsContent) => {
    const spec = train({ labels_path: LABELS.url, labels_content: labelsContent });
    const sent = buildJobRequest(spec, project, known({ files: filesOf(LABELS) })).spec;
    expect(sent).toEqual(train({ labels_path: LABELS.url }));
    expect("labels_content" in sent).toBe(false);
  });

  it("expands a track job's model ids to the files the worker downloads", () => {
    const spec = track();
    expect(
      buildJobRequest(spec, undefined, known({ files: filesOf(VIDEO), cards: new Map([[CARD.id, CARD]]) })),
    ).toEqual({
      spec,
      inputs: [{ url: VIDEO.url, fileType: "mp4", name: "session1.mp4" }],
      models: [{ id: CARD.id, files: CARD.files }],
    });
  });

  it("refuses a URL this page did not hand out, since its type is unknown", () => {
    expect(() => buildJobRequest(train({ labels_path: "https://elsewhere.test/x" }), project, known())).toThrow(
      "This page did not open https://elsewhere.test/x",
    );
  });

  it("refuses a model the page never listed", () => {
    expect(() => buildJobRequest(track(), project, known({ files: filesOf(VIDEO) }))).toThrow(
      "Model hf:lab/mice is not in the catalogue",
    );
  });
});

function setup(cards: ModelCard[] = [CARD]) {
  const archives = new Map<string, ArchiveRef>([
    [LABELS.url, archiveOf("a1", "sub-01/train.pkg.slp")],
    [SAVED.url, archiveOf("s1", SAVED_PATH)],
    [PACKAGE.url, archiveOf("p1", PACKAGE_PATH)],
  ]);
  const storage = {
    save: vi.fn((): Promise<SavedFile> => Promise.resolve({ ref: savedRef, file: SAVED })),
    saveTrainingPackage: vi.fn((): Promise<SavedFile> =>
      Promise.resolve({ ref: toHostRef({ dandisetId: "000398", path: PACKAGE_PATH }), file: PACKAGE }),
    ),
    resolveVideo: vi.fn((): Promise<ResolvedFile | null> => Promise.resolve(VIDEO)),
    refreshUrl: vi.fn((file: ResolvedFile) => Promise.resolve({ ...file, url: `${file.url}?fresh` })),
    describe: vi.fn((url: string) => archives.get(url) ?? null),
  } satisfies ProjectStorage;
  const unsubscribe = vi.fn();
  const compute = {
    submit: vi.fn<(request: JobRequest) => Promise<{ jobId: string }>>(() => Promise.resolve({ jobId: "job-1" })),
    subscribe: vi.fn(() => unsubscribe),
    cancel: vi.fn(() => Promise.resolve()),
  } satisfies ComputeClient;
  const failing: ModelSource = { name: "broken", list: () => Promise.reject(new Error("down")) };
  const working: ModelSource = { name: "working", list: () => Promise.resolve(cards) };
  const onModelWarning = vi.fn();
  const host = createSleapHost({ storage, modelSources: [failing, working], compute, onModelWarning });
  /** The request compute was last sent. */
  const sent = () => compute.submit.mock.calls.at(-1)![0];
  return { host, storage, compute, unsubscribe, onModelWarning, sent };
}

/** Holds storage's next save back until the test lands it. */
function heldSave(storage: ReturnType<typeof setup>["storage"]): { land: (saved: SavedFile) => void } {
  let land!: (saved: SavedFile) => void;
  storage.save.mockImplementationOnce(() => new Promise<SavedFile>((resolve) => (land = resolve)));
  return { land: (saved) => land(saved) };
}

describe("createSleapHost", () => {
  it("delegates saving to storage, handing the app the saved file's ref", async () => {
    const { host, storage } = setup();
    const blob = new Blob(["x"]);
    expect(await host.save(blob, "x.slp", project)).toBe(savedRef);
    expect(storage.save).toHaveBeenCalledWith(blob, "x.slp", project);
  });

  it("can submit a job on a file it was told the page opened, naming its EMBER asset", async () => {
    const { host, sent } = setup();
    host.remember({ ...LABELS, ref: project });
    expect(await host.submitJob(train({ labels_path: LABELS.url }), project)).toEqual({ jobId: "job-1" });
    expect(sent().inputs).toEqual([{ ...LABELS, archive: archiveOf("a1", "sub-01/train.pkg.slp") }]);
  });

  describe("after a save", () => {
    it("trains on what the save wrote, not on the link the project was opened under", async () => {
      const { host, sent } = setup();
      host.remember({ ...LABELS, ref: project });
      await host.save(new Blob(["x"]), "train.pkg.slp", project);
      await host.submitJob(train({ labels_path: LABELS.url }), savedRef);
      expect(sent().spec).toMatchObject({ labels_path: SAVED.url });
      expect(sent().inputs).toEqual([{ ...SAVED, archive: archiveOf("s1", SAVED_PATH) }]);
      expect(sent().project).toEqual({ dandisetId: "000398", path: SAVED_PATH });
    });

    it("names the latest of several saves, made under the ref each save returned", async () => {
      const { host, storage, sent } = setup();
      const later: ResolvedFile = { ...SAVED, url: "https://s3.test/saved-again" };
      storage.save
        .mockResolvedValueOnce({ ref: savedRef, file: SAVED })
        .mockResolvedValueOnce({ ref: savedRef, file: later });
      host.remember({ ...LABELS, ref: project });
      await host.save(new Blob(["x"]), "train.pkg.slp", project);
      await host.save(new Blob(["xy"]), "train.pkg.slp", savedRef);
      await host.submitJob(track({ data_path: LABELS.url }), savedRef);
      expect(sent().spec).toMatchObject({ data_path: later.url });
    });

    it("follows a link renewed before or after the save to the same saved file", async () => {
      const { host, sent } = setup();
      host.remember({ ...LABELS, ref: project });
      const before = await host.refreshUrl(LABELS);
      await host.save(new Blob(["x"]), "train.pkg.slp", project);
      const after = await host.refreshUrl(before);
      for (const link of [before.url, after.url]) {
        await host.submitJob(train({ labels_path: link }), savedRef);
        expect(sent().spec).toMatchObject({ labels_path: SAVED.url });
      }
    });

    it("trains on a project opened again as it was opened, until it is saved again", async () => {
      const { host, sent } = setup();
      host.remember({ ...LABELS, ref: project });
      await host.save(new Blob(["x"]), "train.pkg.slp", project);
      host.remember({ ...LABELS, ref: project });
      await host.submitJob(train({ labels_path: LABELS.url }), project);
      expect(sent().spec).toMatchObject({ labels_path: LABELS.url });
    });

    it("can name the saved file itself, as a train result's labels_path is named next", async () => {
      const { host, sent } = setup();
      host.remember({ ...LABELS, ref: project });
      await host.save(new Blob(["x"]), "train.pkg.slp", project);
      await host.submitJob(track({ data_path: SAVED.url }), savedRef);
      expect(sent().inputs).toEqual([{ ...SAVED, archive: archiveOf("s1", SAVED_PATH) }]);
    });

    it.each<[string, HostRef | undefined]>([
      ["a ref it never handed out", toHostRef({ dandisetId: "000398", path: "elsewhere.slp" })],
      ["no ref", undefined],
    ])("ties a save under %s to no opened project", async (_, ref) => {
      const { host, sent } = setup();
      host.remember({ ...LABELS, ref: project });
      await host.save(new Blob(["x"]), "x.slp", ref);
      await host.submitJob(train({ labels_path: LABELS.url }), project);
      expect(sent().spec).toMatchObject({ labels_path: LABELS.url });
    });

    it("keeps a project opened with no ref as it was opened", async () => {
      const { host, sent } = setup();
      host.remember(LABELS);
      await host.submitJob(train({ labels_path: LABELS.url }));
      expect(sent().spec).toMatchObject({ labels_path: LABELS.url });
    });

    it("keeps a save with the open it came from when the project is opened again before it lands", async () => {
      const { host, storage, sent } = setup();
      const landing = heldSave(storage);
      host.remember({ ...LABELS, ref: project });
      const saving = host.save(new Blob(["x"]), "train.pkg.slp", project);
      const again: ResolvedFile = { ...LABELS, url: "https://s3.test/labels-again" };
      host.remember({ ...again, ref: project });
      landing.land({ ref: savedRef, file: SAVED });
      await saving;
      await host.submitJob(train({ labels_path: again.url }), project);
      expect(sent().spec).toMatchObject({ labels_path: again.url });
      await host.submitJob(train({ labels_path: LABELS.url }), savedRef);
      expect(sent().spec).toMatchObject({ labels_path: SAVED.url });
    });

    it("leaves the saved file's ref to a project opened from it before an earlier project's save landed", async () => {
      const { host, storage, sent } = setup();
      const landing = heldSave(storage);
      host.remember({ ...LABELS, ref: project });
      const saving = host.save(new Blob(["x"]), "train.pkg.slp", project);
      const opened: ResolvedFile = { ...SAVED, url: "https://s3.test/saved-as-opened" };
      host.remember({ ...opened, ref: savedRef });
      landing.land({ ref: savedRef, file: SAVED });
      await saving;
      const resaved: ResolvedFile = { ...SAVED, url: "https://s3.test/saved-again" };
      storage.save.mockResolvedValueOnce({ ref: savedRef, file: resaved });
      await host.save(new Blob(["xy"]), SAVED.name, savedRef);
      await host.submitJob(train({ labels_path: opened.url }), savedRef);
      expect(sent().spec).toMatchObject({ labels_path: resaved.url });
    });

    it("waits for a save of the project a job names that is still running, then names what it wrote", async () => {
      const { host, storage, compute, sent } = setup();
      const landing = heldSave(storage);
      host.remember({ ...LABELS, ref: project });
      const saving = host.save(new Blob(["x"]), "train.pkg.slp", project);
      const job = host.submitJob(train({ labels_path: LABELS.url }), project);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(compute.submit).not.toHaveBeenCalled();
      landing.land({ ref: savedRef, file: SAVED });
      await Promise.all([saving, job]);
      expect(sent().spec).toMatchObject({ labels_path: SAVED.url });
    });

    it("names the link a project was opened under when the save a job waited for fails", async () => {
      const { host, storage, sent } = setup();
      storage.save.mockRejectedValueOnce(new Error("HTTP 500"));
      host.remember({ ...LABELS, ref: project });
      const saving = host.save(new Blob(["x"]), "train.pkg.slp", project);
      const job = host.submitJob(train({ labels_path: LABELS.url }), project);
      await expect(saving).rejects.toThrow("HTTP 500");
      await job;
      expect(sent().spec).toMatchObject({ labels_path: LABELS.url });
    });
  });

  describe("training from labels sent inline", () => {
    const content = btoa("labels from this window");

    it("keeps them on EMBER as a training package first, and trains on that file", async () => {
      const { host, storage, sent } = setup();
      host.remember({ ...LABELS, ref: project });
      await host.submitJob(train({ labels_content: content, max_epochs: 2 }), project);
      const [blob, ref] = storage.saveTrainingPackage.mock.calls[0] as unknown as [Blob, HostRef];
      expect(await blob.text()).toBe("labels from this window");
      expect(ref).toBe(project);
      expect(sent().spec).toEqual(train({ labels_path: PACKAGE.url, max_epochs: 2 }));
      expect(sent().inputs).toEqual([{ ...PACKAGE, archive: archiveOf("p1", PACKAGE_PATH) }]);
      expect(sent().project).toEqual({ dandisetId: "000398", path: "sub-01/train.pkg.slp" });
    });

    it("prefers them to a labels_path sent beside them", async () => {
      const { host, sent } = setup();
      host.remember({ ...LABELS, ref: project });
      await host.submitJob(train({ labels_path: LABELS.url, labels_content: content }), project);
      expect(sent().spec).toMatchObject({ labels_path: PACKAGE.url });
      expect(sent().spec).not.toHaveProperty("labels_content");
    });

    it("trains on them beside validation labels the page opened", async () => {
      const { host, sent } = setup();
      host.remember(VAL);
      await host.submitJob(train({ labels_content: content, val_labels_path: VAL.url }), project);
      expect(sent().inputs.map((i) => i.url)).toEqual([PACKAGE.url, VAL.url]);
    });

    it("checks the rest of the job before keeping them, so a refused job leaves no package behind", async () => {
      const { host, storage, compute } = setup();
      const spec = train({ labels_content: content, val_labels_path: "C:/lab/val.slp" });
      await expect(host.submitJob(spec, project)).rejects.toThrow("This page did not open C:/lab/val.slp");
      expect(storage.saveTrainingPackage).not.toHaveBeenCalled();
      expect(compute.submit).not.toHaveBeenCalled();
    });

    it("remembers the package, so a later job can name it", async () => {
      const { host, sent } = setup();
      await host.submitJob(train({ labels_content: content }), project);
      await host.submitJob(track({ data_path: PACKAGE.url }), project);
      expect(sent().inputs.map((i) => i.url)).toEqual([PACKAGE.url]);
    });

    it("refuses labels that are not base64, keeping nothing", async () => {
      const { host, storage, compute } = setup();
      await expect(host.submitJob(train({ labels_content: "not base64!" }), project)).rejects.toThrow(
        INLINE_LABELS_NOT_BASE64,
      );
      expect(storage.saveTrainingPackage).not.toHaveBeenCalled();
      expect(compute.submit).not.toHaveBeenCalled();
    });

    it("sends nothing to compute when the package cannot be kept", async () => {
      const { host, storage, compute } = setup();
      storage.saveTrainingPackage.mockRejectedValueOnce(new Error("Sign in with EMBER to save."));
      await expect(host.submitJob(train({ labels_content: content }), project)).rejects.toThrow(
        "Sign in with EMBER to save.",
      );
      expect(compute.submit).not.toHaveBeenCalled();
    });
  });

  it("refuses a train job naming no labels before compute sees it", async () => {
    const { host, storage, compute } = setup();
    await expect(host.submitJob(train({ labels_content: null }), project)).rejects.toThrow(TRAIN_NEEDS_LABELS);
    expect(storage.saveTrainingPackage).not.toHaveBeenCalled();
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
