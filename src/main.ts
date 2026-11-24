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
  refreshIdentity,
  renderAuthState,
  renderVersion,
} from "@brain-bbqs/ui";
import { COMPUTE_PROXY_URL, createProxyComputeClient, type ComputeClient } from "./lib/computeClient";
import { createStubCompute } from "./lib/computeStub";
import { fetchDandiset, listOwnDandisets, listProjects, listVideos, type ProjectAsset } from "./lib/emberAssets";
import { createEmberStorage, type PathOpener, type ProjectStorage, type SavedFile } from "./lib/emberStorage";
import type { SaveStage } from "./lib/emberUpload";
import { createHashPool } from "./lib/etagPool";
import { createSleapHost } from "./lib/host";
import { fromHostRef, type EmberLocation } from "./lib/hostRef";
import { createMemoryStorage } from "./lib/memoryStorage";
import type { ModelSource } from "./lib/modelCatalogue";
import { createEmberModelSource } from "./lib/modelEmber";
import { createHuggingFaceSource } from "./lib/modelHuggingFace";
import { createBundledIndexSource, createIndexSource, MODEL_INDEX_URL } from "./lib/modelIndex";
import { createOAuth } from "./lib/oauth";
import { settingsStore, STORAGE_KEY } from "./lib/settings";
import {
  EMBEDDED_PAGE_EFFECTS,
  type HostRef,
  type NewProjectRequest,
  type OpenRequest,
  type ProjectIntent,
  type SleapAppHandle,
  type TrackJobSpec,
} from "./lib/sleapContract";
import {
  mockModelSource,
  mockNewProjectRequest,
  mockProjectRequest,
  MOCK_DANDISET_ID,
  MOCK_MODELS,
  MOCK_PROJECT_PATH,
  readTestInjection,
} from "./lib/testInjection";
import { getElements, getShell } from "./ui/elements";
import { createEntitiesPrompt } from "./ui/entitiesDialog";
import { createOverwritePrompt } from "./ui/overwriteDialog";
import { createPredictionsList } from "./ui/predictionsList";
import { renderProjects } from "./ui/projectList";
import { loadSleapComponent, sleapAppBaseUrl } from "./ui/sleapComponent";
// The model index's entries so far (SuperAnimal's), served from the page until the index dandiset exists.
import bundledIndex from "./models.json";

const shell = getShell();
const els = getElements();

// ---------------------------------------------------------------------------------------------
// The shared shell: the footer's version stamp, wired as every BBQS companion app wires it. The
// page is dark only, like the SLEAP app it holds, so it has no light/dark toggle, and its footer
// carries no "What's New" or issue links; what follows is the app.
// ---------------------------------------------------------------------------------------------

renderVersion(shell.versionIndicator, __APP_VERSION__);

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

const account = shell.account;
const injection = readTestInjection(window.location.search);
// Either mock state runs offline: in-memory saves, fixed models and the compute stub.
const mocked = !!(injection?.mockProject || injection?.mockNewProject);
const oauth = createOAuth();
let tokens: OAuthTokenSet | null = null;
// One refresh per token set however many calls need it: EMBER rotates refresh tokens, so a second
// request with the same one is refused.
let refreshing: { from: OAuthTokenSet; done: Promise<void> } | null = null;
// The refresh token storage held at this tab's last write or read of it, so a refresh landing after
// another tab changed it (before that tab's storage event arrives) does not write over the change.
let storedRefreshToken: string | undefined;
// Bumped whenever the signed-in account may have changed, so a lookup started before then is dropped.
let authEpoch = 0;
// The dandiset whose projects are listed, and so the one EMBER model folders are read from.
let listedDandisetId = "";
// The latest listing and the latest open each win: an earlier one that resolves late is dropped.
let listingSeq = 0;
let openSeq = 0;
// The scaffold writes the running save's onWarning reported, kept for the line saying where it
// landed. Saves are reported one at a time (see withSaveReporting), so this is always that save's.
const saveWarnings: string[] = [];
let reporting: Promise<unknown> = Promise.resolve();
// What saves record as the SLEAP version: the component's, once it has loaded.
let sleapVersion = "unknown";
let app: SleapAppHandle | null = null;
// The app's mount, once it has started: at boot, and again each time a project is closed.
let mounting: Promise<SleapAppHandle> | null = null;
// What the project picker was opened for: New Project… or Open Project… in the app.
let pickerIntent: ProjectIntent = "open";

