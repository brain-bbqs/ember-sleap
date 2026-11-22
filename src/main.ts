import "./style.css";
import {
  containsHumanSubjects,
  extractDandisetId,
  fetchArchiveUser,
  fetchDraftMetadata,
  friendlyError,
  resolveConfig,
  type ArchiveConfig,
  type FriendlyMessages,
  type OAuthClient,
  type OAuthTokenSet,
} from "@brain-bbqs/ember-client";
import {
  bindAccountMenu,
  createHumanSubjectsGate,
  initThemeToggle,
  initWhatsNew,
  refreshIdentity,
  renderAuthState,
  renderVersion,
} from "@brain-bbqs/ui";
import changelog from "../CHANGELOG.md?raw";
import { COMPUTE_PROXY_URL, createProxyComputeClient, type ComputeClient } from "./lib/computeClient";
import { createStubCompute } from "./lib/computeStub";
import { fetchDandiset, listOwnDandisets, listProjects, type ProjectAsset } from "./lib/emberAssets";
import { createEmberStorage, type ProjectStorage } from "./lib/emberStorage";
import { createSleapHost } from "./lib/host";
import { fromHostRef } from "./lib/hostRef";
import { createMemoryStorage } from "./lib/memoryStorage";
import type { ModelSource } from "./lib/modelCatalogue";
import { createEmberModelSource } from "./lib/modelEmber";
import { createHuggingFaceSource } from "./lib/modelHuggingFace";
import { createIndexSource, MODEL_INDEX_URL } from "./lib/modelIndex";
import { createOAuth, SIGN_IN_UNAVAILABLE } from "./lib/oauth";
import { settingsStore, STORAGE_KEY, THEME_KEY } from "./lib/settings";
import { EMBEDDED_PAGE_EFFECTS, type OpenRequest, type SleapAppHandle } from "./lib/sleapContract";
import { mockModelSource, mockProjectRequest, MOCK_PROJECT_PATH, readTestInjection } from "./lib/testInjection";
import { getElements, getShell } from "./ui/elements";
import { createEntitiesPrompt } from "./ui/entitiesDialog";
import { renderProjects } from "./ui/projectList";
import { loadSleapComponent, type SleapComponent } from "./ui/sleapComponent";

const shell = getShell();
const els = getElements();

// ---------------------------------------------------------------------------------------------
// The shared shell: the footer version stamp, the "What's New" modal and the light/dark toggle.
// Every BBQS companion app carries these three, wired the same way; what follows them is the app.
// ---------------------------------------------------------------------------------------------

renderVersion(shell.versionIndicator, __APP_VERSION__);

initWhatsNew(els.whatsNew, { changelog });

// The inline script in index.html already applied any stored theme override before first paint,
// so the toggle only has to flip and persist it, under the key that script reads.
initThemeToggle(shell.themeToggle, { storageKey: THEME_KEY });

// ---------------------------------------------------------------------------------------------
// The app: EMBER sign-in and the project picker around the embedded SLEAP app, and the host
// callbacks (storage, models, compute) the app is mounted with.
// ---------------------------------------------------------------------------------------------

const MESSAGES: FriendlyMessages = {
  401: "Authentication failed: please sign out and sign in again.",
  403: "Permission denied: your account cannot change this dandiset. Saving needs a dandiset you own.",
  404: "Not found: check the dandiset id.",
};

const FLAG_UNREAD =
  "Could not check this dandiset's human-subjects flag, so saving to it is refused. Save again to retry the check.";

const account = shell.account!;
const injection = readTestInjection(window.location.search);
const oauth = createOAuth();
let tokens: OAuthTokenSet | null = null;
// One refresh per token set however many calls need it: EMBER rotates refresh tokens, so a second
// request with the same one is refused.
let refreshing: { from: OAuthTokenSet; done: Promise<void> } | null = null;
// Bumped whenever the signed-in account may have changed, so a lookup started before then is dropped.
let authEpoch = 0;
// The dandiset whose projects are listed, and so the one EMBER model folders are read from.
let listedDandisetId = "";
// The latest listing and the latest open each win: an earlier one that resolves late is dropped.
let listingSeq = 0;
let openSeq = 0;
// The scaffold writes a save's onWarning reported, kept for the line saying where the save landed.
const saveWarnings: string[] = [];
let component: SleapComponent | null = null;
let app: SleapAppHandle | null = null;

