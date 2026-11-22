import { afterEach, describe, expect, it, vi } from "vitest";
import { base64ToBytes, blobToBase64, bytesToBase64 } from "../../src/lib/base64";

describe("base64", () => {
  it.each([
    [[], ""],
    [[0x89, 0x48, 0x44, 0x46], "iUhERg=="],
    [[0, 255, 1, 254, 2], "AP8B/gI="],
  ])("encodes %j as %j and back", (bytes, text) => {
    expect(bytesToBase64(new Uint8Array(bytes))).toBe(text);
    expect([...base64ToBytes(text)]).toEqual(bytes);
  });

  it("encodes more bytes than one call can take as arguments", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("encodes a Blob's bytes", async () => {
    expect(await blobToBase64(new Blob([new Uint8Array([0x89, 0x48, 0x44, 0x46])]))).toBe("iUhERg==");
  });

  it("throws on text that is not base64", () => {
    expect(() => base64ToBytes("not base64!")).toThrow();
  });

  describe("past the browser's longest string", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it.each([
      ["comes back empty, as Chromium's btoa does just short of it", () => ""],
      [
        "cannot be built, as beyond it",
        () => {
          throw new RangeError("Invalid string length");
        },
      ],
    ])("refuses labels whose base64 %s, saying what to do instead", (_, btoa) => {
      vi.stubGlobal("btoa", btoa);
      expect(() => bytesToBase64(new Uint8Array(3))).toThrow(
        new Error("These labels are too large to send inline (3 B): save the project, then train."),
      );
    });
  });
});
