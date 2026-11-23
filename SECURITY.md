# Security notes

This app is a fully static, backend-free page (see `package.json`'s description).
There is no server to hold a session, set an `httpOnly` cookie, or otherwise keep a credential out of client-side JavaScript.
If the app ever calls an authenticated API, whatever credential it uses has to live somewhere the browser's JS can read it back out.
That constraint doesn't go away; the sections below are about managing it deliberately instead of by accident.

## The actual risk is XSS, not "clear text storage" by itself

A token sitting in `localStorage`/`sessionStorage` is only exploitable remotely if an attacker can first get JavaScript to execute on this origin (XSS), at which point they could just make authenticated requests directly; credential theft is a bonus, not the primary damage.
So before treating a "clear text storage of sensitive information" scanner alert as something to dismiss or work around, actually check whether that precondition holds:

```
grep -rn "innerHTML\|outerHTML\|insertAdjacentHTML" src/
```

For every hit, confirm any _dynamic_ (user-supplied, API-returned, file-derived, or otherwise non-literal) string is assigned via `.textContent` (or an `element.value` type property) rather than concatenated into the HTML string itself.
A fixed, hardcoded template assigned via `innerHTML` is fine; the risk is interpolating untrusted data into HTML source, not the property name.
This app's own code under `src/` has no `innerHTML` use: the project list, the SLEAP stand-in, the dialogs and the status lines are built from elements and `.textContent`, and the What's New modal is drawn by `@brain-bbqs/ui`'s `initWhatsNew`, which builds `CHANGELOG.md` into DOM nodes and never parses it as markup.
Keep it that way: this is the property that makes accepting client-side credential storage a reasonable call for an app of this shape.

Also keep an eye on:

- **No third-party runtime scripts.** Nothing in `index.html` loads a CDN `<script>` tag.
  A compromised third-party script is the other realistic way a token in storage gets exfiltrated even without a bug in this app's own code, so keep it that way.
- **Minimal runtime dependencies.** This app's are the shared `@brain-bbqs/ui`, `@brain-bbqs/utils` and `@brain-bbqs/ember-client` packages; the SLEAP web app itself, `@talmolab/sleap-app`, built from our fork (`brain-bbqs/sleap-app`) and pinned to a commit, which runs in the page with the same access as its own code; and the Talmo Lab's `@talmolab/sleap-io.js`, which the SLEAP stand-in loads only to write a new project's `.slp` (the real app carries its own copy, so it goes with the stand-in).
  Every added runtime dependency is something that could be compromised upstream and ship code that reads `localStorage`; don't add one without a reason.

## Handling a "clear text storage" alert on a new credential

1. Run the `innerHTML`/XSS check above.
   If it turns up a real injection point, fix _that_; it's a bigger problem than where the token sits, and no storage choice below fixes it.
2. If it doesn't, decide how much persistence the credential actually needs, in order of decreasing exposure:
   - `localStorage` survives browser restarts.
     Lowest friction, largest exposure window (persists until explicitly cleared or signed out).
   - `sessionStorage` survives reloads, clears on tab close.
     Meaningfully smaller window than `localStorage`, but scanners (CodeQL included) generally flag this the same way; expect to still need step 3.
   - In-memory only (a plain module variable, no Storage API) is cleared on any reload/navigation, not just tab close.
     Removes the flagged sink entirely, at the cost of re-authenticating on every page load.
3. If you land on `localStorage` or `sessionStorage`, dismiss the resulting alert as an accepted, documented trade-off (link this file) rather than trying to "encrypt" the value client-side first: any decryption key reachable by this app's own JS is reachable by an attacker's injected JS too, so client-side encryption of a client-held secret is not a real mitigation, just a false sense of one.

**Precedent** from a sibling app: [bbqs-uploader#16](https://github.com/brain-bbqs/bbqs-uploader/pull/16) proposed dropping persistence entirely for a pasted API key (the in-memory option above) rather than dismissing its alert, and [bbqs-uploader#19](https://github.com/brain-bbqs/bbqs-uploader/pull/19) replaced that key with OAuth tokens persisted in `localStorage`, deciding the same question for those tokens with the checklist above.

## Never forward a user's token to a third party

If the app calls a companion service (anything that is not the API the token was issued for), that call carries **no credentials of the user's**.
A service that needs to look something up does so with its own key, server-side.
An earlier version of a sibling app forwarded the signed-in user's live access token to a helper host on every page load, which put a credential capable of acting as that user on a machine the repository doesn't control; a unit test now pins the absence of the `Authorization` header on that call.
Do the same here: if such a service ever needs to know something it can't resolve with its own credentials, change the service, not the header.

### The compute proxy exception

There is one named exception: the central Pennsieve compute proxy, at the base URL set as `COMPUTE_PROXY_URL` in `src/lib/computeClient.ts`, receives the signed-in user's EMBER access token.

- **Where:** only that host, and only on the job API in [docs/COMPUTE_API.md](docs/COMPUTE_API.md#endpoints): `POST /jobs`, `GET /jobs/{id}/events` and `POST /jobs/{id}/cancel`.
  No other companion service gets it; the model index and Hugging Face are read with no credentials.
- **Why:** single sign-on for jobs.
  The proxy runs them under its own service account, so it needs to know which EMBER user asked and that they may read the inputs and write the destination dandiset, and EMBER's token is the only identity the page has.
- **What the proxy may do with it:** identify the user and check their permissions on EMBER, then record them as the job's requester.
  It must not store the token, log it, pass it on, or read or write EMBER with it: the service account does all of that.
- **Dormant until configured:** while `COMPUTE_PROXY_URL` is `null` (as it is until the proxy's API exists), jobs run on the in-browser stub and the token goes nowhere but EMBER.
- **Revisit** when the proxy's auth question in COMPUTE_API.md is settled: a proxy-scoped credential (a token exchange, or a token whose audience is the proxy) replaces this exception if EMBER can issue one.

## Sign-in and the token lifecycle

- **Grant:** OAuth 2 authorization code with PKCE, through `@brain-bbqs/ember-client`, as a public client with no secret, requesting EMBER's default scope.
  ember-sleap is its own OAuth application on EMBER (`OAUTH_CLIENT_ID` in `src/lib/oauth.ts`), separate from its sibling apps' so each can be revoked on its own.
- **Storage:** the PKCE verifier and state wait in `sessionStorage` across the redirect; the access and refresh tokens persist in `localStorage` under `ember-sleap.settings.v1`, an accepted trade-off by the checklist above.
- **Lifetime and refresh:** access tokens live as long as EMBER's OAuth server sets.
  Within 60 seconds of expiry, the next call to EMBER (or to the compute proxy) first refreshes them with the `refresh_token` grant.
  One refresh runs at a time however many calls are waiting on it, since EMBER rotates refresh tokens, and a tab follows another tab's refresh or sign-out instead of writing its own tokens back over it.
- **Sign-out:** a best-effort revocation of the access token at EMBER's `/oauth/revoke_token/`, and the stored tokens are cleared.

The `frontend-security` skill, installed by `apm install` from `brain-bbqs/bbqs-web-components`, is the triggerable summary of this file; a change here that it should reflect goes to that repository too.