function say(target: HTMLElement, text: string, tone?: "ok" | "err"): void {
  target.textContent = text;
  target.classList.toggle("ok", tone === "ok");
  target.classList.toggle("err", tone === "err");
}

/** Wherever the person is looking: the picker, or the open project. */
function notify(text: string, tone?: "ok" | "err"): void {
  say(els.appCard.hidden ? els.openStatus : els.hostStatus, text, tone);
}

// Each write re-reads the stored record and changes only its own field, so a listing here never
// puts back tokens another tab has since refreshed or signed out of.
function saveDandisetId(dandisetId: string): void {
  settingsStore.save({ ...settingsStore.load(), dandisetId });
}

function saveTokens(next: OAuthTokenSet | null): void {
  settingsStore.save({ ...settingsStore.load(), oauth: next ?? undefined });
}

function refreshTokens(client: OAuthClient, current: OAuthTokenSet): Promise<void> {
  if (refreshing?.from === current) return refreshing.done;
  const flight = { from: current, done: Promise.resolve() };
  flight.done = client
    .ensureFreshToken(current)
    .then(
      (fresh) => {
        if (fresh === current) return;
        if (tokens === current) {
          tokens = fresh;
          saveTokens(fresh);
        } else {
          // Signed out, or another tab's tokens adopted, while this was in flight: nothing holds it.
          void client.revokeToken(fresh);
        }
      },
      // A failed refresh keeps the old token; the call it was for reports the refusal.
      () => undefined,
    )
    .finally(() => {
      if (refreshing === flight) refreshing = null;
    });
  refreshing = flight;
  return flight.done;
}

/** The archive config for a dandiset, refreshing an access token that is about to expire. */
async function configFor(dandisetId: string): Promise<ArchiveConfig> {
  if (tokens && oauth) await refreshTokens(oauth, tokens);
  return resolveConfig({ dandisetId, oauthAccessToken: tokens?.accessToken });
}

const gate = createHumanSubjectsGate(els.humanSubjects);
// Each dandiset's human-subjects flag as last read, and the ones whose latest read failed. A failed
// read is not "unflagged": saving there is refused until a read succeeds.
const knownFlags = new Map<string, boolean>();
const unreadFlags = new Set<string>();

/** The dandiset's human-subjects flag, or null when it could not be read. */
function readHumanSubjects(cfg: ArchiveConfig): Promise<boolean | null> {
  return fetchDraftMetadata(cfg).then(containsHumanSubjects, () => null);
}

function renderGate(dandisetId: string, flagged: boolean | null): void {
  if (flagged === null) {
    unreadFlags.add(dandisetId);
  } else {
    unreadFlags.delete(dandisetId);
    knownFlags.set(dandisetId, flagged);
  }
  gate.render(dandisetId, knownFlags.get(dandisetId) ?? false);
}

function saveRefusal(dandisetId: string): string | null {
  if (unreadFlags.has(dandisetId)) return FLAG_UNREAD;
  if (gate.isBlocking(dandisetId)) return "Confirm the human-subjects notice above before saving to this dandiset.";
  return null;
}

const ember = createEmberStorage({
  config: configFor,
  askEntities: createEntitiesPrompt(els.entities),
  confirmOverwrite: (path) =>
    Promise.resolve(window.confirm(`${path} already holds labels from another project. Replace them?`)),
  saveRefusal,
  versions: () => ({ app: __APP_VERSION__, sleap: component?.version ?? "unknown" }),
  onProgress: (fraction) => say(els.hostStatus, `Uploading to EMBER… ${Math.round(fraction * 100)}%`),
  onWarning: (message) => {
    saveWarnings.push(message);
    say(els.hostStatus, message, "err");
  },
});

function pageStorage(): ProjectStorage {
  if (!injection?.mockProject) return ember;
  const memory = createMemoryStorage();
  return {
    ...memory,
    save: async (file, name, ref) => {
      const saved = await memory.save(file, name, ref);
      say(els.hostStatus, `Saved in memory (test injection): ${fromHostRef(saved)?.path}`, "ok");
      return saved;
    },
  };
}

