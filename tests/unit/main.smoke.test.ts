// @vitest-environment jsdom
// Boots the real src/main.ts against the real index.html markup and checks the shell it wires: the
// version stamp, the one dark theme and the footer's marks. Besides covering main.ts's wiring, this
// guards the index.html/elements.ts id contract: getShell() throws on import if any registered id
// is missing from the page.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { bootMain, el } from "./helpers/mainHarness";

beforeAll(async () => {
  await bootMain();
});

describe("main.ts boot", () => {
  it("stamps the version into the footer's link to the source", () => {
    expect(el("version-indicator").textContent).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it("leads the header with SLEAP's logo, badged as an EMBER plugin", () => {
    const logo = document.querySelector<HTMLAnchorElement>(".site-header .plugin-logo")!;
    expect(logo.href).toBe("https://sleap.ai/");
    expect(logo.getAttribute("aria-label")).toBe("SLEAP, an EMBER plugin");
    expect(logo.querySelector(".plugin-logo-badge")?.getAttribute("src")).toMatch(/ember-badge\.svg$/);
  });

  it("is dark only, like the SLEAP app, with no theme toggle", () => {
    // The harness mounts index.html's body, so the theme pinned on its <html> is read from the file.
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf-8");
    expect(html).toMatch(/<html lang="en" data-theme="dark">/);
    expect(document.getElementById("theme-toggle")).toBeNull();
  });

  it("keeps the footer's version stamp and brand marks, but no What's New or issue links", () => {
    const footer = document.querySelector(".page-footer-bar")!;
    expect(footer.querySelector(".footer-left #version-indicator")).not.toBeNull();
    expect([...footer.querySelectorAll<HTMLAnchorElement>(".footer-brands a")].map((a) => a.href)).toEqual([
      "https://talmolab.org/",
      "https://centerforopenneuroscience.org/",
    ]);
    expect(footer.querySelectorAll("button")).toHaveLength(0);
    expect(document.getElementById("whats-new-modal")).toBeNull();
  });
});
