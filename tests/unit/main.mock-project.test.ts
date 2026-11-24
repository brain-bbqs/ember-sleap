// @vitest-environment jsdom
// `?test&mock_project`: the page boots straight into the embedded app on a synthesized project,
// with in-memory saves, fixed models and the compute stub, and nothing reaching the network.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MOCK_MODELS, MOCK_PREDICTIONS_PATH, MOCK_PROJECT_PATH } from "../../src/lib/testInjection";
import { bootMain, el, role } from "./helpers/mainHarness";

beforeAll(async () => {
  // data: URLs are the one thing the mock project reads; everything else must stay offline.
  const realFetch = globalThis.fetch;
  const offline: typeof fetch = (input, init) =>
    input instanceof Request || !String(input).startsWith("data:")
      ? Promise.reject(new TypeError("offline"))
      : realFetch(input, init);
  await bootMain({
    url: "?test&mock_project",
    fetch: offline,
    // The harness mounts index.html's body only; the title is what the app must leave alone.
    beforeImport: () => void (document.title = "EMBER SLEAP"),
  });
  await vi.waitFor(() => expect(role("file-probe").textContent).toMatch(/HDF5 signature/));
});

afterEach(() => vi.restoreAllMocks());

describe("?test&mock_project", () => {
  it("opens the mock project in the embedded app, leaving the page's title alone", () => {
    expect(el<HTMLDialogElement>("open-dialog").open).toBe(false);
    expect(role("project").hidden).toBe(false);
    expect(el("close-project-btn").hidden).toBe(false);
    expect(el("project-title").textContent).toBe("test-injection-mock-project.slp");
    expect(el("project-location").textContent).toBe(`Test injection · ${MOCK_PROJECT_PATH}`);
    expect(document.title).toBe("EMBER SLEAP");
    expect(el("predictions").hidden).toBe(true);
  });

  it("offers only the page's compute, not Local or SLEAP Connect", () => {
    const options = [...role<HTMLSelectElement>("backend").options].map((o) => o.value);
    expect(options).toEqual(["host"]);
  });

  it("saves into derivatives/sleap/ in memory and says where", async () => {
    role("edit").click();
    role("save").click();
    await vi.waitFor(() =>
      expect(el("host-status").textContent).toBe(
        "Saved in memory (test injection): derivatives/sleap/sub-mock/beh/sub-mock_desc-labelsTestInjectionMockProject_pose.slp",
      ),
    );
  });

  it("lists the fixed models, a top-down one among them", async () => {
    role("list-models").click();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-role="predict"]').length).toBe(MOCK_MODELS.length));
    expect(role("models").textContent).toContain("Test injection model (top-down) centroid, centered_instance");
  });

  it("runs a training job on the stub, on what the save wrote, and streams it into the job view", async () => {
    role("train").click();
    await vi.waitFor(() => expect(role("job-state").textContent).toBe("completed"), { timeout: 5000 });
    expect(role("job-log").textContent).toContain("Input: sub-mock_desc-labelsTestInjectionMockProject_pose.slp (slp)");
    expect(role("job-log").textContent).not.toContain("Input: test-injection-mock-project.slp");
  });

  it("lists the model it trained beside the fixed ones, and predicts with it", async () => {
    role("list-models").click();
    const predicts = () => document.querySelectorAll<HTMLButtonElement>('[data-role="predict"]');
    await vi.waitFor(() => expect(predicts().length).toBe(MOCK_MODELS.length + 1));
    expect(role("models").textContent).toContain("stub-model-1 (trained here on the stub)");
    predicts()[MOCK_MODELS.length].click();
    await vi.waitFor(() => expect(role("job-id").textContent).toBe("Job stub-2"));
    await vi.waitFor(() => expect(role("job-state").textContent).toBe("completed"), { timeout: 5000 });
    expect(role("job-log").textContent).toContain("Model: ember:mock/stub-model-1");
    expect(role("job-log").textContent).toContain(MOCK_PREDICTIONS_PATH);
  });

  it("lists the predictions that inference wrote under the app", () => {
    expect(el("predictions").hidden).toBe(false);
    const listed = [...el("predictions-list").querySelectorAll("button")];
    expect(listed.map((b) => b.textContent)).toEqual([MOCK_PREDICTIONS_PATH]);
  });

  it("trains on unsaved edits offline, keeping them in memory as a training package first", async () => {
    role("edit").click();
    role("train").click();
    const name = /sub-mock_desc-trainingsetTestInjectionMockProject\d{14}_pose\.pkg\.slp/;
    await vi.waitFor(() =>
      expect(el("host-status").textContent).toMatch(
        new RegExp(`^Saved in memory \\(test injection\\): derivatives/sleap/sub-mock/beh/${name.source}$`),
      ),
    );
    await vi.waitFor(() => expect(role("job-id").textContent).toBe("Job stub-3"));
    await vi.waitFor(() => expect(role("job-state").textContent).toBe("completed"), { timeout: 5000 });
    expect(role("job-log").textContent).toMatch(new RegExp(`Input: ${name.source} \\(pkg\\.slp\\)`));
    expect(role("dirty").hidden).toBe(false);
  });

  it("predicts with the top-down model, fetching both of its model folders", async () => {
    role("list-models").click();
    const predicts = () => document.querySelectorAll<HTMLButtonElement>('[data-role="predict"]');
    // Beside the models trained by the two training jobs so far.
    await vi.waitFor(() => expect(predicts().length).toBe(MOCK_MODELS.length + 2));
    expect(role("models").textContent).toContain("from EMBER dandiset mock");
    predicts()[1].click();
    await vi.waitFor(() => expect(role("job-id").textContent).toBe("Job stub-4"));
    await vi.waitFor(() => expect(role("job-state").textContent).toBe("completed"), { timeout: 5000 });
    const log = role("job-log").textContent;
    expect(log).toContain("Model: mock:top-down\n  model folder centroid: config data:,mock-centroid-config;");
    expect(log).toContain("  model folder centered_instance: config data:,mock-centered-instance-config;");
  });

  it("guards unload, and asks before closing, while the project has edits", () => {
    role("edit").click();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    el("close-project-btn").click();
    expect(confirm).toHaveBeenCalledWith("Close the project without saving your changes?");
    expect(el("close-project-btn").hidden).toBe(false);

    confirm.mockReturnValue(true);
    el("close-project-btn").click();
    expect(el("close-project-btn").hidden).toBe(true);
    expect(el("project-title").textContent).toBe("");
    expect(el("project-location").textContent).toBe("No project open");
    expect(el("predictions").hidden).toBe(true);
    expect(el("predictions-list").children.length).toBe(0);
  });

  it("comes back to the SLEAP app's start screen once the project is closed", async () => {
    await vi.waitFor(() => expect(role("start").hidden).toBe(false));
    expect(el("sleap-root").querySelectorAll(".sleap-app")).toHaveLength(1);
    expect(role("project").hidden).toBe(true);
  });
});
