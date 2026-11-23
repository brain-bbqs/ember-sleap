import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsStore, STORAGE_KEY } from "../../src/lib/settings";

const { name } = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8")) as { name: string };

// The app's part is the key, which the page and the pre-paint script have to share. The page is
// dark only, so it stores no theme.
describe("storage key", () => {
  it("is namespaced by this app's package name", () => {
    expect(STORAGE_KEY).toBe(`${name}.settings.v1`);
  });
});

describe("settingsStore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the dandiset and tokens as one JSON record under STORAGE_KEY", () => {
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    });
    const record = { dandisetId: "000398", oauth: { accessToken: "t", expiresAt: 1 } };
    settingsStore.save(record);
    expect(JSON.parse(items.get(STORAGE_KEY) ?? "null")).toEqual(record);
    expect(settingsStore.load()).toEqual(record);
  });
});
