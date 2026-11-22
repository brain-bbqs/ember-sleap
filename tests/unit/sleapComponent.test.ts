// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadSleapComponent } from "../../src/ui/sleapComponent";
import { mountStandIn, STAND_IN_VERSION } from "../../src/ui/sleapStandIn";

describe("loadSleapComponent", () => {
  it("loads the stand-in until @talmolab/sleap-app is published", async () => {
    const component = await loadSleapComponent();
    expect(component).toEqual({ mountSleapApp: mountStandIn, version: STAND_IN_VERSION, standIn: true });
  });
});
