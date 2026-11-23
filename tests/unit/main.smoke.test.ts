// @vitest-environment jsdom
// Boots the real src/main.ts against the real index.html markup with every network call failing,
// and drives the shell end to end (version stamp, theme toggle, What's New modal) and the picker's
// signed-out, offline behaviour. Besides covering main.ts's wiring, this guards the
// index.html/elements.ts id contract: getShell() and getElements() throw on import if any
// registered id is missing from the page.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { throwingStorage, type FetchRouter } from "@brain-bbqs/test-utils/vitest";
import { countChangelogVersions } from "@brain-bbqs/ui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { OAUTH_CLIENT_ID } from "../../src/lib/oauth";
import { STORAGE_KEY, THEME_KEY } from "../../src/lib/settings";
import { bootMain, el } from "./helpers/mainHarness";

const WHATS_NEW_RECENT_VERSIONS = 3;
let fetchMock: FetchRouter;

// The real PKCE client, with the browser navigation it ends in recorded instead (jsdom has none).
const navigations = vi.hoisted(() => [] as string[]);
vi.mock("../../src/lib/oauth", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/oauth")>();
  return {
    ...real,
    createOAuth: () => {
      const client = real.createOAuth();
      return { ...client, startLogin: () => client.startLogin((url) => void navigations.push(url)) };
    },
  };
});

beforeAll(async () => {
  fetchMock = (await bootMain()).fetch!;
});

function submitDandiset(value: string): void {
  el<HTMLInputElement>("dandiset-input").value = value;
  el("open-form").dispatchEvent(new Event("submit", { cancelable: true }));
}

describe("main.ts boot", () => {
  it("stamps the version into the footer link", () => {
    expect(el("version-indicator").textContent).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it("opens on the EMBER picker, signed out, with nothing mounted", () => {
    expect(el("open-card").hidden).toBe(false);
    expect(el("app-card").hidden).toBe(true);
    expect(el("sleap-root").children.length).toBe(0);
    expect(el("oauthSigninBtn").hidden).toBe(false);
    expect(el("oauthSignedIn").hidden).toBe(true);
    expect(el<HTMLInputElement>("dandiset-input").value).toBe("");
  });

  it("sends sign-in to EMBER's authorize page as ember-sleap, to come back to this page", async () => {
    el("oauthSigninBtn").click();
    await vi.waitFor(() => expect(navigations).toHaveLength(1));
    const authorize = new URL(navigations[0]);
    expect(`${authorize.origin}${authorize.pathname}`).toBe("https://api-dandi.emberarchive.org/oauth/authorize/");
    expect(authorize.searchParams.get("client_id")).toBe(OAUTH_CLIENT_ID);
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${location.origin}${location.pathname}`);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(el("open-status").textContent).toBe("");
  });

  it("asks for a dandiset id when the field holds none", () => {
    submitDandiset("not a dandiset");
    expect(el("open-status").textContent).toBe("Enter a dandiset id, such as 000398.");
  });

  it("remembers the dandiset asked for, and reports the archive being unreachable", async () => {
    submitDandiset("https://dandi.emberarchive.org/dandiset/000398");
    expect(el("open-status").textContent).toBe("Listing the projects in dandiset 000398…");
    await vi.waitFor(() => expect(el("open-status").textContent).toMatch(/^Network error calling/));
    expect(el("open-status").classList.contains("err")).toBe(true);
    expect(el("project-list").hidden).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ dandisetId: "000398" });
    expect(fetchMock.callsTo("/dandisets/000398/").length).toBeGreaterThan(0);
  });

  it("flips the theme from the header toggle and remembers the choice", () => {
    el("theme-toggle").click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    el("theme-toggle").click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("still flips the theme when storage refuses the write, and warns rather than throws", () => {
    const restoreStorage = throwingStorage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      el("theme-toggle").click();
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(warn).toHaveBeenCalledWith("Could not save theme preference:", expect.any(Error));
    } finally {
      restoreStorage();
      warn.mockRestore();
    }
  });

  it("renders the changelog into the What's New modal", () => {
    const changelog = readFileSync(resolve(process.cwd(), "CHANGELOG.md"), "utf-8");
    const rendered = el("whats-new-content").querySelectorAll(".changelog-version");
    expect(rendered.length).toBe(Math.min(countChangelogVersions(changelog), WHATS_NEW_RECENT_VERSIONS));
  });

  it("opens and closes the modal from the footer, tracking the #changelog fragment", async () => {
    const modal = el<HTMLDialogElement>("whats-new-modal");
    el("whats-new-button").click();
    expect(modal.open).toBe(true);
    expect(window.location.hash).toBe("#changelog");
    el("whats-new-close").click();
    expect(modal.open).toBe(false);
    await vi.waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("lets the page unload freely with nothing open", () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
