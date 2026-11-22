import { EMBER_INSTANCE, type ArchiveConfig } from "@brain-bbqs/ember-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BIDSIGNORE, BIDSIGNORE_PATH, DATASET_DESCRIPTION_PATH } from "../../src/lib/bidsDerivatives";
import { findAssetByPath, findAssetsByName, resolveDownloadUrl, type ProjectAsset } from "../../src/lib/emberAssets";
import { createEmberStorage, type EmberStorageOptions } from "../../src/lib/emberStorage";
import { putAsset } from "../../src/lib/emberUpload";
import { toHostRef } from "../../src/lib/hostRef";

vi.mock("../../src/lib/emberAssets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/emberAssets")>();
  return { ...actual, findAssetByPath: vi.fn(), findAssetsByName: vi.fn(), resolveDownloadUrl: vi.fn() };
});
vi.mock("../../src/lib/emberUpload", () => ({ putAsset: vi.fn() }));

const findByPath = vi.mocked(findAssetByPath);
const findByName = vi.mocked(findAssetsByName);
const resolveUrl = vi.mocked(resolveDownloadUrl);
const put = vi.mocked(putAsset);

const cfgFor = (dandisetId: string, accessToken = "tok", web = "https://web.test"): ArchiveConfig => ({
  api: "https://api.test/api",
  web,
  accessToken,
  dandisetId,
});

function setup(overrides: Partial<EmberStorageOptions> = {}) {
  const options = {
    config: vi.fn((id: string) => Promise.resolve(cfgFor(id))),
    askEntities: vi.fn(() => Promise.resolve(null)),
    confirmOverwrite: vi.fn(() => Promise.resolve(true)),
    versions: () => ({ app: "0.1.0", sleap: "0.0.0-stand-in" }),
    onProgress: vi.fn(),
    onWarning: vi.fn(),
    fetch: vi.fn(),
    ...overrides,
  } satisfies EmberStorageOptions;
  return { options, storage: createEmberStorage(options) };
}

const ref = (path: string, dandisetId = "000398") => toHostRef({ dandisetId, path });
const file = new Blob(["labels"]);
/** The draft's asset paths: the derivative dataset's files to begin with, then whatever is put. */
let draft: Set<string>;

