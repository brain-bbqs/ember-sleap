import { describe, expect, it } from "vitest";
import { toHostRef } from "../../src/lib/hostRef";
import { createMemoryStorage } from "../../src/lib/memoryStorage";

const mock = (path: string) => toHostRef({ dandisetId: "mock", path });

describe("createMemoryStorage", () => {
  it("places a save where EMBER storage would, records it, and names it by a link of its own", async () => {
    const storage = createMemoryStorage();
    const path = "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_desc-labels_pose.slp";
    expect(await storage.save(new Blob(["abc"]), "labels.slp", mock("sub-01/ses-02/labels.slp"))).toEqual({
      ref: mock(path),
      file: { url: `memory://mock/${path}?save=1`, fileType: "slp", name: "sub-01_ses-02_desc-labels_pose.slp" },
    });
    expect(storage.saved).toEqual([{ path, size: 3 }]);
  });

  it("falls back to sub-mock rather than asking, for a source that names no subject", async () => {
    const storage = createMemoryStorage();
    const { ref, file } = await storage.save(new Blob([]), "train.pkg.slp", mock("train.pkg.slp"));
    expect(ref.key).toBe("ember:mock:derivatives/sleap/sub-mock/beh/sub-mock_desc-labelsTrain_pose.pkg.slp");
    expect(file.fileType).toBe("pkg.slp");
  });

  it("takes the suggested subject and session where EMBER storage would ask", async () => {
    const storage = createMemoryStorage();
    const { ref } = await storage.save(new Blob([]), "labels.slp", mock("sub-07/ses-day-1/labels.slp"));
    expect(ref.key).toBe("ember:mock:derivatives/sleap/sub-07/ses-day1/beh/sub-07_ses-day1_desc-labels_pose.slp");
  });

  it("saves the next time back over the labels file the first save made, under a new link", async () => {
    const storage = createMemoryStorage();
    const first = await storage.save(new Blob(["a"]), "cam-top.slp", mock("sub-01/cam-top.slp"));
    const second = await storage.save(new Blob(["ab"]), "cam-top.slp", first.ref);
    expect(second.ref).toEqual(first.ref);
    expect(second.file.url).not.toBe(first.file.url);
    expect(storage.saved).toEqual([
      { path: "derivatives/sleap/sub-01/beh/sub-01_desc-labelsCamTop_pose.slp", size: 1 },
      { path: "derivatives/sleap/sub-01/beh/sub-01_desc-labelsCamTop_pose.slp", size: 2 },
    ]);
  });

  it("refuses a save for a project with no EMBER location", async () => {
    const storage = createMemoryStorage();
    await expect(storage.save(new Blob([]), "x.slp")).rejects.toThrow("Only a project opened from EMBER");
    expect(storage.saved).toEqual([]);
  });

  it("saves a proofread predictions file as labels beside it, never over it", async () => {
    const storage = createMemoryStorage();
    const predictions = "derivatives/sleap/sub-mock/beh/sub-mock_desc-predictionsCamTop_pose.slp";
    const saved = await storage.save(new Blob(["ab"]), "sub-mock_desc-predictionsCamTop_pose.slp", mock(predictions));
    expect(saved.ref).toEqual(mock("derivatives/sleap/sub-mock/beh/sub-mock_desc-labelsCamTop_pose.slp"));
  });

  it("finds no videos, and leaves links as they are", async () => {
    const storage = createMemoryStorage();
    const file = { url: "data:,x", fileType: "slp" as const, name: "x.slp" };
    expect(await storage.resolveVideo("video.mp4", mock("x.slp"))).toBe(null);
    expect(await storage.refreshUrl(file)).toBe(file);
  });
});
