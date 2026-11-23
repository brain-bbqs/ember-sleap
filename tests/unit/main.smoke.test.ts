// @vitest-environment jsdom
// Boots the real src/main.ts against the real index.html markup with every network call failing,
// and drives the shell end to end (version stamp, theme toggle), the SLEAP app's start screen, and
// the project picker's signed-out, offline behaviour. Besides covering main.ts's wiring, this guards the
// index.html/elements.ts id contract: getShell() and getElements() throw on import if any
// registered id is missing from the page.
import { throwingStorage, type FetchRouter } from "@brain-bbqs/test-utils/vitest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { OAUTH_CLIENT_ID } from "../../src/lib/oauth";
import { STORAGE_KEY, THEME_KEY } from "../../src/lib/settings";
import { bootMain, el, role } from "./helpers/mainHarness";

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
  // The app mounts at boot, once its component has loaded.
  await vi.waitFor(() => role("start"));
});

function submitDandiset(value: string): void {
  el<HTMLInputElement>("dandiset-input").value = value;
  el("open-form").dispatchEvent(new Event("submit", { cancelable: true }));
}

describe("main.ts boot", () => {
  it("stamps the version into the EMBER bar's link", () => {
    expect(el("version-indicator").textContent).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it("opens on the SLEAP app's start screen, signed out, with no project open and no picker shown", () => {
    expect(role("start").hidden).toBe(false);
    expect(role("project").hidden).toBe(true);
    expect(el("sleap-root").querySelectorAll(".sleap-app")).toHaveLength(1);
    expect(el<HTMLDialogElement>("open-dialog").open).toBe(false);
    expect(el("project-location").textContent).toBe("No project open");
    expect(el("close-project-btn").hidden).toBe(true);
    expect(el("oauthSigninBtn").hidden).toBe(false);
    expect(el("oauthSignedIn").hidden).toBe(true);
    expect(el<HTMLInputElement>("dandiset-input").value).toBe("");
  });

  it("opens the picker for New Project… from the File menu, and closes it from its close button", () => {
    role("menu-file").click();
    role("menu-new").click();
    const dialog = el<HTMLDialogElement>("open-dialog");
    expect(dialog.open).toBe(true);
    expect(el("open-dialog-title").textContent).toBe("New project on EMBER");
    expect(el("list-projects-btn").textContent).toBe("Start project");
    expect(document.activeElement).toBe(el("dandiset-input"));
    el("open-dialog-close").click();
    expect(dialog.open).toBe(false);
  });

  it("opens the picker for Open Project from the start screen", () => {
    role("start-open").click();
    expect(el<HTMLDialogElement>("open-dialog").open).toBe(true);
    expect(el("open-dialog-title").textContent).toBe("Open a project from EMBER");
    expect(el("list-projects-btn").textContent).toBe("List projects");
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

  it("carries no footer and no What's New, since below its header the page is the SLEAP app", () => {
    expect(document.querySelector(".page-footer-bar")).toBeNull();
    expect(document.getElementById("whats-new-modal")).toBeNull();
  });

  it("revokes nothing on a sign-out with no account signed in", () => {
    const before = fetchMock.calls.length;
    el("oauthSignoutBtn").click();
    expect(el("oauthSigninBtn").hidden).toBe(false);
    expect(fetchMock.calls.slice(before).some((c) => c.url.includes("/oauth/revoke_token/"))).toBe(false);
  });

  it("lets the page unload freely with nothing open", () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
