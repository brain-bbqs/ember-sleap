// @vitest-environment jsdom
import { installDialogPolyfill, mountHtml, readIndexHtml } from "@brain-bbqs/test-utils/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { getElements } from "../../src/ui/elements";
import { createOverwritePrompt } from "../../src/ui/overwriteDialog";

const PATH = "derivatives/sleap/sub-01/beh/sub-01_desc-labelsCamTop_pose.slp";
let els: ReturnType<typeof getElements>["overwrite"];

beforeEach(() => {
  mountHtml(readIndexHtml());
  installDialogPolyfill();
  els = getElements().overwrite;
});

describe("createOverwritePrompt", () => {
  it.each<[string, () => void, string]>([
    ["Keep both, the default", () => els.form.dispatchEvent(new Event("submit", { cancelable: true })), "keep-both"],
    ["Replace", () => els.replace.click(), "replace"],
    ["Cancel", () => els.cancel.click(), "cancel"],
    ["dismissing the dialog (Escape)", () => els.dialog.close(), "cancel"],
  ])("names the labels file, and answers %s", async (_, answer, expected) => {
    const asked = createOverwritePrompt(els)(PATH);
    expect(els.dialog.open).toBe(true);
    expect(els.path.textContent).toBe(PATH);
    answer();
    expect(await asked).toBe(expected);
    expect(els.dialog.open).toBe(false);
  });

  it("forgets an earlier answer's buttons when asked again", async () => {
    const first = createOverwritePrompt(els)(PATH);
    els.replace.click();
    expect(await first).toBe("replace");
    const second = createOverwritePrompt(els)("other.slp");
    els.cancel.click();
    expect(await second).toBe("cancel");
  });
});
