// A stand-in for `mountSleapApp` from `@talmolab/sleap-app`, which is not published yet. It does
// none of SLEAP's labeling work; it holds the app's place in the page, laid out like the SLEAP web
// app (menu bar, start screen, canvas, side panels, status bar), and drives every host callback the
// way the contract (src/lib/sleapContract.ts) says the real app will: New Project… and Open
// Project… go to `host.chooseProject`, it reads an opened file over ranged requests by its declared
// type, saves through `host.save` (after `host.refreshUrl` when the open link has expired; a new
// project is first written as an `.slp` of its own), finds videos through `host.resolveVideo`,
// lists models and submits, follows and cancels jobs through the host (training on unsaved edits
// sends them inline, as upstream's "labels from this window" does), and keeps its keyboard shortcut
// and page side effects inside the box it was mounted in. When the real package ships,
// src/ui/sleapComponent.ts mounts that instead and this file goes.
import { button, h } from "@brain-bbqs/ui";
import { humanSize } from "@brain-bbqs/utils";
import sleapLogo from "../assets/sleap-logo.png";
import { blobToBase64 } from "../lib/base64";
import { newProjectFile } from "../lib/newProjectFile";
import type {
  HostRef,
  JobEvent,
  ModelCard,
  MountOptions,
  NewProjectRequest,
  OpenRequest,
  ProjectIntent,
  ProjectVideo,
  SleapAppHandle,
  TrackJobSpec,
  TrainJobSpec,
} from "../lib/sleapContract";

export const STAND_IN_VERSION = "0.0.0-stand-in";

const STAND_IN_NOTE =
  "SLEAP component stand-in. It holds the place of @talmolab/sleap-app until that is published, and drives the same host callbacks.";
const HOST_BACKEND = "host";
const BUILT_IN_BACKENDS = [
  ["local", "Local"],
  ["connect", "SLEAP Connect"],
] as const;
const SIGNATURE_BYTES = 12;
// The minimum a sleap-nn training config needs to name what it trains; the real app's training
// dialog builds the full one.
const STAND_IN_CONFIG = "model_config:\n  head_configs:\n    single_instance: {}\ntrainer_config:\n  max_epochs: 3\n";
const STAND_IN_TRAINING: TrainJobSpec = {
  type: "train",
  config_contents: [STAND_IN_CONFIG],
  model_types: ["single_instance"],
  max_epochs: 3,
  run_name: "stand-in",
};

// Feather-style outlines (24-unit grid), stroked with currentColor so they follow the text color.
const ICONS = {
  plus: ["M12 5v14", "M5 12h14"],
  folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  film: ["M4 4h16v16H4z", "M8 4v16", "M16 4v16", "M4 9h4", "M4 15h4", "M16 9h4", "M16 15h4"],
  zap: ["M13 2 4 14h7l-1 8 9-12h-7z"],
  pencil: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"],
  save: ["M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M7 3v5h8", "M7 21v-7h10v7"],
} as const;

type IconName = keyof typeof ICONS;

function icon(name: IconName): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  })) {
    svg.setAttribute(key, value);
  }
  for (const d of ICONS[name]) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** What the first bytes of a file say it is, for the stand-in's "it really opened" line. */
export function describeSignature(bytes: Uint8Array): string {
  const hdf5 = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
  if (hdf5.every((b, i) => bytes[i] === b)) return "HDF5 signature";
  const text = String.fromCharCode(...bytes.slice(0, SIGNATURE_BYTES));
  if (text.slice(4, 8) === "ftyp") return "MP4 signature";
  if (text.startsWith("RIFF") && text.slice(8, 11) === "AVI") return "AVI signature";
  return "unrecognized signature";
}

/** The first `count` bytes behind `url`, without pulling the rest when the server ignores Range. */
export async function readHead(url: string, count: number, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const response = await fetchImpl(url, { headers: { Range: `bytes=0-${count - 1}` } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reader = response.body!.getReader();
  const head = new Uint8Array(count);
  let filled = 0;
  while (filled < count) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = value.subarray(0, count - filled);
    head.set(take, filled);
    filled += take.length;
  }
  await reader.cancel();
  return head.subarray(0, filled);
}

function role<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  name: string,
  cls?: string | null,
  text?: string | null,
): HTMLElementTagNameMap[K] {
  const el = h(tag, cls, text);
  el.dataset.role = name;
  return el;
}

