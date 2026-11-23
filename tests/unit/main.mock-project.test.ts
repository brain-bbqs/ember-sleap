// @vitest-environment jsdom
// `?test&mock_project`: the page boots straight into the embedded app on a synthesized project,
// with in-memory saves, and nothing reaching the network.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MOCK_PROJECT_PATH } from "../../src/lib/testInjection";
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
  });

  it("comes back to the SLEAP app's start screen once the project is closed", async () => {
    await vi.waitFor(() => expect(role("start").hidden).toBe(false));
    expect(el("sleap-root").querySelectorAll(".sleap-app")).toHaveLength(1);
    expect(role("project").hidden).toBe(true);
  });
});