/** Archive failures in words a person can act on, and a line saying where a save landed. */
function withSaveReporting(storage: ProjectStorage): ProjectStorage {
  if (injection?.mockProject) return storage;
  return {
    ...storage,
    async save(file, name, ref) {
      saveWarnings.length = 0;
      try {
        // The project stays open, so asking again here, not listing again, is how a failed check retries.
        const source = fromHostRef(ref);
        if (source && unreadFlags.has(source.dandisetId)) await recheckGate(source.dandisetId);
        const saved = await storage.save(file, name, ref);
        const where = fromHostRef(saved)!;
        const landed = `Saved to the draft of dandiset ${where.dandisetId}: ${where.path}`;
        if (saveWarnings.length) say(els.hostStatus, `${landed}. ${saveWarnings.join(" ")}`, "err");
        else say(els.hostStatus, landed, "ok");
        return saved;
      } catch (e) {
        const message = friendlyError(e, MESSAGES);
        say(els.hostStatus, message, "err");
        throw new Error(message);
      }
    },
  };
}

function modelSources(): ModelSource[] {
  if (injection?.mockProject) return [mockModelSource];
  const sources: ModelSource[] = [];
  if (MODEL_INDEX_URL) sources.push(createIndexSource({ url: MODEL_INDEX_URL }));
  sources.push(
    createHuggingFaceSource({}),
    // Resolved per listing, so the models are read with the token saves use, and with none once signed
    // out. With nothing listed yet the config names no dandiset, which the source reads as nothing open.
    createEmberModelSource({ getConfig: () => configFor(listedDandisetId) }),
  );
  return sources;
}

function pageCompute(): ComputeClient {
  if (injection?.mockProject) return createStubCompute({ tickMs: 150 });
  if (COMPUTE_PROXY_URL) {
    return createProxyComputeClient({
      baseUrl: COMPUTE_PROXY_URL,
      getToken: async () => (await configFor("")).accessToken || null,
    });
  }
  return createStubCompute();
}

const host = createSleapHost({
  storage: withSaveReporting(pageStorage()),
  modelSources: modelSources(),
  compute: pageCompute(),
  onModelWarning: (source, e) => console.warn(`Could not list models from ${source}:`, e),
});

async function recheckGate(dandisetId: string): Promise<void> {
  renderGate(dandisetId, await readHumanSubjects(await configFor(dandisetId)));
}

async function openProject(request: OpenRequest, location: string, isCurrent = () => true): Promise<void> {
  component ??= await loadSleapComponent();
  if (!isCurrent()) return;
  app ??= component.mountSleapApp(els.sleapRoot, {
    assetBaseUrl: new URL("sleap-assets/", document.baseURI).href,
    compute: { builtIn: false },
    pageEffects: EMBEDDED_PAGE_EFFECTS,
    host,
  });
  host.remember(request);
  els.projectTitle.textContent = request.name;
  els.projectLocation.textContent = location;
  say(els.hostStatus, "");
  els.openCard.hidden = true;
  els.appCard.hidden = false;
  await app.open(request);
}

async function openFromEmber(dandisetId: string, project: ProjectAsset): Promise<void> {
  const seq = ++openSeq;
  const isCurrent = () => seq === openSeq;
  say(els.openStatus, `Opening ${project.path}…`);
  try {
    const request = await ember.open(dandisetId, project);
    if (!isCurrent()) return;
    await openProject(request, `Dandiset ${dandisetId} · ${project.path}`, isCurrent);
    if (isCurrent()) say(els.openStatus, "");
  } catch (e) {
    if (isCurrent()) say(els.openStatus, friendlyError(e, MESSAGES), "err");
  }
}

