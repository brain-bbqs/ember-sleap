import { createOAuthClient, type OAuthClient } from "@brain-bbqs/ember-client";

// Each BBQS app is its own public (PKCE, no secret) OAuth2 application on the archive, so it can be
// revoked and audited on its own; this is ember-sleap's. Sign-in sends the page's own address
// (origin and path, no query) as the redirect URI, so every serving URL, PR previews and local dev
// included, has to be registered with it (docs/DEVELOPMENT_PLAN.md, "EMBER sign-in").
export const OAUTH_CLIENT_ID = "cDxcl68boqpjgBoEXfh2bnuYxwWQLMdYfMnVrHNA";

// sessionStorage key the pending login's PKCE verifier and state wait under across the redirect.
export const OAUTH_PKCE_STORAGE_KEY = "ember-sleap.oauth-pkce.v1";

export function createOAuth(clientId: string = OAUTH_CLIENT_ID): OAuthClient {
  return createOAuthClient({ clientId, storageKey: OAUTH_PKCE_STORAGE_KEY });
}
