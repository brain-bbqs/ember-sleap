import { describe, expect, it } from "vitest";
import { notOnEmberYet } from "../../src/lib/emberStorage";
import { toHostRef } from "../../src/lib/hostRef";
import { createMemoryStorage } from "../../src/lib/memoryStorage";
import { mockProjectUrl } from "../../src/lib/testInjection";

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

  it("keeps a training package beside the project, named for the time it was sent", async () => {
    const storage = createMemoryStorage({ now: () => new Date("2026-11-22T15:30:00Z") });
    const path = "derivatives/sleap/sub-mock/beh/sub-mock_desc-trainingsetCamTop20261122153000_pose.pkg.slp";
    const { ref, file } = await storage.saveTrainingPackage(new Blob(["abcd"]), mock("cam-top.slp"));
    expect(ref).toEqual(mock(path));
    expect(file).toEqual({
      url: `memory://mock/${path}?save=1`,
      fileType: "pkg.slp",
      name: "sub-mock_desc-trainingsetCamTop20261122153000_pose.pkg.slp",
    });
    expect(storage.saved).toEqual([{ path, size: 4 }]);
  });

  it("names two packages sent within one second apart, as EMBER storage does", async () => {
    const storage = createMemoryStorage({ now: () => new Date("2026-11-22T15:30:00Z") });
    const first = await storage.saveTrainingPackage(new Blob([]), mock("sub-01/cam.slp"));
    const second = await storage.saveTrainingPackage(new Blob([]), mock("sub-01/cam.slp"));
    expect([first.file.name, second.file.name]).toEqual([
      "sub-01_desc-trainingsetCam20261122153000_pose.pkg.slp",
      "sub-01_desc-trainingsetCam20261122153001_pose.pkg.slp",
    ]);
  });

  it("names a training package by the clock when none is given", async () => {
    const storage = createMemoryStorage();
    const { file } = await storage.saveTrainingPackage(new Blob([]), mock("sub-01/x.slp"));
    expect(file.name).toMatch(/^sub-01_desc-trainingsetX\d{14}_pose\.pkg\.slp$/);
  });

  it.each([
    ["a save", (storage: ReturnType<typeof createMemoryStorage>) => storage.save(new Blob([]), "x.slp")],
    [
      "a training package",
      (storage: ReturnType<typeof createMemoryStorage>) => storage.saveTrainingPackage(new Blob([])),
    ],
  ])("refuses %s for a project with no EMBER location", async (_, write) => {
    const storage = createMemoryStorage();
    await expect(write(storage)).rejects.toThrow("Only a project opened from EMBER");
    expect(storage.saved).toEqual([]);
  });

  describe("openPath", () => {
    const predictions = "derivatives/sleap/sub-mock/beh/sub-mock_desc-predictionsCamTop_pose.slp";

    it("serves a synthesized project, like the mock one, for the predictions the stub reported", async () => {
      expect(await createMemoryStorage().openPath("mock", predictions)).toEqual({
        url: mockProjectUrl(),
        fileType: "slp",
        name: "sub-mock_desc-predictionsCamTop_pose.slp",
        ref: mock(predictions),
      });
    });

    it("opens a package as a package", async () => {
      const path = predictions.replace(".slp", ".pkg.slp");
      expect((await createMemoryStorage().openPath("mock", path)).fileType).toBe("pkg.slp");
    });

    it("saves proofread predictions as labels beside them, never over them", async () => {
      const storage = createMemoryStorage();
      const { ref, name } = await storage.openPath("mock", predictions);
      const saved = await storage.save(new Blob(["ab"]), name, ref);
      expect(saved.ref).toEqual(mock("derivatives/sleap/sub-mock/beh/sub-mock_desc-labelsCamTop_pose.slp"));
      expect(storage.saved.map((s) => s.path)).not.toContain(predictions);
    });

    it.each([{}, { unwritten: true }])(
      "refuses a path naming no SLEAP project, as EMBER storage does (%j)",
      async (options) => {
        await expect(createMemoryStorage(options).openPath("mock", "sub-mock/video.mp4")).rejects.toThrow(
          "sub-mock/video.mp4 is not a SLEAP project (.slp or .pkg.slp).",
        );
      },
    );

    it("finds nothing there when told the files are not written yet, as EMBER says before a worker writes them", async () => {
      await expect(createMemoryStorage({ unwritten: true }).openPath("mock", predictions)).rejects.toThrow(
        notOnEmberYet(predictions),
      );
    });
  });

  it("finds no videos, leaves links as they are, and describes none as an archive asset", async () => {
    const storage = createMemoryStorage();
    const file = { url: "data:,x", fileType: "slp" as const, name: "x.slp" };
    expect(await storage.resolveVideo("video.mp4", mock("x.slp"))).toBe(null);
    expect(await storage.refreshUrl(file)).toBe(file);
    const { file: saved } = await storage.save(new Blob([]), "x.slp", mock("sub-01/x.slp"));
    expect(storage.describe(saved.url)).toBe(null);
  });
});