beforeEach(() => {
  for (const mock of [findByPath, findByName, resolveUrl, put]) mock.mockReset();
  let n = 0;
  resolveUrl.mockImplementation((_, assetId) => Promise.resolve(`https://s3.test/${assetId}?sig=${++n}`));
  draft = new Set([DATASET_DESCRIPTION_PATH, BIDSIGNORE_PATH]);
  findByPath.mockImplementation((_, path) =>
    Promise.resolve(draft.has(path) ? { asset_id: "present", path, size: 1 } : null),
  );
  put.mockImplementation((_, path) => {
    draft.add(path);
    return Promise.resolve({ asset_id: "put", path });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("open", () => {
  it("resolves a listed project to an OpenRequest that carries its type and EMBER location", async () => {
    const { options, storage } = setup();
    const project: ProjectAsset = { asset_id: "a1", path: "sub-NONE/train.pkg.slp", size: 5, fileType: "pkg.slp" };
    expect(await storage.open("000398", project)).toEqual({
      url: "https://s3.test/a1?sig=1",
      fileType: "pkg.slp",
      name: "train.pkg.slp",
      ref: ref("sub-NONE/train.pkg.slp"),
    });
    expect(options.config).toHaveBeenCalledWith("000398");
    expect(resolveUrl).toHaveBeenCalledWith(cfgFor("000398"), "a1", options.fetch);
  });
});

describe("save", () => {
  it("refuses a project with no EMBER location", async () => {
    const { options, storage } = setup();
    await expect(storage.save(file, "x.slp")).rejects.toThrow("Only a project opened from EMBER");
    expect(options.config).not.toHaveBeenCalled();
  });

  it("refuses with the gate's own words while saving is held back", async () => {
    const saveRefusal = vi.fn(() => "Confirm the human-subjects notice first.");
    const { options, storage } = setup({ saveRefusal });
    await expect(storage.save(file, "x.slp", ref("sub-01/x.slp"))).rejects.toThrow(
      "Confirm the human-subjects notice first.",
    );
    expect(saveRefusal).toHaveBeenCalledWith("000398");
    expect(options.config).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses when signed out", async () => {
    const { storage } = setup({ config: (id) => Promise.resolve(cfgFor(id, "")) });
    await expect(storage.save(file, "x.slp", ref("sub-01/x.slp"))).rejects.toThrow("Sign in with EMBER to save.");
    expect(put).not.toHaveBeenCalled();
  });

  it("saves a labels file already in derivatives/sleap/ back over itself, without asking", async () => {
    const source = "derivatives/sleap/sub-01/beh/sub-01_desc-labelsCamTop_pose.slp";
    draft.add(source);
    const { options, storage } = setup({ saveRefusal: () => null });
    expect(await storage.save(file, "renamed.slp", ref(source))).toEqual(ref(source));
    expect(put).toHaveBeenCalledWith(cfgFor("000398"), source, file, options.onProgress);
    expect(options.askEntities).not.toHaveBeenCalled();
    expect(options.confirmOverwrite).not.toHaveBeenCalled();
    expect(findByPath.mock.calls.map((c) => c[1])).toEqual([DATASET_DESCRIPTION_PATH, BIDSIGNORE_PATH]);
  });

  it("places a source's labels by the subject and session its path names", async () => {
    const { options, storage } = setup();
    const target = "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_desc-labelsTrain_pose.pkg.slp";
    expect(await storage.save(file, "train.pkg.slp", ref("sub-01/ses-02/train.pkg.slp"))).toEqual(ref(target));
    expect(put.mock.calls[0][1]).toBe(target);
    expect(options.askEntities).not.toHaveBeenCalled();
    expect(options.confirmOverwrite).not.toHaveBeenCalled();
  });

  it("saves two projects of one session to two labels files, neither over the other", async () => {
    const { options, storage } = setup();
    await storage.save(file, "cam-top.slp", ref("sub-01/ses-01/beh/cam-top.slp"));
    await storage.save(file, "cam-side.slp", ref("sub-01/ses-01/beh/cam-side.slp"));
    expect(put.mock.calls.map((c) => c[1])).toEqual([
      "derivatives/sleap/sub-01/ses-01/beh/sub-01_ses-01_desc-labelsCamTop_pose.slp",
      "derivatives/sleap/sub-01/ses-01/beh/sub-01_ses-01_desc-labelsCamSide_pose.slp",
    ]);
    expect(options.confirmOverwrite).not.toHaveBeenCalled();
  });

  it("saves a proofread predictions file beside it as labels, leaving the predictions alone", async () => {
    const source = "derivatives/sleap/sub-01/beh/sub-01_desc-predictions_pose.slp";
    draft.add(source);
    const { options, storage } = setup();
    const target = "derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.slp";
    expect(await storage.save(file, "predictions.slp", ref(source))).toEqual(ref(target));
    expect(put.mock.calls.map((c) => c[1])).toEqual([target]);
    expect(options.askEntities).not.toHaveBeenCalled();
  });

  it("asks before replacing labels already at the target, and replaces them when told to", async () => {
    const target = "derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.slp";
    draft.add(target);
    const { options, storage } = setup();
    expect(await storage.save(file, "labels.slp", ref("sub-01/labels.slp"))).toEqual(ref(target));
    expect(options.confirmOverwrite).toHaveBeenCalledWith(target);
    expect(put.mock.calls.map((c) => c[1])).toEqual([target]);
  });

  it("cancels, sending nothing, when the person keeps the labels already at the target", async () => {
    const target = "derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.slp";
    draft.add(target);
    const { storage } = setup({ confirmOverwrite: () => Promise.resolve(false) });
    await expect(storage.save(file, "labels.slp", ref("sub-01/labels.slp"))).rejects.toThrow(
      `Save cancelled: ${target} already holds other labels.`,
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("stops before uploading when it cannot tell whether the target is taken", async () => {
    findByPath.mockRejectedValue(new Error("listing failed"));
    const { options, storage } = setup();
    await expect(storage.save(file, "labels.slp", ref("sub-01/labels.slp"))).rejects.toThrow("listing failed");
    expect(options.confirmOverwrite).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("asks for a subject when the source path names none", async () => {
    const askEntities = vi.fn(() => Promise.resolve({ sub: "m3" }));
    const { storage } = setup({ askEntities });
    expect(await storage.save(file, "labels.slp", ref("labels/labels.slp"))).toEqual(
      ref("derivatives/sleap/sub-m3/beh/sub-m3_desc-labels_pose.slp"),
    );
    expect(askEntities).toHaveBeenCalledWith("labels/labels.slp");
  });

  it("asks rather than dropping a session the source path names but cannot be read", async () => {
    const askEntities = vi.fn(() => Promise.resolve({ sub: "01", ses: "day1" }));
    const { storage } = setup({ askEntities });
    expect(await storage.save(file, "labels.slp", ref("sub-01/ses-day-1/labels.slp"))).toEqual(
      ref("derivatives/sleap/sub-01/ses-day1/beh/sub-01_ses-day1_desc-labels_pose.slp"),
    );
    expect(askEntities).toHaveBeenCalledWith("sub-01/ses-day-1/labels.slp");
  });

  it("cancels when the person gives no subject", async () => {
    const { storage } = setup();
    await expect(storage.save(file, "labels.slp", ref("labels/labels.slp"))).rejects.toThrow("Save cancelled");
    expect(put).not.toHaveBeenCalled();
  });

  it("leaves the derivative dataset's files alone when they are already there", async () => {
    const { storage } = setup();
    await storage.save(file, "x.slp", ref("sub-01/x.slp"));
    expect(findByPath.mock.calls.map((c) => c[1])).toEqual([
      "derivatives/sleap/sub-01/beh/sub-01_desc-labelsX_pose.slp",
      DATASET_DESCRIPTION_PATH,
      BIDSIGNORE_PATH,
    ]);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("writes the dataset description and .bidsignore on the first save into a dandiset", async () => {
    findByPath.mockResolvedValue(null);
    const { storage } = setup({ versions: () => ({ app: "9.9.9", sleap: "1.2.3" }) });
    await storage.save(file, "x.slp", ref("sub-01/x.slp"));
    expect(put.mock.calls.map((c) => c[1])).toEqual([
      "derivatives/sleap/sub-01/beh/sub-01_desc-labelsX_pose.slp",
      DATASET_DESCRIPTION_PATH,
      BIDSIGNORE_PATH,
    ]);
    const description = JSON.parse(await put.mock.calls[1][2].text()) as {
      GeneratedBy: { Version: string }[];
      SourceDatasets: { URL: string }[];
    };
    expect(description.GeneratedBy.map((g) => g.Version)).toEqual(["9.9.9", "1.2.3"]);
    expect(description.SourceDatasets).toEqual([{ URL: "https://web.test/dandiset/000398/draft" }]);
    expect(await put.mock.calls[2][2].text()).toBe(BIDSIGNORE);
  });

  it("falls back to EMBER's own web address when the config has none", async () => {
    findByPath.mockResolvedValue(null);
    const { storage } = setup({ config: (id) => Promise.resolve(cfgFor(id, "tok", "")) });
    await storage.save(file, "x.slp", ref("sub-01/x.slp"));
    const description = JSON.parse(await put.mock.calls[1][2].text()) as { SourceDatasets: { URL: string }[] };
    expect(description.SourceDatasets[0].URL).toBe(`${EMBER_INSTANCE.web}/dandiset/000398/draft`);
  });

  it("only warns when the derivative dataset's files cannot be written; the save stands", async () => {
    findByPath
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("listing failed"))
      .mockResolvedValueOnce(null);
    put.mockResolvedValueOnce({ asset_id: "labels", path: "x" }).mockRejectedValueOnce("S3 said no");
    const { options, storage } = setup();
    expect(await storage.save(file, "x.slp", ref("sub-01/x.slp"))).toEqual(
      ref("derivatives/sleap/sub-01/beh/sub-01_desc-labelsX_pose.slp"),
    );
    expect(options.onWarning.mock.calls).toEqual([
      [`Saved, but could not write ${DATASET_DESCRIPTION_PATH}: listing failed`],
      [`Saved, but could not write ${BIDSIGNORE_PATH}: S3 said no`],
    ]);
  });

  it("warns on the console when no warning callback is given", async () => {
    findByPath.mockResolvedValueOnce(null).mockRejectedValue(new Error("listing failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { storage } = setup({ onWarning: undefined });
    await storage.save(file, "x.slp", ref("sub-01/x.slp"));
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("resolveVideo", () => {
  it.each([
    ["no project", "video.mp4", undefined],
    ["a stored project rather than a video", "other.slp", ref("sub-01/x.slp")],
    ["an unknown file type", "notes.txt", ref("sub-01/x.slp")],
  ])("finds nothing for %s", async (_, stored, project) => {
    const { options, storage } = setup();
    expect(await storage.resolveVideo(stored, project)).toBe(null);
    expect(options.config).not.toHaveBeenCalled();
  });

  it("finds nothing when no asset has the video's name", async () => {
    findByName.mockResolvedValue([]);
    const { storage } = setup();
    expect(await storage.resolveVideo("C:\\lab\\session1.mp4", ref("sub-01/x.slp"))).toBe(null);
    expect(findByName).toHaveBeenCalledWith(cfgFor("000398"), "session1.mp4");
  });

  it("resolves the candidate closest to the project, keeping the stored file's type and name", async () => {
    findByName.mockResolvedValue([
      { asset_id: "far", path: "sub-02/session1.avi", size: 1 },
      { asset_id: "near", path: "sub-01/beh/session1.avi", size: 1 },
    ]);
    const { storage } = setup();
    expect(await storage.resolveVideo("/lab/session1.avi", ref("sub-01/beh/labels.slp"))).toEqual({
      url: "https://s3.test/near?sig=1",
      fileType: "avi",
      name: "session1.avi",
    });
  });

  it("resolves a saved project's video by the source tree its labels file mirrors", async () => {
    findByName.mockResolvedValue([
      { asset_id: "other", path: "sub-01/session1.mp4", size: 1 },
      { asset_id: "own", path: "sub-02/session1.mp4", size: 1 },
    ]);
    const { storage } = setup();
    const saved = ref("derivatives/sleap/sub-02/beh/sub-02_desc-labelsCamTop_pose.slp");
    expect((await storage.resolveVideo("D:\\videos\\mouse2\\session1.mp4", saved))?.url).toBe(
      "https://s3.test/own?sig=1",
    );
  });
});

describe("refreshUrl", () => {
  it("returns a file it did not hand out unchanged", async () => {
    const { options, storage } = setup();
    const unknown = { url: "https://elsewhere.test/x", fileType: "mp4" as const, name: "x.mp4" };
    expect(await storage.refreshUrl(unknown)).toBe(unknown);
    expect(options.config).not.toHaveBeenCalled();
  });

  it("renews a link it handed out from the same asset, and forgets the old one", async () => {
    const { options, storage } = setup();
    const opened = await storage.open("000123", { asset_id: "a1", path: "sub-01/x.slp", size: 1, fileType: "slp" });
    const request = { url: opened.url, fileType: opened.fileType, name: opened.name };
    const fresh = await storage.refreshUrl(request);
    expect(fresh).toEqual({ ...request, url: "https://s3.test/a1?sig=2" });
    expect(options.config).toHaveBeenLastCalledWith("000123");
    expect(await storage.refreshUrl(request)).toBe(request);
    expect((await storage.refreshUrl(fresh)).url).toBe("https://s3.test/a1?sig=3");
  });
});
