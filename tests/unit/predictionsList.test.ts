// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { EmberLocation } from "../../src/lib/hostRef";
import { createPredictionsList, type PredictionsElements } from "../../src/ui/predictionsList";

const FOLDER = "derivatives/sleap/sub-01/beh";
const TOP: EmberLocation = { dandisetId: "000123", path: `${FOLDER}/sub-01_desc-predictionsCamTop_pose.slp` };
const SIDE: EmberLocation = { dandisetId: "000123", path: `${FOLDER}/sub-01_desc-predictionsCamSide_pose.slp` };

function setup() {
  const els: PredictionsElements = {
    section: document.createElement("div"),
    list: document.createElement("ul"),
    status: document.createElement("p"),
    retry: document.createElement("button"),
  };
  els.section.hidden = true;
  els.retry.hidden = true;
  // In the document, so focus moves as it would on the page.
  els.section.append(els.list, els.status, els.retry);
  document.body.replaceChildren(els.section);
  const onOpen = vi.fn<(file: EmberLocation) => void>();
  const list = createPredictionsList(els, onOpen);
  const buttons = () => [...els.list.querySelectorAll<HTMLButtonElement>("button.predictions-open")];
  return { els, onOpen, list, buttons };
}

describe("createPredictionsList", () => {
  it("lists each file as a button naming its path that opens it, and shows the list", () => {
    const { els, onOpen, list, buttons } = setup();
    list.add([TOP, SIDE]);
    expect(els.section.hidden).toBe(false);
    expect(buttons().map((b) => [b.textContent, b.dataset.path, b.type])).toEqual([
      [TOP.path, TOP.path, "button"],
      [SIDE.path, SIDE.path, "button"],
    ]);
    buttons()[1].click();
    expect(onOpen).toHaveBeenCalledWith(SIDE);
  });

  it("lists a file reported again once, keeping the order it was first listed in", () => {
    const { list, buttons } = setup();
    list.add([TOP]);
    list.add([SIDE, TOP]);
    list.add([{ ...TOP, dandisetId: "000999" }]);
    expect(buttons().map((b) => b.textContent)).toEqual([TOP.path, SIDE.path, TOP.path]);
  });

  it("stays hidden when nothing is listed", () => {
    const { els, list } = setup();
    list.add([]);
    expect(els.section.hidden).toBe(true);
  });

  it("says a file is opening, then clears that once it has", () => {
    const { els, list } = setup();
    list.add([TOP]);
    list.opening(TOP);
    expect(els.status.textContent).toBe(`Opening ${TOP.path}…`);
    expect(els.retry.hidden).toBe(true);
    list.done();
    expect(els.status.textContent).toBe("");
  });

  it("says why a file did not open, with a button that tries it again until another open starts", () => {
    const { els, onOpen, list } = setup();
    list.add([TOP, SIDE]);
    list.failed(TOP, "Not there yet.");
    expect(els.status.textContent).toBe("Not there yet.");
    expect(els.status.classList.contains("err")).toBe(true);
    expect(els.retry.hidden).toBe(false);
    els.retry.click();
    expect(onOpen).toHaveBeenLastCalledWith(TOP);

    list.opening(SIDE);
    expect(els.status.classList.contains("err")).toBe(false);
    expect(els.retry.hidden).toBe(true);
    onOpen.mockClear();
    els.retry.click();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("moves keyboard focus from a hidden Try again to the file it was for, so it is not lost", () => {
    const { els, list, buttons } = setup();
    list.add([TOP, SIDE]);
    list.failed(SIDE, "Not there yet.");
    els.retry.focus();
    list.opening(SIDE);
    expect(document.activeElement).toBe(buttons()[1]);

    list.failed(SIDE, "Still not there.");
    expect(els.retry.hidden).toBe(false);
    els.retry.focus();
    list.done();
    expect(document.activeElement).toBe(buttons()[1]);
  });

  it("leaves focus where it is when Try again hides without having it", () => {
    const { els, list, buttons } = setup();
    list.add([TOP, SIDE]);
    list.failed(SIDE, "Not there yet.");
    buttons()[0].focus();
    list.opening(TOP);
    expect(document.activeElement).toBe(buttons()[0]);
    expect(els.retry.hidden).toBe(true);
  });

  it("empties and hides itself when cleared, so the same file lists again later", () => {
    const { els, list, buttons } = setup();
    list.add([TOP]);
    list.failed(TOP, "Not there yet.");
    list.clear();
    expect(els.section.hidden).toBe(true);
    expect(buttons()).toEqual([]);
    expect(els.status.textContent).toBe("");
    expect(els.retry.hidden).toBe(true);
    list.add([TOP]);
    expect(buttons().map((b) => b.textContent)).toEqual([TOP.path]);
  });
});
