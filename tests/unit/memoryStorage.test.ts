import { describe, expect, it } from "vitest";
import { toHostRef } from "../../src/lib/hostRef";
import { createMemoryStorage } from "../../src/lib/memoryStorage";

describe("createMemoryStorage", () => {
  it("places a save where EMBER storage would, and records it", async () => {
    const storage = createMemoryStorage();
    const ref = await storage.save(
      new Blob(["abc"]),
      "labels.slp",
      toHostRef({ dandisetId: "mock", path: "sub-01/ses-02/labels.slp" }),
    );
    expect(ref).toEqual(
      toHostRef({ dandisetId: "mock", path: "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_desc-labels_pose.slp" }),
    );
    expect(storage.saved).toEqual([
      { path: "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_desc-labels_pose.slp", size: 3 },
    ]);
  });

  it("falls back to sub-mock rather than asking, for a source that names no subject", async () => {
    const storage = createMemoryStorage();
    const ref = await storage.save(
      new Blob([]),
      "train.pkg.slp",
      toHostRef({ dandisetId: "mock", path: "train.pkg.slp" }),
    );
    expect(ref.key).toBe("ember:mock:derivatives/sleap/sub-mock/beh/sub-mock_desc-labelsTrain_pose.pkg.slp");
  });

  it("saves the next time back over the labels file the first save made", async () => {
    const storage = createMemoryStorage();
    const first = await storage.save(
      new Blob(["a"]),
      "cam-top.slp",
      toHostRef({ dandisetId: "mock", path: "sub-01/cam-top.slp" }),
    );
    expect(await storage.save(new Blob(["ab"]), "cam-top.slp", first)).toEqual(first);
    expect(storage.saved).toEqual([
      { path: "derivatives/sleap/sub-01/beh/sub-01_desc-labelsCamTop_pose.slp", size: 1 },
      { path: "derivatives/sleap/sub-01/beh/sub-01_desc-labelsCamTop_pose.slp", size: 2 },
    ]);
  });

  it("refuses a project with no EMBER location", async () => {
    const storage = createMemoryStorage();
    await expect(storage.save(new Blob([]), "x.slp")).rejects.toThrow("Only a project opened from EMBER");
    expect(storage.saved).toEqual([]);
  });

  it("finds no videos and leaves URLs as they are", async () => {
    const storage = createMemoryStorage();
    const file = { url: "data:,x", fileType: "slp" as const, name: "x.slp" };
    expect(await storage.resolveVideo("video.mp4", toHostRef({ dandisetId: "mock", path: "x.slp" }))).toBe(null);
    expect(await storage.refreshUrl(file)).toBe(file);
  });
});
