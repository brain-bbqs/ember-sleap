// @vitest-environment jsdom
// A returning visitor whose stored access token has expired, with sign-in configured and refreshes
// the test answers by hand: one refresh however many calls need it, writes that leave another
// tab's tokens alone, following another tab through the storage event, and a refresh that lands
// after the tokens it started from are gone.
import { jsonResponse, routeFetch, type FetchRouter } from "@brain-bbqs/test-utils/vitest";
import type { OAuthTokenSet } from "@brain-bbqs/ember-client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../../src/lib/settings";
import { bootMain, el } from "./helpers/mainHarness";

const fakes = vi.hoisted(() => {
  const pending: { from: OAuthTokenSet; resolve: (t: OAuthTokenSet) => void; reject: (e: Error) => void }[] = [];
  const oauth = {
    startLogin: vi.fn(() => Promise.resolve()),
    // A sign-in redirect that fails (a stale state, say) leaves the stored tokens in charge.
    handleRedirectCallback: vi.fn(() => Promise.reject(new Error("state mismatch"))),
    // An expired set waits for the test to answer; any other is still fresh and comes straight back.
    ensureFreshToken: vi.fn((from: OAuthTokenSet) =>
      from.expiresAt > 0
        ? Promise.resolve(from)
        : new Promise<OAuthTokenSet>((resolve, reject) => pending.push({ from, resolve, reject })),
    ),
    revokeToken: vi.fn(() => Promise.resolve()),
  };
  return { oauth, pending };
});

vi.mock("../../src/lib/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/oauth")>()),
  createOAuth: () => fakes.oauth,
}));

const API = "https://api-dandi.emberarchive.org/api";
const LATER = Date.now() + 3_600_000;
const expired = (n: number): OAuthTokenSet => ({ accessToken: `old${n}`, refreshToken: `r${n}`, expiresAt: 0 });
const fresh = (n: number): OAuthTokenSet => ({ accessToken: `fresh${n}`, refreshToken: `s${n}`, expiresAt: LATER });

let fetchMock: FetchRouter;

const bearerOf = (init?: RequestInit) => new Headers(init?.headers).get("Authorization");
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What another tab does: write the stored record, which this tab hears about as a storage event. */
function otherTabWrites(record: object | null, key: string | null = STORAGE_KEY): void {
  if (record) localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  else localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

/** The refresh waiting for `from`, answered. */
function answer(from: OAuthTokenSet, outcome: OAuthTokenSet | Error): void {
  const index = fakes.pending.findIndex((p) => p.from.accessToken === from.accessToken);
  if (index < 0) throw new Error(`no refresh is waiting for ${from.accessToken}`);
  const [flight] = fakes.pending.splice(index, 1);
  if (outcome instanceof Error) flight.reject(outcome);
  else flight.resolve(outcome);
}

function submitDandiset(value: string): void {
  el<HTMLInputElement>("dandiset-input").value = value;
  el("open-form").dispatchEvent(new Event("submit", { cancelable: true }));
}

beforeAll(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock = routeFetch([
    {
      // The username is the token the lookup carried, so a test can see whose lookup was shown.
      match: `${API}/users/me/`,
      respond: (_url, init) => jsonResponse({ username: bearerOf(init)?.slice(7) ?? "anonymous", name: null }),
    },
    {
      match: `${API}/dandisets/?user=me`,
      respond: jsonResponse({ results: [{ identifier: "000123", draft_version: { name: "Lab" } }] }),
    },
    { match: /\/versions\/draft\/assets\/\?glob=/, respond: jsonResponse({ results: [] }) },
    { match: /\/versions\/draft\/$/, respond: jsonResponse({}) },
    { match: /\/dandisets\/\d{6}\/$/, respond: jsonResponse({}) },
  ]);
  await bootMain({
    url: "?dandiset=000123",
    fetch: fetchMock,
    localStorage: { [STORAGE_KEY]: JSON.stringify({ dandisetId: "000999", oauth: expired(1) }) },
  });
});

