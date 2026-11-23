// @vitest-environment jsdom
// `?test&mock_new_project`: the page boots straight into a new project on two synthesized videos,
// as choosing a dandiset with no SLEAP project does, with in-memory saves and nothing reaching the
// network; saving writes the new project's own `.slp`, placed where EMBER storage would place it.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MOCK_VIDEO_PATHS } from "../../src/lib/testInjection";
import { bootMain, el, role } from "./helpers/mainHarness";

const SAVED = "derivatives/sleap/sub-mock/beh/sub-mock_desc-labelsTestInjectionMockVideo1_pose.slp";

beforeAll(async () => {
  await bootMain({ url: "?test&mock_new_project", fetch: () => Promise.reject(new TypeError("offline")) });
  await vi.waitFor(() => expect(role("file-type").textContent).toBe("new project"));
});

describe("?test&mock_new_project", () => {
  it("starts the new project on its two videos, unsaved", () => {
    expect(el("project-title").textContent).toBe("Untitled.slp");
    expect(el("project-location").textContent).toBe("Test injection · new project on 2 videos");
    expect([...role("video-list").querySelectorAll("button")].map((b) => b.textContent)).toEqual([...MOCK_VIDEO_PATHS]);
    expect(role("dirty").hidden).toBe(false);
    expect(el<HTMLDialogElement>("open-dialog").open).toBe(false);
  });

  it("saves a real .slp of its own beside its first video", async () => {
    role("save").click();
    await vi.waitFor(() => expect(el("host-status").textContent).toBe(`Saved in memory (test injection): ${SAVED}`), {
      timeout: 10_000,
    });
    expect(role("save-status").textContent).toMatch(/^Saved \d/);
    expect(role("dirty").hidden).toBe(true);
  });
});
