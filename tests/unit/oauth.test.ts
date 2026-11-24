import { describe, expect, it } from "vitest";
import { createOAuth, OAUTH_CLIENT_ID, OAUTH_PKCE_STORAGE_KEY } from "../../src/lib/oauth";

describe("createOAuth", () => {
  it("signs in as ember-sleap's own OAuth app on EMBER", () => {
    expect(OAUTH_CLIENT_ID).toBe("cDxcl68boqpjgBoEXfh2bnuYxwWQLMdYfMnVrHNA");
  });

  it("builds the PKCE client", () => {
    const client = createOAuth();
    expect(typeof client.startLogin).toBe("function");
    expect(typeof client.handleRedirectCallback).toBe("function");
    expect(typeof client.ensureFreshToken).toBe("function");
    expect(typeof client.revokeToken).toBe("function");
  });

  it("keeps its pending sign-in under this app's own key", () => {
    expect(OAUTH_PKCE_STORAGE_KEY).toBe("ember-sleap.oauth-pkce.v1");
  });
});
