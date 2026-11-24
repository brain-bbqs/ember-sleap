// @vitest-environment jsdom
// `?test&mock_project&mock_predictions`: the page boots into the embedded app on the mock project
// and runs inference on it through the host and the compute stub, so its predictions are listed as a
// finished job's are, and opening and proofreading them runs offline, saving in memory.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MOCK_PREDICTIONS_PATH, MOCK_PROJECT_PATH } from "../../src/lib/testInjection";
import { bootMain, el, role } from "./helpers/mainHarness";

const hosts = new Set<string>();

beforeAll(async () => {
  const realFetch = globalThis.fetch;
  const offline: typeof fetch = (input, init) => {
    const url = String(input);
    if (!url.startsWith("data:")) {
      hosts.add(url);
      return Promise.reject(new TypeError("offline"));
    }
    return realFetch(input, init);
  };
  await bootMain({ url: "?test&mock_project&mock_predictions", fetch: offline });
  // The stub plays the job's events a tick at a time.
  await vi.waitFor(() => expect(el("predictions").hidden).toBe(false), { timeout: 5000 });
});

describe("?test&mock_project&mock_predictions", () => {
  it("lands on the open mock project with its predictions listed", () => {
    expect(el("project-location").textContent).toBe(`Test injection · ${MOCK_PROJECT_PATH}`);
    expect(role("file-probe").textContent).toMatch(/HDF5 signature/);
    const listed = [...el("predictions-list").querySelectorAll("button")];
    expect(listed.map((b) => [b.textContent, b.dataset.path])).toEqual([
      [MOCK_PREDICTIONS_PATH, MOCK_PREDICTIONS_PATH],
    ]);
    expect(el("predictions-status").textContent).toBe("");
    expect(el("predictions-retry").hidden).toBe(true);
  });

  it("opens the predictions in place of the project, offline", async () => {
    el("predictions-list").querySelector("button")!.click();
    await vi.waitFor(() =>
      expect(el("project-title").textContent).toBe("sub-mock_desc-predictionsTestInjectionMockProject_pose.slp"),
    );
    expect(el("project-location").textContent).toBe(`Test injection · ${MOCK_PREDICTIONS_PATH}`);
    await vi.waitFor(() => expect(role("file-probe").textContent).toMatch(/HDF5 signature/));
    expect(el("predictions").hidden).toBe(false);
  });

  it("saves the proofread predictions as labels beside them, leaving the predictions alone", async () => {
    role("edit").click();
    role("save").click();
    await vi.waitFor(() =>
      expect(el("host-status").textContent).toBe(
        "Saved in memory (test injection): derivatives/sleap/sub-mock/beh/sub-mock_desc-labelsTestInjectionMockProject_pose.slp",
      ),
    );
    expect(role("dirty").hidden).toBe(true);
    expect([...hosts]).toEqual([]);
  });
});
