import { describe, expect, it } from "vitest";
import { createOAuth, OAUTH_CLIENT_ID, OAUTH_PKCE_STORAGE_KEY, SIGN_IN_UNAVAILABLE } from "../../src/lib/oauth";

describe("createOAuth", () => {
  it("has no client until ember-sleap's OAuth app is registered", () => {
    expect(OAUTH_CLIENT_ID).toBe("");
    expect(createOAuth()).toBe(null);
    expect(SIGN_IN_UNAVAILABLE).toContain("not available yet");
  });

  it("builds the PKCE client once there is a client id", () => {
    const client = createOAuth("a-registered-client-id");
    expect(client).not.toBe(null);
    expect(typeof client?.startLogin).toBe("function");
    expect(typeof client?.handleRedirectCallback).toBe("function");
    expect(typeof client?.ensureFreshToken).toBe("function");
    expect(typeof client?.revokeToken).toBe("function");
  });

  it("keeps its pending sign-in under this app's own key", () => {
    expect(OAUTH_PKCE_STORAGE_KEY).toBe("ember-sleap.oauth-pkce.v1");
  });
});