async function listDandiset(raw: string): Promise<void> {
  // A new listing also drops an open still on its way from the list it replaces.
  const seq = ++listingSeq;
  openSeq++;
  const dandisetId = extractDandisetId(raw);
  if (!dandisetId) return say(els.openStatus, "Enter a dandiset id, such as 000398.", "err");
  saveDandisetId(dandisetId);
  els.projectList.hidden = true;
  say(els.openStatus, `Listing the projects in dandiset ${dandisetId}…`);
  try {
    const cfg = await configFor(dandisetId);
    // The flag is read with the listing, so the notice and the list always describe the same dandiset.
    const [summary, projects, flagged] = await Promise.all([
      fetchDandiset(cfg),
      listProjects(cfg),
      readHumanSubjects(cfg),
    ]);
    if (seq !== listingSeq) return;
    listedDandisetId = dandisetId;
    renderGate(dandisetId, flagged);
    renderProjects(els.projectList, projects, (project) => void openFromEmber(dandisetId, project));
    const name = summary.title ? `${summary.title} (${dandisetId})` : `Dandiset ${dandisetId}`;
    const embargo = summary.embargoed ? ", embargoed" : "";
    const count = projects.length === 1 ? "1 project" : `${projects.length} projects`;
    const listed = projects.length ? `${name}${embargo}: ${count}.` : `${name}${embargo} holds no SLEAP projects.`;
    if (flagged === null) {
      say(
        els.openStatus,
        `${listed} Could not check its human-subjects flag: list it again before saving to it.`,
        "err",
      );
    } else {
      say(els.openStatus, listed);
    }
  } catch (e) {
    if (seq === listingSeq) say(els.openStatus, friendlyError(e, MESSAGES), "err");
  }
}

/** Suggests the dandisets the signed-in account owns, which are the ones it can save to. */
async function refreshDandisetOptions(epoch: number): Promise<void> {
  if (!tokens) return els.dandisetOptions.replaceChildren();
  const owned = await listOwnDandisets(await configFor("")).catch(() => []);
  if (epoch === authEpoch) els.dandisetOptions.replaceChildren(...owned.map((d) => new Option(d.title, d.identifier)));
}

function renderAuth(): void {
  const epoch = ++authEpoch;
  renderAuthState(account, !!tokens);
  if (tokens) {
    void refreshIdentity(account, async () => {
      const user = await fetchArchiveUser(await configFor(""));
      return epoch === authEpoch ? user : null;
    });
  }
  void refreshDandisetOptions(epoch);
}

function confirmDiscard(question: string): boolean {
  return !app?.isDirty() || window.confirm(question);
}

const callbackTokens = oauth
  ? await oauth.handleRedirectCallback().catch((e: unknown) => {
      console.warn("OAuth sign-in callback failed:", e);
      return null;
    })
  : null;
const stored = settingsStore.load();
tokens = callbackTokens ?? stored?.oauth ?? null;
if (callbackTokens) saveTokens(callbackTokens);
renderAuth();

bindAccountMenu(account, {
  onSignIn: () => {
    if (oauth) void oauth.startLogin();
    else notify(SIGN_IN_UNAVAILABLE, "err");
  },
  onSignOut: () => {
    if (
      !confirmDiscard(
        "The open project has unsaved changes. Signing out means they cannot be saved to EMBER: " +
          "signing back in reloads the page and discards them. Sign out anyway?",
      )
    ) {
      return;
    }
    const signedOut = tokens;
    tokens = null;
    saveTokens(null);
    renderAuth();
    if (signedOut && oauth) void oauth.revokeToken(signedOut);
  },
});

// Another tab's refresh or sign-out: follow it, rather than keep using a token it has rotated out.
window.addEventListener("storage", (e) => {
  if (e.key !== STORAGE_KEY && e.key !== null) return;
  const next = settingsStore.load()?.oauth ?? null;
  if (next?.accessToken === tokens?.accessToken && next?.refreshToken === tokens?.refreshToken) return;
  tokens = next;
  renderAuth();
});

els.openForm.addEventListener("submit", (e) => {
  e.preventDefault();
  void listDandiset(els.dandisetInput.value);
});

els.closeProjectBtn.addEventListener("click", () => {
  if (!confirmDiscard("Close the project without saving your changes?")) return;
  app?.unmount();
  app = null;
  els.appCard.hidden = true;
  els.openCard.hidden = false;
  els.dandisetInput.focus();
});

// The embedded app is mounted with its own beforeunload turned off, so the page asks instead.
window.addEventListener("beforeunload", (e) => {
  if (app?.isDirty()) e.preventDefault();
});

const params = new URLSearchParams(window.location.search);
els.dandisetInput.value = extractDandisetId(params.get("dandiset") ?? "") || (stored?.dandisetId ?? "");

if (injection?.mockProject) {
  void openProject(mockProjectRequest(), `Test injection · ${MOCK_PROJECT_PATH}`);
} else if (params.has("dandiset")) {
  void listDandiset(els.dandisetInput.value);
}
