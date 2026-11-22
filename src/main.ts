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
import { settingsStore, THEME_KEY } from "./lib/settings";
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

const account = shell.account!;
const injection = readTestInjection(window.location.search);
const oauth = createOAuth();
let tokens: OAuthTokenSet | null = null;
let storedDandisetId = "";
// The dandiset whose projects are listed, and so the one EMBER model folders are read from.
let listedConfig: ArchiveConfig | null = null;
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

function saveSettings(): void {
  settingsStore.save({ dandisetId: storedDandisetId || undefined, oauth: tokens ?? undefined });
}

/** The archive config for a dandiset, refreshing an access token that is about to expire. */
async function configFor(dandisetId: string): Promise<ArchiveConfig> {
  if (tokens && oauth) {
    const current = tokens;
    const fresh = await oauth.ensureFreshToken(current).catch(() => current);
    if (fresh !== current) {
      tokens = fresh;
      saveSettings();
    }
  }
  return resolveConfig({ dandisetId, oauthAccessToken: tokens?.accessToken });
}

const gate = createHumanSubjectsGate(els.humanSubjects);

async function refreshGate(cfg: ArchiveConfig): Promise<void> {
  const metadata = await fetchDraftMetadata(cfg).catch(() => null);
  gate.render(cfg.dandisetId, containsHumanSubjects(metadata));
}

const ember = createEmberStorage({
  config: configFor,
  askEntities: createEntitiesPrompt(els.entities),
  saveRefusal: (dandisetId) =>
    gate.isBlocking(dandisetId) ? "Confirm the human-subjects notice above before saving to this dandiset." : null,
  versions: () => ({ app: __APP_VERSION__, sleap: component?.version ?? "unknown" }),
  onProgress: (fraction) => say(els.hostStatus, `Uploading to EMBER… ${Math.round(fraction * 100)}%`),
  onWarning: (message) => say(els.hostStatus, message, "err"),
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
      try {
        const saved = await storage.save(file, name, ref);
        const where = fromHostRef(saved)!;
        say(els.hostStatus, `Saved to the draft of dandiset ${where.dandisetId}: ${where.path}`, "ok");
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
  sources.push(createHuggingFaceSource({}), createEmberModelSource({ getConfig: () => listedConfig }));
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

async function openProject(request: OpenRequest, location: string): Promise<void> {
  component ??= await loadSleapComponent();
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
  say(els.openStatus, `Opening ${project.path}…`);
  try {
    const request = await ember.open(dandisetId, project);
    await openProject(request, `Dandiset ${dandisetId} · ${project.path}`);
    say(els.openStatus, "");
  } catch (e) {
    say(els.openStatus, friendlyError(e, MESSAGES), "err");
  }
}

async function listDandiset(raw: string): Promise<void> {
  const dandisetId = extractDandisetId(raw);
  if (!dandisetId) return say(els.openStatus, "Enter a dandiset id, such as 000398.", "err");
  storedDandisetId = dandisetId;
  saveSettings();
  els.projectList.hidden = true;
  say(els.openStatus, `Listing the projects in dandiset ${dandisetId}…`);
  try {
    const cfg = await configFor(dandisetId);
    const [summary, projects] = await Promise.all([fetchDandiset(cfg), listProjects(cfg)]);
    listedConfig = cfg;
    void refreshGate(cfg);
    renderProjects(els.projectList, projects, (project) => void openFromEmber(dandisetId, project));
    const name = summary.title ? `${summary.title} (${dandisetId})` : `Dandiset ${dandisetId}`;
    const embargo = summary.embargoed ? ", embargoed" : "";
    const count = projects.length === 1 ? "1 project" : `${projects.length} projects`;
    say(
      els.openStatus,
      projects.length ? `${name}${embargo}: ${count}.` : `${name}${embargo} holds no SLEAP projects.`,
    );
  } catch (e) {
    say(els.openStatus, friendlyError(e, MESSAGES), "err");
  }
}

/** Suggests the dandisets the signed-in account owns, which are the ones it can save to. */
async function refreshDandisetOptions(): Promise<void> {
  if (!tokens) return els.dandisetOptions.replaceChildren();
  const owned = await listOwnDandisets(await configFor("")).catch(() => []);
  els.dandisetOptions.replaceChildren(...owned.map((d) => new Option(d.title, d.identifier)));
}

function renderAuth(): void {
  renderAuthState(account, !!tokens);
  if (tokens) void refreshIdentity(account, async () => fetchArchiveUser(await configFor("")));
  void refreshDandisetOptions();
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
storedDandisetId = stored?.dandisetId ?? "";
tokens = callbackTokens ?? stored?.oauth ?? null;
if (callbackTokens) saveSettings();
renderAuth();

bindAccountMenu(account, {
  onSignIn: () => {
    if (oauth) void oauth.startLogin();
    else notify(SIGN_IN_UNAVAILABLE, "err");
  },
  onSignOut: () => {
    if (
      !confirmDiscard(
        "The open project has unsaved changes. Sign out anyway? Saving them to EMBER will need you to sign in again.",
      )
    ) {
      return;
    }
    const signedOut = tokens;
    tokens = null;
    saveSettings();
    renderAuth();
    if (signedOut && oauth) void oauth.revokeToken(signedOut);
  },
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
els.dandisetInput.value = extractDandisetId(params.get("dandiset") ?? "") || storedDandisetId;

if (injection?.mockProject) {
  void openProject(mockProjectRequest(), `Test injection · ${MOCK_PROJECT_PATH}`);
} else if (params.has("dandiset")) {
  void listDandiset(els.dandisetInput.value);
}
