// @vitest-environment jsdom
import { installDialogPolyfill, mountHtml, readIndexHtml } from "@brain-bbqs/test-utils/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { getElements } from "../../src/ui/elements";
import { createEntitiesPrompt } from "../../src/ui/entitiesDialog";

let els: ReturnType<typeof getElements>["entities"];

beforeEach(() => {
  mountHtml(readIndexHtml());
  installDialogPolyfill();
  els = getElements().entities;
});

function submit(): void {
  els.form.dispatchEvent(new Event("submit", { cancelable: true }));
}

describe("createEntitiesPrompt", () => {
  it("names the source, and resolves to the subject and session typed", async () => {
    const asked = createEntitiesPrompt(els)("raw/session1/labels.slp");
    expect(els.dialog.open).toBe(true);
    expect(els.source.textContent).toBe("raw/session1/labels.slp");
    els.sub.value = " 01 ";
    els.ses.value = "baseline";
    submit();
    expect(await asked).toEqual({ sub: "01", ses: "baseline" });
    expect(els.dialog.open).toBe(false);
  });

  it("leaves the session out when none is given, and clears what the last ask left", async () => {
    els.sub.value = "stale";
    const asked = createEntitiesPrompt(els)("labels.slp");
    expect(els.sub.value).toBe("");
    els.sub.value = "mouse7";
    submit();
    expect(await asked).toEqual({ sub: "mouse7" });
  });

  it("stays open on a label BIDS would refuse", async () => {
    const asked = createEntitiesPrompt(els)("labels.slp");
    els.sub.value = "mouse-7";
    submit();
    expect(els.dialog.open).toBe(true);
    els.sub.value = "mouse7";
    els.ses.value = "day_1";
    submit();
    expect(els.dialog.open).toBe(true);
    els.ses.value = "day1";
    submit();
    expect(await asked).toEqual({ sub: "mouse7", ses: "day1" });
  });

  it("resolves to null on Cancel", async () => {
    const asked = createEntitiesPrompt(els)("labels.slp");
    els.cancel.click();
    expect(await asked).toBeNull();
    expect(els.dialog.open).toBe(false);
  });

  it("resolves to null when the dialog is dismissed (Escape)", async () => {
    const asked = createEntitiesPrompt(els)("labels.slp");
    els.dialog.close();
    expect(await asked).toBeNull();
  });
});
