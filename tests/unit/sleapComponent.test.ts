// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mountStandIn, STAND_IN_VERSION } from "../../src/ui/sleapStandIn";

// The setup file (helpers/standInComponent.ts) mounts the stand-in for every boot of main.ts; this
// file is about the loader itself.
const { loadSleapComponent, sleapAppBaseUrl } =
  await vi.importActual<typeof import("../../src/ui/sleapComponent")>("../../src/ui/sleapComponent");

describe("loadSleapComponent", () => {
  it("imports the SLEAP app from where the page serves it, and reports its version", async () => {
    const mountSleapApp = vi.fn();
    const importPackage = vi.fn(() => Promise.resolve({ mountSleapApp, version: "0.1.2" }));
    const component = await loadSleapComponent({ importPackage });
    expect(importPackage).toHaveBeenCalledWith(new URL("sleap-app/sleap-app.js", document.baseURI).href);
    expect(component).toEqual({ mountSleapApp, version: "0.1.2", standIn: false });
  });

  it("loads the stand-in when asked, importing no package", async () => {
    const importPackage = vi.fn();
    const component = await loadSleapComponent({ standIn: true, importPackage });
    expect(component).toEqual({ mountSleapApp: mountStandIn, version: STAND_IN_VERSION, standIn: true });
    expect(importPackage).not.toHaveBeenCalled();
  });
});

describe("sleapAppBaseUrl", () => {
  it("is the sleap-app folder beside the page, which the app also loads its own files from", () => {
    expect(sleapAppBaseUrl()).toBe(new URL("sleap-app/", document.baseURI).href);
    expect(sleapAppBaseUrl().endsWith("/sleap-app/")).toBe(true);
  });
});
