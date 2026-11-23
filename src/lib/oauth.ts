import { createOAuthClient, type OAuthClient } from "@brain-bbqs/ember-client";

// Each BBQS app is its own public (PKCE, no secret) OAuth2 application on the archive, so it can be
// revoked and audited on its own. ember-sleap's has not been registered yet (an open question for
// the EMBER admins in docs/DEVELOPMENT_PLAN.md); until it is, sign-in says so instead of sending
// people to an authorize page that would refuse an unknown client. Every serving URL, PR previews
// included, has to be registered as a redirect URI with it.
export const OAUTH_CLIENT_ID = "";

// sessionStorage key the pending login's PKCE verifier and state wait under across the redirect.
export const OAUTH_PKCE_STORAGE_KEY = "ember-sleap.oauth-pkce.v1";

export const SIGN_IN_UNAVAILABLE =
  "Sign-in is not available yet: ember-sleap's OAuth app has not been registered on EMBER. Public dandisets can still be opened.";

export function createOAuth(clientId: string = OAUTH_CLIENT_ID): OAuthClient | null {
  return clientId ? createOAuthClient({ clientId, storageKey: OAUTH_PKCE_STORAGE_KEY }) : null;
}