function say(target: HTMLElement, text: string, tone?: "ok" | "err"): void {
  target.textContent = text;
  target.classList.toggle("ok", tone === "ok");
  target.classList.toggle("err", tone === "err");
}

// Each write re-reads the stored record and changes only its own field, so a listing here never
// puts back tokens another tab has since refreshed or signed out of.
function saveDandisetId(dandisetId: string): void {
  settingsStore.save({ ...settingsStore.load(), dandisetId });
}

function saveTokens(next: OAuthTokenSet | null): void {
  settingsStore.save({ ...settingsStore.load(), oauth: next ?? undefined });
  storedRefreshToken = settingsStore.load()?.oauth?.refreshToken;
}

function refreshTokens(client: OAuthClient, current: OAuthTokenSet): Promise<void> {
  if (refreshing?.from === current) return refreshing.done;
  const flight = { from: current, done: Promise.resolve() };
  flight.done = client
    .ensureFreshToken(current)
    .then(
      (fresh) => {
        if (fresh === current) return;
        const changedElsewhere = settingsStore.load()?.oauth?.refreshToken !== storedRefreshToken;
        if (tokens === current && !changedElsewhere) {
          tokens = fresh;
          saveTokens(fresh);
          return;
        }
        // Signed out, here or in another tab, or another tab's tokens adopted: nothing holds this one.
        void client.revokeToken(fresh);
        if (tokens === current) adoptStoredTokens();
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
  if (tokens) await refreshTokens(oauth, tokens);
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

const SAVE_STAGES: Record<SaveStage, string> = {
  hashing: "Checking the file…",
  uploading: "Uploading to EMBER…",
};

// Hashing a project of hundreds of MB on the main thread would freeze the page for the length of it.
const hashPool = createHashPool();

const ember = createEmberStorage({
  config: configFor,
  askEntities: createEntitiesPrompt(els.entities),
  askOverwrite: createOverwritePrompt(els.overwrite),
  saveRefusal,
  versions: () => ({ app: __APP_VERSION__, sleap: sleapVersion }),
  hash: hashPool.hash,
  onProgress: (stage, fraction) => say(els.hostStatus, `${SAVE_STAGES[stage]} ${Math.round(fraction * 100)}%`),
  onWarning: (message) => {
    saveWarnings.push(message);
    say(els.hostStatus, message, "err");
  },
});

function pageStorage(): ProjectStorage & PathOpener {
  if (!mocked) return ember;
  const memory = createMemoryStorage({ unwritten: injection.mockPredictionsMissing });
  const shown = (saved: SavedFile) => {
    say(els.hostStatus, `Saved in memory (test injection): ${fromHostRef(saved.ref)?.path}`, "ok");
    return saved;
  };
  return {
    ...memory,
    save: (file, name, ref) => memory.save(file, name, ref).then(shown),
    saveTrainingPackage: (file, ref) => memory.saveTrainingPackage(file, ref).then(shown),
  };
}

/**
 * Archive failures in words a person can act on, and a line saying where a save, or the labels a
 * training job was sent, landed. Saves are reported one at a time, so one save's warnings never end
 * up on another's line.
 */
function withSaveReporting(storage: ProjectStorage): ProjectStorage {
  if (mocked) return storage;
  async function report(what: string, ref: HostRef | undefined, write: () => Promise<SavedFile>): Promise<SavedFile> {
    saveWarnings.length = 0;
    try {
      // The project stays open, so asking again here, not listing again, is how a failed check retries.
      const source = fromHostRef(ref);
      if (source && unreadFlags.has(source.dandisetId)) await recheckGate(source.dandisetId);
      const saved = await write();
      const where = fromHostRef(saved.ref)!;
      const landed = `${what} to the draft of dandiset ${where.dandisetId}: ${where.path}`;
      if (saveWarnings.length) say(els.hostStatus, `${landed}. ${saveWarnings.join(" ")}`, "err");
      else say(els.hostStatus, landed, "ok");
      return saved;
    } catch (e) {
      const message = friendlyError(e, MESSAGES);
      say(els.hostStatus, message, "err");
      throw new Error(message);
    }
  }
  function inTurn(run: () => Promise<SavedFile>): Promise<SavedFile> {
    const next = reporting.then(run);
    reporting = next.catch(() => undefined);
    return next;
  }
  return {
    ...storage,
    save: (file, name, ref) => inTurn(() => report("Saved", ref, () => storage.save(file, name, ref))),
    saveTrainingPackage: (file, ref) =>
      inTurn(() => report("Saved the training labels", ref, () => storage.saveTrainingPackage(file, ref))),
  };
}

/** Where jobs run, and, while that is the stub, the models it trained, listed as EMBER would list them. */
function pageCompute(): { client: ComputeClient; trained: ModelSource[] } {
  if (COMPUTE_PROXY_URL && !mocked) {
    const client = createProxyComputeClient({
      baseUrl: COMPUTE_PROXY_URL,
      getToken: async () => (await configFor("")).accessToken || null,
    });
    return { client, trained: [] };
  }
  const stub = createStubCompute(mocked ? { tickMs: 150 } : {});
  return { client: stub, trained: [stub.models] };
}

function modelSources(trained: ModelSource[]): ModelSource[] {
  // The page's own copy of the index needs no network, so the mocks list its models too.
  const bundled = createBundledIndexSource(bundledIndex);
  if (mocked) return [mockModelSource, bundled, ...trained];
  const sources: ModelSource[] = [MODEL_INDEX_URL ? createIndexSource({ url: MODEL_INDEX_URL }) : bundled];
  sources.push(
    createHuggingFaceSource({}),
    // Resolved per listing, so the models are read with the token saves use, and with none once signed
    // out. With nothing listed yet the config names no dandiset, which the source reads as nothing open.
    createEmberModelSource({ getConfig: () => configFor(listedDandisetId) }),
    ...trained,
  );
  return sources;
}

const storage = pageStorage();
const compute = pageCompute();
// Per page session: closing the project empties it, and nothing about it is stored.
const predictions = createPredictionsList(els.predictions, (file) => void openPredictions(file));
const host = createSleapHost({
  storage: withSaveReporting(storage),
  modelSources: modelSources(compute.trained),
  compute: compute.client,
  onModelWarning: (source, e) => console.warn(`Could not list models from ${source}:`, e),
  // Closing the project forgets its jobs (see the close handler), so every report is the open app's.
  onPredictions: (_jobId, files) => predictions.add(files),
  chooseProject: (intent) => showPicker(intent),
});

const NO_PROJECT = "No project open";

/** The bar's line saying where a project is. */
function locationLine({ dandisetId, path }: EmberLocation): string {
  return `${dandisetId === MOCK_DANDISET_ID ? "Test injection" : `Dandiset ${dandisetId}`} · ${path}`;
}

async function recheckGate(dandisetId: string): Promise<void> {
  const flagged = await readHumanSubjects(await configFor(dandisetId));
  // Another dandiset listed since owns the notice; this one stays unread, so its save is refused.
  if (dandisetId === listedDandisetId) renderGate(dandisetId, flagged);
}

/** The app, mounted with nothing open (its start screen) at boot and again after a project closes. */
function ensureApp(): Promise<SleapAppHandle> {
  mounting ??= loadSleapComponent({ standIn: injection?.standIn }).then((loaded) => {
    sleapVersion = loaded.version;
    // Which one is mounted, so the page's styles can stand back from the real app's (src/style.css).
    els.sleapRoot.dataset.component = loaded.standIn ? "stand-in" : "sleap-app";
    app = loaded.mountSleapApp(els.sleapRoot, {
      assetBaseUrl: sleapAppBaseUrl(),
      compute: { builtIn: false },
      pageEffects: EMBEDDED_PAGE_EFFECTS,
      host,
    });
    return app;
  });
  return mounting;
}

function showInBar(title: string, location: string): void {
  els.projectTitle.textContent = title;
  els.projectLocation.textContent = location;
  els.closeProjectBtn.hidden = false;
  say(els.hostStatus, "");
}

async function openProject(request: OpenRequest, location: string, isCurrent = () => true): Promise<void> {
  const handle = await ensureApp();
  if (!isCurrent()) return;
  host.remember(request);
  showInBar(request.name, location);
  closePicker();
  await handle.open(request);
}

/** Hands the app a new project as the page's own: the host follows its saves and jobs. */
function createProject(handle: SleapAppHandle, request: NewProjectRequest, location: string): Promise<void> {
  host.rememberNew(request);
  showInBar(request.name, location);
  closePicker();
  return handle.create(request);
}

const DISCARD_FOR_OPEN = "The open project has unsaved changes. Open another project without saving them?";
const DISCARD_FOR_NEW = "The open project has unsaved changes. Start a new project without saving them?";

async function openFromEmber(dandisetId: string, project: ProjectAsset): Promise<void> {
  // Bumped before asking, so a "no" also stops an earlier open, which would drop the same edits.
  const seq = ++openSeq;
  const isCurrent = () => seq === openSeq;
  const askedFirst = hasEdits();
  if (askedFirst && !window.confirm(DISCARD_FOR_OPEN)) return;
  say(els.openStatus, `Opening ${project.path}…`);
  try {
    const request = await ember.open(dandisetId, project);
    if (!isCurrent()) return;
    // Edits made while it loaded are the person's too.
    if (!askedFirst && !confirmDiscard(DISCARD_FOR_OPEN)) return say(els.openStatus, "");
    await openProject(request, locationLine({ dandisetId, path: project.path }), isCurrent);
    if (isCurrent()) say(els.openStatus, "");
  } catch (e) {
    if (isCurrent()) say(els.openStatus, friendlyError(e, MESSAGES), "err");
  }
}

function videoCount(n: number): string {
  return n === 1 ? "1 video" : `${n} videos`;
}

/**
 * Starts a new project on a dandiset's videos, as choosing a dandiset with no SLEAP project does,
 * and New Project… always does. `note` is what the person should still hear about the dandiset.
 */
async function startProject(dandisetId: string, videos: ProjectAsset[], note = ""): Promise<void> {
  const seq = ++openSeq;
  const isCurrent = () => seq === openSeq;
  const askedFirst = hasEdits();
  if (askedFirst && !window.confirm(DISCARD_FOR_NEW)) return;
  const count = videoCount(videos.length);
  say(els.openStatus, `Starting a new project on ${count}…`);
  try {
    const request = await ember.startProject(dandisetId, videos);
    const handle = await ensureApp();
    if (!isCurrent()) return;
    // Edits made while it loaded are the person's too.
    if (!askedFirst && !confirmDiscard(DISCARD_FOR_NEW)) return say(els.openStatus, "");
    await createProject(handle, request, `Dandiset ${dandisetId} · new project on ${count}`);
    say(els.openStatus, "");
    say(
      els.hostStatus,
      `New project on ${count} from dandiset ${dandisetId}: saving writes it into derivatives/sleap/.${note}`,
      note ? "err" : undefined,
    );
  } catch (e) {
    if (isCurrent()) say(els.openStatus, friendlyError(e, MESSAGES), "err");
  }
}

const DISCARD_FOR_PREDICTIONS = "The open project has unsaved changes. Open the predictions without saving them?";

/**
 * Opens predictions a job wrote in place of the project open now, as the picker opens a project:
 * the latest click wins, and edits not yet saved are only dropped once the person says so.
 */
async function openPredictions(file: EmberLocation): Promise<void> {
  // Bumped before asking, so a "no" also stops an earlier open, which would drop the same edits.
  const seq = ++openSeq;
  const isCurrent = () => seq === openSeq;
  const askedFirst = hasEdits();
  if (askedFirst && !window.confirm(DISCARD_FOR_PREDICTIONS)) return predictions.done();
  predictions.opening(file);
  try {
    const request = await storage.openPath(file.dandisetId, file.path);
    if (!isCurrent()) return;
    // Edits made while it loaded are the person's too.
    if (!askedFirst && !confirmDiscard(DISCARD_FOR_PREDICTIONS)) return predictions.done();
    await openProject(request, locationLine(file), isCurrent);
    if (isCurrent()) predictions.done();
  } catch (e) {
    if (isCurrent()) predictions.failed(file, friendlyError(e, MESSAGES));
  }
}

const PICKER: Record<ProjectIntent, { title: string; intro: string; submit: string }> = {
  open: {
    title: "Open a project from EMBER",
    intro:
      "Choose a dandiset to list its SLEAP projects. A dandiset with none yet starts a new project from its videos.",
    submit: "List projects",
  },
  new: {
    title: "New project on EMBER",
    intro: "Choose a dandiset: the new project starts from its videos and is saved into its derivatives/sleap/ folder.",
    submit: "Start project",
  },
};

/** The project picker, for the app's New Project… or Open Project…. */
function showPicker(intent: ProjectIntent): void {
  pickerIntent = intent;
  // A listing still on its way was for the picker as it was before.
  listingSeq++;
  const text = PICKER[intent];
  els.openDialog.title.textContent = text.title;
  els.openDialog.intro.textContent = text.intro;
  els.listProjectsBtn.textContent = text.submit;
  els.projectList.hidden = true;
  els.newProjectBtn.hidden = true;
  say(els.openStatus, "");
  if (!els.openDialog.dialog.open) els.openDialog.dialog.showModal();
  els.dandisetInput.focus();
}

function closePicker(): void {
  if (els.openDialog.dialog.open) els.openDialog.dialog.close();
}

/** The person closed the picker: what it was still listing, opening or starting stops. */
function cancelPicker(): void {
  listingSeq++;
  openSeq++;
  closePicker();
}

async function listDandiset(raw: string): Promise<void> {
  // A new listing also drops an open still on its way from the list it replaces.
  const seq = ++listingSeq;
  openSeq++;
  const intent = pickerIntent;
  const dandisetId = extractDandisetId(raw);
  if (!dandisetId) return say(els.openStatus, "Enter a dandiset id, such as 000398.", "err");
  saveDandisetId(dandisetId);
  els.projectList.hidden = true;
  els.newProjectBtn.hidden = true;
  say(
    els.openStatus,
    intent === "new"
      ? `Finding the videos in dandiset ${dandisetId}…`
      : `Listing the projects in dandiset ${dandisetId}…`,
  );
  try {
    const cfg = await configFor(dandisetId);
    // The flag is read with the listing, so the notice and the list always describe the same dandiset.
    const [summary, projects, videos, flagged] = await Promise.all([
      fetchDandiset(cfg),
      listProjects(cfg),
      listVideos(cfg),
      readHumanSubjects(cfg),
    ]);
    if (seq !== listingSeq) return;
    listedDandisetId = dandisetId;
    renderGate(dandisetId, flagged);
    const name = summary.title ? `${summary.title} (${dandisetId})` : `Dandiset ${dandisetId}`;
    const embargo = summary.embargoed ? ", embargoed" : "";
    const unchecked =
      flagged === null
        ? " Could not check its human-subjects flag: each save tries again, and is refused until a check succeeds."
        : "";
    if (intent === "new" || projects.length === 0) {
      if (videos.length === 0) {
        const none =
          intent === "new"
            ? `${name}${embargo} holds no videos to start a project from.`
            : `${name}${embargo} holds no SLEAP projects, and no videos to start one from.`;
        return say(els.openStatus, `${none}${unchecked}`, "err");
      }
      // Choosing a dandiset with no project yet is choosing to start one.
      return void startProject(dandisetId, videos, unchecked);
    }
    renderProjects(els.projectList, projects, (project) => void openFromEmber(dandisetId, project));
    els.newProjectBtn.onclick = () => void startProject(dandisetId, videos);
    els.newProjectBtn.textContent = `Start a new project from its ${videoCount(videos.length)}`;
    els.newProjectBtn.hidden = videos.length === 0;
    const count = projects.length === 1 ? "1 project" : `${projects.length} projects`;
    say(els.openStatus, `${name}${embargo}: ${count}.${unchecked}`, flagged === null ? "err" : undefined);
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

/** Takes the stored tokens as this tab's own, when another tab has changed them. */
function adoptStoredTokens(): void {
  const next = settingsStore.load()?.oauth ?? null;
  storedRefreshToken = next?.refreshToken;
  if (next?.accessToken === tokens?.accessToken && next?.refreshToken === tokens?.refreshToken) return;
  tokens = next;
  renderAuth();
}

function hasEdits(): boolean {
  return app?.isDirty() ?? false;
}

function confirmDiscard(question: string): boolean {
  return !hasEdits() || window.confirm(question);
}

const callbackTokens = await oauth.handleRedirectCallback().catch((e: unknown) => {
  console.warn("OAuth sign-in callback failed:", e);
  return null;
});
const stored = settingsStore.load();
tokens = callbackTokens ?? stored?.oauth ?? null;
storedRefreshToken = stored?.oauth?.refreshToken;
if (callbackTokens) saveTokens(callbackTokens);
renderAuth();

bindAccountMenu(account, {
  onSignIn: () => void oauth.startLogin(),
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
    if (signedOut) void oauth.revokeToken(signedOut);
  },
});

// Another tab's refresh or sign-out: follow it, rather than keep using a token it has rotated out.
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY || e.key === null) adoptStoredTokens();
});

els.openForm.addEventListener("submit", (e) => {
  e.preventDefault();
  void listDandiset(els.dandisetInput.value);
});

els.openDialog.close.addEventListener("click", cancelPicker);
// Escape closes a modal dialog by itself; what the picker was doing stops with it.
els.openDialog.dialog.addEventListener("cancel", () => {
  listingSeq++;
  openSeq++;
});

els.closeProjectBtn.addEventListener("click", () => {
  if (!confirmDiscard("Close the project without saving your changes?")) return;
  // Predictions still opening would otherwise bring the project back once they arrive, and a job of
  // this project's would list its predictions under the next one.
  openSeq++;
  host.forgetJobs();
  predictions.clear();
  app?.unmount();
  app = null;
  mounting = null;
  els.projectTitle.textContent = "";
  els.projectLocation.textContent = NO_PROJECT;
  els.closeProjectBtn.hidden = true;
  say(els.hostStatus, "");
  // Back to the app's start screen, as SLEAP shows with nothing open.
  void ensureApp();
});

// The embedded app is mounted with its own beforeunload turned off, so the page asks instead.
window.addEventListener("beforeunload", (e) => {
  if (hasEdits()) e.preventDefault();
});

const params = new URLSearchParams(window.location.search);
els.dandisetInput.value = extractDandisetId(params.get("dandiset") ?? "") || (stored?.dandisetId ?? "");

if (injection?.mockProject) {
  const mock = mockProjectRequest();
  const opening = openProject(mock, locationLine({ dandisetId: MOCK_DANDISET_ID, path: MOCK_PROJECT_PATH }));
  // Inference on the mock project, submitted and followed through the host as the app does it, so
  // its predictions reach the list through the same checks a finished job's do.
  if (injection.mockPredictions) {
    const spec: TrackJobSpec = { type: "track", data_path: mock.url, model_paths: [MOCK_MODELS[0].id] };
    void opening
      .then(() => host.submitJob(spec, mock.ref))
      .then(({ jobId }) => host.subscribeJob(jobId, () => undefined));
  }
} else if (injection?.mockNewProject) {
  const mock = mockNewProjectRequest();
  void ensureApp().then((handle) =>
    createProject(handle, mock, `Test injection · new project on ${videoCount(mock.videos.length)}`),
  );
} else {
  void ensureApp();
  if (params.has("dandiset")) {
    showPicker("open");
    void listDandiset(els.dandisetInput.value);
  }
}