function roleButton(name: string, cls: string | null, label: string, glyph?: IconName): HTMLButtonElement {
  const btn = role("button", name, cls);
  btn.type = "button";
  if (glyph) btn.append(icon(glyph));
  btn.append(label);
  return btn;
}

/** A field of an event's data as text; anything structured is shown as JSON. */
function field(value: unknown): string {
  if (value === undefined) return "";
  return typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value);
}

function describeEvent(event: JobEvent): string | null {
  const d = event.data;
  switch (event.topic) {
    case "job.log":
      return typeof d.line === "string" ? d.line : "";
    case "job.epoch":
      return `epoch ${field(d.epoch)}: train loss ${field(d.train_loss)}, val loss ${field(d.val_loss)}`;
    case "job.result":
      return `result: ${JSON.stringify(d)}`;
    case "job.status":
      return d.detail ? `${field(d.state)}: ${field(d.detail)}` : null;
    default:
      return null;
  }
}

interface MenuItem {
  role: string;
  label: string;
  shortcut?: string;
  run: () => void;
}

export function mountStandIn(el: HTMLElement, options: MountOptions): SleapAppHandle {
  const { host = {}, pageEffects = {}, compute } = options;
  let file: OpenRequest | null = null;
  // The project started with `create`, until another opens: it has videos but no file of its own yet.
  let started: NewProjectRequest | null = null;
  let shownVideo: ProjectVideo | null = null;
  let dirty = false;
  let stopJob: (() => void) | null = null;
  let jobId: string | null = null;
  // Bumped by every open() and create(), so work that outlives the project it started for leaves
  // the next one alone.
  let opened = 0;
  // Each opened project's ref, by the open that opened it: a save updates its own project's, even
  // once another project is open, so a save queued behind it sends the ref it returned.
  const refs = new Map<number, HostRef | undefined>();
  const currentRef = () => refs.get(opened);
  // Saves run one after another, so a second press sends the ref the first one's save returned.
  let saving: Promise<void> = Promise.resolve();

  const root = h("div", "sleap-app sleap-standin");
  root.tabIndex = -1;

  // ---- Menu bar ---------------------------------------------------------------------------------

  const menubar = h("div", "sl-menubar");
  const brand = h("span", "sl-brand");
  const logo = h("img", "sl-logo");
  logo.src = sleapLogo;
  logo.alt = "";
  brand.append(logo, h("span", "sl-brand-name", "SLEAP"), h("span", "sl-version", `v${STAND_IN_VERSION}`));
  const menus = h("nav", "sl-menus");
  menus.setAttribute("aria-label", "SLEAP");
  const note = role("span", "stand-in-note", "sl-standin-note", "SLEAP component stand-in");
  note.title = STAND_IN_NOTE;
  menubar.append(brand, menus, note);

  const menuCloses: (() => void)[] = [];
  function closeMenus(): void {
    for (const close of menuCloses) close();
  }

  function menu(label: string, items: MenuItem[]): void {
    const wrap = h("div", "sl-menu");
    const trigger = role("button", `menu-${label.toLowerCase()}`, "sl-menu-button", label);
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    const list = h("div", "sl-menu-list");
    list.setAttribute("role", "menu");
    list.hidden = true;
    for (const item of items) {
      const entry = roleButton(item.role, "sl-menu-item", item.label);
      entry.setAttribute("role", "menuitem");
      if (item.shortcut) entry.append(h("span", "sl-shortcut", item.shortcut));
      entry.addEventListener("click", () => {
        closeMenus();
        item.run();
      });
      list.append(entry);
    }
    const close = () => {
      list.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };
    menuCloses.push(close);
    trigger.addEventListener("click", () => {
      const opening = list.hidden;
      closeMenus();
      if (!opening) return;
      list.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    });
    wrap.append(trigger, list);
    menus.append(wrap);
  }

  // ---- Start screen and the open project's canvas ---------------------------------------------

  const body = h("div", "sl-body");
  const main = h("div", "sl-main");

  const start = role("section", "start", "sl-start");
  const startNew = roleButton("start-new", "sl-button sl-primary", "New Project", "plus");
  const startOpen = roleButton("start-open", "sl-button", "Open Project", "folder");
  const startActions = h("div", "sl-start-actions");
  startActions.append(startNew, startOpen);
  const startHint = role("p", "start-hint", "sl-start-hint");
  startHint.textContent = host.chooseProject
    ? "Projects open from and save to the EMBER archive. Choose a dandiset: one without a SLEAP project yet starts a new one from its videos."
    : "This page offers no projects to open.";
  start.append(startActions, startHint);

  const projectView = role("section", "project", "sl-project");
  projectView.hidden = true;
  const canvas = h("div", "sl-canvas");
  const player = role("video", "video-player", "sl-video");
  player.controls = true;
  player.muted = true;
  player.preload = "metadata";
  player.hidden = true;
  const card = h("div", "sl-file-card");
  const probe = role("p", "file-probe", "sl-probe");
  card.append(probe);
  canvas.append(player, card);

  const editBtn = roleButton("edit", "sl-button", "Make an edit", "pencil");
  const saveBtn = roleButton("save", "sl-button sl-primary", "Save (Ctrl+S)", "save");
  const toolbar = h("div", "sl-toolbar");
  toolbar.append(editBtn, saveBtn);
  projectView.append(canvas, toolbar);
  main.append(start, projectView);

  // ---- Side panels -------------------------------------------------------------------------------

  const side = role("aside", "side", "sl-side");
  side.hidden = true;

  function panel(name: string, title: string): HTMLElement {
    const section = role("section", name, "sl-panel");
    section.append(h("h3", "sl-panel-title", title));
    side.append(section);
    return section;
  }

  const videosPanel = panel("videos-panel", "Videos");
  const videoList = role("ul", "video-list", "sl-video-list");
  const videoPath = role("input", "video-path");
  videoPath.type = "text";
  videoPath.placeholder = "e.g. C:\\lab\\videos\\session1.mp4";
  const videoLabel = h("label", "sl-field", "Find a video by the path the project stored");
  videoLabel.append(videoPath);
  const videoFind = roleButton("video-find", "sl-button", "Find video");
  const videoResult = role("p", "video-result", "sl-hint");
  const videoSection = role("div", "video", "sl-panel-body");
  videoSection.append(videoLabel, videoFind, videoResult);
  videosPanel.append(videoList, videoSection);

  const computePanel = panel("compute-panel", "Train and predict");
  const backend = role("select", "backend");
  if (compute?.builtIn !== false) {
    for (const [value, label] of BUILT_IN_BACKENDS) backend.append(new Option(label, value));
  }
  if (host.submitJob) backend.append(new Option("EMBER compute (host)", HOST_BACKEND, true, true));
  const backendLabel = h("label", "sl-field", "Run on");
  backendLabel.append(backend);
  const trainBtn = roleButton("train", "sl-button", "Train a model", "zap");
  const modelsBtn = roleButton("list-models", "sl-button", "Find models to predict with");
  const computeActions = h("div", "sl-panel-body");
  computeActions.append(backendLabel, trainBtn, modelsBtn);
  const computeStatus = role("p", "compute-status", "sl-hint");
  const models = role("ul", "models", "sl-models");

  const jobState = role("span", "job-state", "sl-badge");
  const jobLabel = role("span", "job-id", "sl-job-id");
  const cancelBtn = roleButton("job-cancel", "sl-button", "Cancel job");
  const jobRow = h("div", "sl-row");
  jobRow.append(jobLabel, jobState, cancelBtn);
  const jobLog = role("pre", "job-log", "sl-job-log");
  const jobPane = role("div", "job", "sl-panel-body");
  jobPane.append(jobRow, jobLog);
  jobPane.hidden = true;
  computePanel.append(computeActions, computeStatus, models, jobPane);

  // The icon rail down the right edge, as in the SLEAP app: each brings its panel into view by
  // focusing its first control, which the browser scrolls to.
  const rail = h("nav", "sl-rail");
  rail.setAttribute("aria-label", "Panels");
  for (const [target, label, glyph] of [
    [videosPanel, "Videos", "film"],
    [computePanel, "Train and predict", "zap"],
  ] as const) {
    const go = h("button", "sl-rail-button");
    go.type = "button";
    go.title = label;
    go.setAttribute("aria-label", label);
    go.append(icon(glyph));
    go.addEventListener("click", () => target.querySelector<HTMLElement>("button, input, select")?.focus());
    rail.append(go);
  }
  rail.hidden = true;

  body.append(main, side, rail);

  // ---- Status bar --------------------------------------------------------------------------------

  const statusbar = h("div", "sl-statusbar");
  const fileName = role("span", "file-name", "sl-file-name", "No project loaded");
  const fileType = role("span", "file-type", "sl-badge");
  fileType.hidden = true;
  const dirtyBadge = role("span", "dirty", "sl-badge sl-warn", "Unsaved changes");
  dirtyBadge.hidden = true;
  const saveStatus = role("span", "save-status", "sl-save-status");
  const statusLeft = h("div", "sl-status-left");
  statusLeft.append(fileName, fileType, dirtyBadge, saveStatus);
  const statusRight = h("div", "sl-status-right");
  statusRight.append(h("span", "sl-chip", host.submitJob ? "EMBER compute" : "Browser"));
  statusbar.append(statusLeft, statusRight);

  root.append(menubar, body, statusbar);
  el.append(root);

  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (dirty) e.preventDefault();
  };
  if (pageEffects.beforeUnload !== false) window.addEventListener("beforeunload", beforeUnload);
  // Listening on the document, so every target is a node in it.
  const outside = (e: Event) => {
    if (!menus.contains(e.target as Node)) closeMenus();
  };
  document.addEventListener("pointerdown", outside);

  function setDirty(value: boolean): void {
    dirty = value;
    dirtyBadge.hidden = !value;
  }

  function say(target: HTMLElement, text: string, tone?: "ok" | "err"): void {
    target.textContent = text;
    target.classList.toggle("ok", tone === "ok");
    target.classList.toggle("err", tone === "err");
  }

  function chooseProject(intent: ProjectIntent): void {
    if (host.chooseProject) host.chooseProject(intent);
    else say(saveStatus, "This page offers no projects to open.", "err");
  }

  function showProject(name: string, type: string): void {
    start.hidden = true;
    projectView.hidden = false;
    side.hidden = false;
    rail.hidden = false;
    fileName.textContent = name;
    fileType.textContent = type;
    fileType.hidden = false;
    say(saveStatus, "");
    if (pageEffects.title !== false) document.title = `${name} - SLEAP`;
  }

  function showVideo(video: ProjectVideo | null): void {
    shownVideo = video;
    player.hidden = !video;
    if (video) player.src = video.url;
    else player.removeAttribute("src");
    for (const item of videoList.querySelectorAll<HTMLButtonElement>("button")) {
      item.setAttribute("aria-pressed", String(item.dataset.url === video?.url));
    }
  }

  function renderVideos(videos: ProjectVideo[]): void {
    videoList.replaceChildren(
      ...videos.map((video) => {
        const pick = button("sl-video-item", video.storedPath);
        pick.dataset.url = video.url;
        pick.title = video.storedPath;
        pick.addEventListener("click", () => showVideo(video));
        const item = h("li");
        item.append(pick);
        return item;
      }),
    );
    videoList.hidden = videos.length === 0;
  }

  /**
   * The project's bytes. A presigned link expires while a project stays open, and S3 then answers
   * 403 with a readable error body, so the link is refreshed once and any other failure throws
   * rather than handing that body to `host.save`.
   */
  async function readProject(project: OpenRequest, isCurrent: () => boolean): Promise<Blob> {
    let response = await fetch(project.url);
    if (response.status === 403 && host.refreshUrl) {
      const fresh = await host.refreshUrl(project);
      if (isCurrent()) file = { ...project, url: fresh.url };
      response = await fetch(fresh.url);
    }
    if (!response.ok) throw new Error(`Could not read the project (HTTP ${response.status}).`);
    return response.blob();
  }

  /** What a save of the project open at `generation` sends: a new project's file, or the opened file's bytes. */
  function projectBytes(project: OpenRequest | NewProjectRequest, generation: number): Promise<Blob> {
    if (!("url" in project)) return newProjectFile(project.videos.map((v) => v.storedPath));
    // By its latest link while it is still open, since an earlier save may have renewed it.
    const isCurrent = () => opened === generation;
    return readProject(isCurrent() && file ? file : project, isCurrent);
  }

  /** Saves the project open when Save was pressed; requestSave has checked that the host saves. */
  async function save(pressed: OpenRequest | NewProjectRequest, generation: number): Promise<void> {
    const isCurrent = () => opened === generation;
    try {
      // The real app serializes its edited labels; the stand-in has no edits of its own to write,
      // so it sends the project's bytes back unchanged (a new project's freshly written file)
      // through the same callback.
      const blob = await projectBytes(pressed, generation);
      const saved = await host.save!(blob, pressed.name, refs.get(generation));
      refs.set(generation, saved);
      // The host's own status line reports where an earlier project's save landed.
      if (!isCurrent()) return;
      setDirty(false);
      say(saveStatus, `Saved ${humanSize(blob.size)}.`, "ok");
    } catch (e) {
      if (isCurrent()) say(saveStatus, `Save failed: ${e instanceof Error ? e.message : String(e)}`, "err");
    }
  }

  function requestSave(): void {
    const pressed = file ?? started;
    if (!pressed) return say(saveStatus, "Open a project before saving.", "err");
    if (!host.save) return say(saveStatus, "This page does not offer saving.", "err");
    const generation = opened;
    say(saveStatus, "Saving…");
    saving = saving.then(() => save(pressed, generation));
  }

  function hostCompute(): boolean {
    if (backend.value === HOST_BACKEND && host.submitJob) return true;
    say(computeStatus, "The stand-in runs jobs only through the page's own compute.", "err");
    return false;
  }

  function followJob(id: string): void {
    stopJob?.();
    jobId = id;
    jobLabel.textContent = `Job ${id}`;
    jobLog.textContent = "";
    say(jobState, "submitted");
    cancelBtn.hidden = false;
    jobPane.hidden = false;
    stopJob =
      host.subscribeJob?.(id, (event) => {
        if (event.topic === "job.status") {
          const state = String(event.data.state);
          say(jobState, state, state === "completed" ? "ok" : state === "failed" ? "err" : undefined);
          cancelBtn.hidden = ["completed", "failed", "canceled"].includes(state);
        }
        const line = describeEvent(event);
        if (line !== null) jobLog.textContent += `${line}\n`;
      }) ?? null;
  }

  /** Submits the spec `build` makes for the project open now, saying why if either step fails. */
  async function submit(build: () => Promise<TrainJobSpec | TrackJobSpec>): Promise<void> {
    say(computeStatus, "Submitting…");
    const ref = currentRef();
    try {
      const { jobId: id } = await host.submitJob!(await build(), ref);
      say(computeStatus, "");
      followJob(id);
    } catch (e) {
      say(computeStatus, `Could not submit: ${e instanceof Error ? e.message : String(e)}`, "err");
    }
  }

  /** What inference runs on: the opened file, or the video a new project shows. */
  function inferenceTarget(): string | null {
    return file?.url ?? shownVideo?.url ?? null;
  }

  function renderModel(card: ModelCard): HTMLLIElement {
    const item = h("li");
    const facts = [card.heads.join(", "), card.species, card.license, card.sourceLabel].filter(Boolean).join(" · ");
    const predict = button("sl-button", "Predict");
    predict.dataset.role = "predict";
    // The project open now, by its current link: another may have opened, or the link renewed, since.
    predict.addEventListener("click", () => {
      const target = inferenceTarget();
      if (!target || !hostCompute()) return;
      const spec: TrackJobSpec = { type: "track", data_path: target, model_paths: [card.id] };
      void submit(() => Promise.resolve(spec));
    });
    item.append(h("strong", null, card.name), h("span", "sl-hint", ` ${facts} `), predict);
    return item;
  }

  function train(): void {
    const project = file ?? started;
    if (!project || !hostCompute()) return;
    const [generation, edited] = [opened, dirty];
    void submit(async () => {
      if ("url" in project && !edited) return { ...STAND_IN_TRAINING, labels_path: project.url };
      // The bytes a save would send, made the way a save makes them.
      const labels = await projectBytes(project, generation);
      return { ...STAND_IN_TRAINING, labels_content: await blobToBase64(labels) };
    });
  }

  function listModels(): void {
    if ((!file && !started) || !host.listModels) return;
    say(computeStatus, "Listing models…");
    models.replaceChildren();
    host.listModels({}).then(
      (cards) => {
        say(computeStatus, cards.length ? "" : "No models found.");
        models.append(...cards.map(renderModel));
      },
      (e: unknown) => say(computeStatus, `Could not list models: ${e instanceof Error ? e.message : String(e)}`, "err"),
    );
  }

  menu("File", [
    { role: "menu-new", label: "New Project…", run: () => chooseProject("new") },
    { role: "menu-open", label: "Open Project…", run: () => chooseProject("open") },
    { role: "menu-save", label: "Save", shortcut: "Ctrl+S", run: requestSave },
  ]);
  menu("Predict", [
    { role: "menu-train", label: "Train a model", run: train },
    { role: "menu-models", label: "Find models to predict with", run: listModels },
  ]);

  startNew.addEventListener("click", () => chooseProject("new"));
  startOpen.addEventListener("click", () => chooseProject("open"));
  editBtn.addEventListener("click", () => setDirty(true));
  saveBtn.addEventListener("click", requestSave);
  root.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      requestSave();
    } else if (e.key === "Escape") {
      closeMenus();
    }
  });
  videoFind.addEventListener("click", () => {
    if (!host.resolveVideo) return say(videoResult, "This page does not look videos up.", "err");
    say(videoResult, "Looking…");
    host.resolveVideo(videoPath.value, currentRef()).then(
      (found) =>
        found
          ? say(videoResult, `Found ${found.name} (${found.fileType}).`, "ok")
          : say(videoResult, "No match.", "err"),
      (e: unknown) => say(videoResult, `Lookup failed: ${e instanceof Error ? e.message : String(e)}`, "err"),
    );
  });
  trainBtn.addEventListener("click", train);
  modelsBtn.addEventListener("click", listModels);
  cancelBtn.addEventListener("click", () => {
    if (jobId) void host.cancelJob?.(jobId);
  });

  return {
    async open(request) {
      const generation = ++opened;
      file = request;
      started = null;
      refs.set(generation, request.ref);
      setDirty(false);
      showProject(request.name, request.fileType);
      renderVideos([]);
      showVideo(null);
      card.hidden = false;
      videoSection.hidden = request.fileType !== "slp";
      say(probe, "Reading…");
      try {
        const head = await readHead(request.url, SIGNATURE_BYTES);
        if (opened !== generation) return;
        say(probe, `Read the first ${head.length} bytes with a ranged request: ${describeSignature(head)}.`, "ok");
      } catch (e) {
        if (opened !== generation) return;
        say(probe, `Could not read the file: ${e instanceof Error ? e.message : String(e)}`, "err");
      }
    },
    create(request) {
      const generation = ++opened;
      file = null;
      started = request;
      refs.set(generation, request.ref);
      // Nothing of a new project is saved until the first save writes its file.
      setDirty(true);
      showProject(request.name, "new project");
      renderVideos(request.videos);
      showVideo(request.videos[0] ?? null);
      videoSection.hidden = true;
      const count = request.videos.length === 1 ? "1 video" : `${request.videos.length} videos`;
      say(probe, `New project on ${count}. It is not saved yet: Save writes it.`);
      card.hidden = false;
      return Promise.resolve();
    },
    isDirty: () => dirty,
    unmount() {
      stopJob?.();
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("pointerdown", outside);
      root.remove();
    },
  };
}
