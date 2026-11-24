import { describe, expect, it, vi } from "vitest";
import type { ProjectStorage, SavedFile } from "../../src/lib/emberStorage";
import { createSleapHost } from "../../src/lib/host";
import { toHostRef } from "../../src/lib/hostRef";
import type { ResolvedFile } from "../../src/lib/sleapContract";

const LABELS: ResolvedFile = { url: "https://s3.test/labels", fileType: "pkg.slp", name: "train.pkg.slp" };
const VIDEO: ResolvedFile = { url: "https://s3.test/video", fileType: "mp4", name: "session1.mp4" };
const SAVED_PATH = "derivatives/sleap/sub-01/beh/sub-01_desc-labelsTrain_pose.pkg.slp";
const project = toHostRef({ dandisetId: "000398", path: "sub-01/train.pkg.slp" });
const savedRef = toHostRef({ dandisetId: "000398", path: SAVED_PATH });
const SAVED: SavedFile = {
  ref: savedRef,
  file: { url: "https://s3.test/saved", fileType: "pkg.slp", name: "sub-01_desc-labelsTrain_pose.pkg.slp" },
};

function setup(chooseProject?: (intent: "new" | "open") => void) {
  const storage = {
    save: vi.fn<ProjectStorage["save"]>().mockResolvedValue(SAVED),
    resolveVideo: vi.fn<ProjectStorage["resolveVideo"]>().mockResolvedValue(VIDEO),
    refreshUrl: vi.fn<ProjectStorage["refreshUrl"]>((file) => Promise.resolve({ ...file, url: `${file.url}?fresh` })),
  };
  return { storage, host: createSleapHost({ storage, chooseProject }) };
}

describe("createSleapHost", () => {
  it("hands the app's New Project… and Open Project… to the page's picker, and offers none without one", () => {
    const chooseProject = vi.fn();
    setup(chooseProject).host.chooseProject!("new");
    expect(chooseProject).toHaveBeenCalledWith("new");
    expect(setup().host.chooseProject).toBeUndefined();
  });

  it("delegates saving to storage, handing the app the saved file's ref", async () => {
    const { host, storage } = setup();
    const blob = new Blob(["x"]);
    expect(await host.save(blob, "x.slp", project)).toBe(savedRef);
    expect(storage.save).toHaveBeenCalledWith(blob, "x.slp", project);
  });

  it("saves a new project with no ref through storage as it is", async () => {
    const { host, storage } = setup();
    await host.save(new Blob(["x"]), "Untitled.slp", undefined);
    expect(storage.save).toHaveBeenCalledWith(expect.any(Blob), "Untitled.slp", undefined);
  });

  it("passes a save's failure on to the app", async () => {
    const { host, storage } = setup();
    storage.save.mockRejectedValueOnce(new Error("Sign in with EMBER to save."));
    await expect(host.save(new Blob(["x"]), "x.slp", project)).rejects.toThrow("Sign in with EMBER to save.");
  });

  it("looks videos up through storage, under the project they belong to", async () => {
    const { host, storage } = setup();
    expect(await host.resolveVideo("C:\\lab\\session1.mp4", project)).toBe(VIDEO);
    expect(storage.resolveVideo).toHaveBeenCalledWith("C:\\lab\\session1.mp4", project);
    storage.resolveVideo.mockResolvedValueOnce(null);
    expect(await host.resolveVideo("missing.mp4", project)).toBe(null);
  });

  it("renews a link through storage", async () => {
    const { host, storage } = setup();
    expect((await host.refreshUrl(LABELS)).url).toBe(`${LABELS.url}?fresh`);
    expect(storage.refreshUrl).toHaveBeenCalledWith(LABELS);
  });
});
