import { describe, expect, it } from "vitest";
import { fromHostRef, toHostRef } from "../../src/lib/hostRef";

describe("toHostRef / fromHostRef", () => {
  it("round-trips a dandiset and a path, colons in the path included", () => {
    const location = { dandisetId: "000398", path: "sub-NONE/odd:name.slp" };
    const ref = toHostRef(location);
    expect(ref).toEqual({ key: "ember:000398:sub-NONE/odd:name.slp" });
    expect(fromHostRef(ref)).toEqual(location);
  });

  it.each([
    ["no ref", undefined],
    ["another scheme", { key: "file:/tmp/labels.slp" }],
    ["no separator", { key: "ember:000398" }],
    ["an empty dandiset", { key: "ember::sub-01/labels.slp" }],
    ["an empty path", { key: "ember:000398:" }],
  ])("reads %s as no EMBER location", (_, ref) => {
    expect(fromHostRef(ref)).toBe(null);
  });
});