describe("tokens across refreshes, sign-out and other tabs", () => {
  it("refreshes an expired token once for every call that needs it at boot, and sends only the fresh one", async () => {
    expect(console.warn).toHaveBeenCalledWith("OAuth sign-in callback failed:", new Error("state mismatch"));
    expect(fakes.oauth.ensureFreshToken.mock.calls).toEqual([[expired(1)]]);
    expect(fetchMock.calls).toEqual([]);

    answer(expired(1), fresh(1));
    await vi.waitFor(() =>
      expect(el("open-status").textContent).toBe(
        "Dandiset 000123 holds no SLEAP projects, and no videos to start one from.",
      ),
    );
    await vi.waitFor(() => expect(el("dandiset-options").children.length).toBe(1));
    await vi.waitFor(() => expect(el("oauthUsername").textContent).toBe("fresh1"));
    expect(fakes.oauth.ensureFreshToken).toHaveBeenCalledTimes(1);
    expect(new Set(fetchMock.calls.map((c) => bearerOf(c.init)))).toEqual(new Set(["Bearer fresh1"]));
    expect(stored()).toEqual({ dandisetId: "000123", oauth: fresh(1) });
  });

  it("writes only the dandiset id when listing, leaving tokens another tab stored alone", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dandisetId: "000123", oauth: fresh(2) }));
    submitDandiset("000456");
    await vi.waitFor(() =>
      expect(el("open-status").textContent).toBe(
        "Dandiset 000456 holds no SLEAP projects, and no videos to start one from.",
      ),
    );
    expect(stored()).toEqual({ dandisetId: "000456", oauth: fresh(2) });
  });

  it("takes up the tokens another tab refreshed, and ignores events that change nothing it holds", async () => {
    otherTabWrites({ dandisetId: "000456", oauth: fresh(2) });
    await vi.waitFor(() => expect(el("oauthUsername").textContent).toBe("fresh2"));
    const lookups = fetchMock.callsTo("/users/me/").length;

    otherTabWrites({ dandisetId: "000456", oauth: fresh(2) });
    otherTabWrites({ dandisetId: "000456", oauth: fresh(2) }, "ember-sleap.some-other-key");
    await settle();
    expect(fetchMock.callsTo("/users/me/").length).toBe(lookups);
  });

  it("follows another tab signing out", async () => {
    otherTabWrites(null, null);
    expect(el("oauthSignedIn").hidden).toBe(true);
    expect(el("oauthSigninBtn").hidden).toBe(false);
    await vi.waitFor(() => expect(el("dandiset-options").children.length).toBe(0));
  });

  it("drops a refresh that lands after sign-out, revoking the token it brought back", async () => {
    otherTabWrites({ oauth: expired(3) });
    expect(el("oauthSignedIn").hidden).toBe(false);
    expect(fakes.pending.map((p) => p.from)).toEqual([expired(3)]);

    el("oauthSignoutBtn").click();
    expect(fakes.oauth.revokeToken).toHaveBeenLastCalledWith(expired(3));
    expect(stored()).toEqual({});

    answer(expired(3), fresh(3));
    await vi.waitFor(() => expect(fakes.oauth.revokeToken).toHaveBeenLastCalledWith(fresh(3)));
    // The identity and owner lookups that were waiting on the refresh run anonymously, and are dropped.
    await vi.waitFor(() => expect(bearerOf(fetchMock.callsTo("/dandisets/?user=me").at(-1)?.init)).toBeNull());
    await settle();
    expect(stored()).toEqual({});
    expect(el("oauthSignedIn").hidden).toBe(true);
    expect(el("oauthUsername").textContent).toBe("fresh2");
    expect(el("dandiset-options").children.length).toBe(0);
  });

  it("drops a refresh overtaken by another tab's newer tokens, and refreshes those on their own", async () => {
    otherTabWrites({ oauth: expired(4) });
    otherTabWrites({ oauth: expired(5) });
    expect(fakes.pending.map((p) => p.from)).toEqual([expired(4), expired(5)]);

    answer(expired(4), fresh(4));
    await vi.waitFor(() => expect(fakes.oauth.revokeToken).toHaveBeenLastCalledWith(fresh(4)));
    expect(stored()).toEqual({ oauth: expired(5) });

    answer(expired(5), fresh(5));
    await vi.waitFor(() => expect(el("oauthUsername").textContent).toBe("fresh5"));
    expect(stored()).toEqual({ oauth: fresh(5) });
  });

  it.each<[string, number, { oauth: OAuthTokenSet } | null]>([
    ["signs out", 7, null],
    ["refreshes", 8, { oauth: fresh(80) }],
  ])(
    "follows another tab that %s before its storage event arrives, instead of writing over it",
    async (_, n, otherTab) => {
      otherTabWrites({ oauth: expired(n) });
      expect(fakes.pending.map((p) => p.from)).toEqual([expired(n)]);
      if (otherTab) localStorage.setItem(STORAGE_KEY, JSON.stringify(otherTab));
      else localStorage.removeItem(STORAGE_KEY);

      answer(expired(n), fresh(n));
      await vi.waitFor(() => expect(fakes.oauth.revokeToken).toHaveBeenLastCalledWith(fresh(n)));
      expect(stored()).toEqual(otherTab);
      expect(el("oauthSignedIn").hidden).toBe(!otherTab);

      // The other tab's event, arriving late, changes nothing more.
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
      await settle();
      expect(stored()).toEqual(otherTab);
    },
  );

  it("keeps the old token when a refresh fails, and tries again on the next call", async () => {
    otherTabWrites({ oauth: expired(6) });
    answer(expired(6), new Error("invalid_grant"));
    await vi.waitFor(() => expect(el("oauthUsername").textContent).toBe("old6"));

    submitDandiset("000123");
    await vi.waitFor(() => expect(fakes.pending.map((p) => p.from)).toEqual([expired(6)]));
    answer(expired(6), fresh(6));
    await vi.waitFor(() =>
      expect(el("open-status").textContent).toBe(
        "Dandiset 000123 holds no SLEAP projects, and no videos to start one from.",
      ),
    );
    expect(stored()).toEqual({ dandisetId: "000123", oauth: fresh(6) });
  });
});
