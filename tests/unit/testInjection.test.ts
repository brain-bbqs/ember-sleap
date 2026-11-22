import { describe, expect, it } from "vitest";
import { fromHostRef } from "../../src/lib/hostRef";
import { filesByFolder, modelFilesProblem } from "../../src/lib/modelCatalogue";
import {
  MOCK_DANDISET_ID,
  MOCK_MODELS,
  MOCK_PREDICTIONS_PATH,
  MOCK_PROJECT_PATH,
  mockModelSource,
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

  it("is a no-op plan for a bare ?test", () => {
    expect(readTestInjection("?test")).toEqual({
      mockProject: false,
      mockPredictions: false,
      mockPredictionsMissing: false,
    });
  });

  it.each([
    ["?test&mock_project", { mockProject: true, mockPredictions: false, mockPredictionsMissing: false }],
    ["?mock_project&test", { mockProject: true, mockPredictions: false, mockPredictionsMissing: false }],
    [
      "?test&mock_project&mock_predictions",
      { mockProject: true, mockPredictions: true, mockPredictionsMissing: false },
    ],
    ["?test&mock_predictions", { mockProject: false, mockPredictions: true, mockPredictionsMissing: false }],
    [
      "?test&mock_project&mock_predictions&mock_predictions_missing",
      { mockProject: true, mockPredictions: true, mockPredictionsMissing: true },
    ],
  ])("reads the flags in %s", (search, plan) => {
    expect(readTestInjection(search)).toEqual(plan);
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
