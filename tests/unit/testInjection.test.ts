import { describe, expect, it } from "vitest";
import { fromHostRef } from "../../src/lib/hostRef";
import { filesByFolder, modelFilesProblem } from "../../src/lib/modelCatalogue";
import {
  MOCK_DANDISET_ID,
  MOCK_MODELS,
  MOCK_PREDICTIONS_PATH,
  MOCK_PROJECT_PATH,
  MOCK_VIDEO_PATHS,
  mockModelSource,
  mockNewProjectRequest,
  mockProjectRequest,
  mockProjectUrl,
  readTestInjection,
} from "../../src/lib/testInjection";

describe("readTestInjection", () => {
  it.each(["", "?mock_project", "?mock_predictions", "?mock_predictions_missing", "?foo=1&bar"])(
    "is null without ?test (%j)",
    (search) => {
      expect(readTestInjection(search)).toBe(null);
    },
  );

  const none = {
    mockProject: false,
    mockPredictions: false,
    mockPredictionsMissing: false,
    mockNewProject: false,
    standIn: false,
  };

  it("is a no-op plan for a bare ?test", () => {
    expect(readTestInjection("?test")).toEqual(none);
  });

  it.each([
    ["?test&mock_project", { ...none, mockProject: true, standIn: true }],
    ["?mock_project&test", { ...none, mockProject: true, standIn: true }],
    ["?test&mock_project&mock_predictions", { ...none, mockProject: true, mockPredictions: true, standIn: true }],
    ["?test&mock_predictions", { ...none, mockPredictions: true }],
    [
      "?test&mock_project&mock_predictions&mock_predictions_missing",
      { ...none, mockProject: true, mockPredictions: true, mockPredictionsMissing: true, standIn: true },
    ],
    ["?test&mock_new_project", { ...none, mockNewProject: true, standIn: true }],
    ["?test&stand_in", { ...none, standIn: true }],
  ])("reads the flags in %s", (search, plan) => {
    expect(readTestInjection(search)).toEqual(plan);
  });
});

describe("mockNewProjectRequest", () => {
  it("is a recognizably fake new project on two videos, belonging where its first one is", () => {
    const request = mockNewProjectRequest();
    expect(request.name).toBe("Untitled.slp");
    expect(request.videos.map((v) => v.storedPath)).toEqual(MOCK_VIDEO_PATHS);
    expect(request.videos.every((v) => v.fileType === "mp4" && v.url.startsWith("data:"))).toBe(true);
    expect(request.videos.map((v) => v.name)).toEqual([
      "sub-mock_test-injection-mock-video-1.mp4",
      "sub-mock_test-injection-mock-video-2.mp4",
    ]);
    expect(fromHostRef(request.ref)).toEqual({ dandisetId: MOCK_DANDISET_ID, path: MOCK_VIDEO_PATHS[0] });
  });
});

describe("MOCK_PREDICTIONS_PATH", () => {
  it("is where inference on the mock project writes, beside its labels file", () => {
    expect(MOCK_PREDICTIONS_PATH).toBe(
      "derivatives/sleap/sub-mock/beh/sub-mock_desc-predictionsTestInjectionMockProject_pose.slp",
    );
  });
});

describe("mockProjectRequest", () => {
  it("is a recognizably fake project at a location the archive could never issue", () => {
    const request = mockProjectRequest();
    expect(request.name).toContain("test-injection");
    expect(request.fileType).toBe("slp");
    expect(fromHostRef(request.ref)).toEqual({ dandisetId: MOCK_DANDISET_ID, path: MOCK_PROJECT_PATH });
    expect(/^\d{6}$/.test(MOCK_DANDISET_ID)).toBe(false);
  });

  it("serves fixed bytes from a data: URL that starts with the HDF5 signature", async () => {
    const request = mockProjectRequest();
    expect(request.url.startsWith("data:application/octet-stream;base64,")).toBe(true);
    const bytes = new Uint8Array(await (await fetch(request.url)).arrayBuffer());
    expect(bytes.length).toBe(2048);
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.subarray(8).every((b) => b === 0)).toBe(true);
    expect(mockProjectRequest().url).toBe(request.url);
    expect(mockProjectUrl()).toBe(request.url);
  });
});

describe("mockModelSource", () => {
  it("lists the fixed models, as a copy", async () => {
    const listed = await mockModelSource.list({});
    expect(listed).toEqual([...MOCK_MODELS]);
    expect(listed).not.toBe(MOCK_MODELS);
    expect(listed.every((card) => card.name.startsWith("Test injection"))).toBe(true);
  });

  it("holds a single-folder model and a top-down one with a folder per head, each as a source must list it", () => {
    expect(MOCK_MODELS.map((card) => [card.id, [...filesByFolder(card.files).keys()]])).toEqual([
      ["mock:single-instance", [""]],
      ["mock:top-down", ["centroid", "centered_instance"]],
    ]);
    expect(MOCK_MODELS.map((card) => modelFilesProblem(card.heads, card.files))).toEqual([null, null]);
  });
});
