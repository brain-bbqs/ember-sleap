// A stand-in for `mountSleapApp` from `@talmolab/sleap-app`, which is not published yet. It does
// none of SLEAP's work; it holds the app's place in the page and drives every host callback the
// way the contract (src/lib/sleapContract.ts) says the real app will: it reads the opened file over
// ranged requests by its declared type, saves through `host.save` (after `host.refreshUrl` when the
// open link has expired), finds videos through `host.resolveVideo`, lists models and submits,
// follows and cancels jobs through the host, and keeps its keyboard shortcut and page side effects
// inside the box it was mounted in. When the real package ships, src/ui/sleapComponent.ts mounts
// that instead and this file goes.
import { button, h } from "@brain-bbqs/ui";
import { humanSize } from "@brain-bbqs/utils";
import type {
  HostRef,
  JobEvent,
  ModelCard,
  MountOptions,
  OpenRequest,
  SleapAppHandle,
  TrackJobSpec,
  TrainJobSpec,
} from "../lib/sleapContract";

export const STAND_IN_VERSION = "0.0.0-stand-in";

const HOST_BACKEND = "host";
const BUILT_IN_BACKENDS = [
  ["local", "Local"],
  ["connect", "SLEAP Connect"],
] as const;
const SIGNATURE_BYTES = 12;
// The minimum a sleap-nn training config needs to name what it trains; the real app's training
// dialog builds the full one.
const STAND_IN_CONFIG = "model_config:\n  head_configs:\n    single_instance: {}\ntrainer_config:\n  max_epochs: 3\n";

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

export function mountStandIn(el: HTMLElement, options: MountOptions): SleapAppHandle {
  const { host = {}, pageEffects = {}, compute } = options;
  let file: OpenRequest | null = null;
  let ref: HostRef | undefined;
  let dirty = false;
  let stopJob: (() => void) | null = null;
  let jobId: string | null = null;
  // Bumped by every open(), so work that outlives the project it started for leaves the next one alone.
  let opened = 0;

  const root = h("div", "sleap-app sleap-standin");
  root.tabIndex = -1;
  const banner = h("p", "standin-banner");
  banner.append(
    h("strong", null, "SLEAP component stand-in. "),
    "It holds the place of @talmolab/sleap-app until that is published, and drives the same host callbacks.",
  );

  const fileName = role("span", "file-name", "standin-file-name", "No project open");
  const fileType = role("span", "file-type", "badge");
  fileType.hidden = true;
  const dirtyBadge = role("span", "dirty", "badge warn", "Unsaved changes");
  dirtyBadge.hidden = true;
  const probe = role("p", "file-probe", "hint");
  const fileRow = h("div", "standin-row");
  fileRow.append(fileName, fileType, dirtyBadge);

  const editBtn = role("button", "edit", null, "Make an edit");
  editBtn.type = "button";
  const saveBtn = role("button", "save", "primary", "Save (Ctrl+S)");
  saveBtn.type = "button";
  const actions = h("div", "standin-row");
  actions.append(editBtn, saveBtn);
  const saveStatus = role("p", "save-status", "hint");

  const videoPath = role("input", "video-path");
  videoPath.type = "text";
  videoPath.placeholder = "e.g. C:\\lab\\videos\\session1.mp4";
  const videoLabel = h("label", "standin-field", "Find a video by the path the project stored: ");
  videoLabel.append(videoPath);
  const videoFind = role("button", "video-find", null, "Find video");
  videoFind.type = "button";
  const videoResult = role("p", "video-result", "hint");
  const videoSection = role("div", "video", "standin-section");
  const videoRow = h("div", "standin-row");
  videoRow.append(videoLabel, videoFind);
  videoSection.append(videoRow, videoResult);
  videoSection.hidden = true;

  const backend = role("select", "backend");
  if (compute?.builtIn !== false) {
    for (const [value, label] of BUILT_IN_BACKENDS) backend.append(new Option(label, value));
  }
  if (host.submitJob) backend.append(new Option("EMBER compute (host)", HOST_BACKEND, true, true));
  const backendLabel = h("label", "standin-field", "Run on: ");
  backendLabel.append(backend);
  const trainBtn = role("button", "train", null, "Train a model");
  trainBtn.type = "button";
  const modelsBtn = role("button", "list-models", null, "Find models to predict with");
  modelsBtn.type = "button";
  const computeActions = h("div", "standin-row");
  computeActions.append(backendLabel, trainBtn, modelsBtn);
  const computeStatus = role("p", "compute-status", "hint");
  const models = role("ul", "models", "standin-models");

  const jobState = role("span", "job-state", "badge");
  const jobLabel = role("span", "job-id", "standin-job-id");
  const cancelBtn = role("button", "job-cancel", null, "Cancel job");
  cancelBtn.type = "button";
  const jobRow = h("div", "standin-row");
  jobRow.append(jobLabel, jobState, cancelBtn);
  const jobLog = role("pre", "job-log", "standin-job-log");
  const jobPane = role("div", "job", "standin-section");
  jobPane.append(jobRow, jobLog);
  jobPane.hidden = true;

  const computeSection = h("div", "standin-section");
  computeSection.append(h("h3", null, "Train and predict"), computeActions, computeStatus, models, jobPane);

  root.append(banner, fileRow, probe, actions, saveStatus, videoSection, computeSection);
  el.append(root);

  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (dirty) e.preventDefault();
  };
  if (pageEffects.beforeUnload !== false) window.addEventListener("beforeunload", beforeUnload);

  function setDirty(value: boolean): void {
    dirty = value;
    dirtyBadge.hidden = !value;
  }

  function say(target: HTMLElement, text: string, tone?: "ok" | "err"): void {
    target.textContent = text;
    target.classList.toggle("ok", tone === "ok");
    target.classList.toggle("err", tone === "err");
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

  async function save(): Promise<void> {
    if (!file) return say(saveStatus, "Open a project before saving.", "err");
    if (!host.save) return say(saveStatus, "This page does not offer saving.", "err");
    const project = file;
    const from = ref;
    const generation = opened;
    const isCurrent = () => opened === generation;
    say(saveStatus, "Saving…");
    try {
      // The real app serializes its edited labels; the stand-in has no edits of its own to write,
      // so it sends the project's bytes back unchanged through the same callback.
      const blob = await readProject(project, isCurrent);
      const saved = await host.save(blob, project.name, from);
      // The host's own status line reports where an earlier project's save landed; taking its ref
      // here would point the project now open at that project's file.
      if (!isCurrent()) return;
      ref = saved;
      setDirty(false);
      say(saveStatus, `Saved ${humanSize(blob.size)}.`, "ok");
    } catch (e) {
      if (isCurrent()) say(saveStatus, `Save failed: ${e instanceof Error ? e.message : String(e)}`, "err");
    }
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

  async function submit(spec: TrainJobSpec | TrackJobSpec): Promise<void> {
    say(computeStatus, "Submitting…");
    try {
      const { jobId: id } = await host.submitJob!(spec, ref);
      say(computeStatus, "");
      followJob(id);
    } catch (e) {
      say(computeStatus, `Could not submit: ${e instanceof Error ? e.message : String(e)}`, "err");
    }
  }

  function renderModel(card: ModelCard, dataPath: string): HTMLLIElement {
    const item = h("li");
    const facts = [card.heads.join(", "), card.species, card.license].filter(Boolean).join(" · ");
    const predict = button(null, "Predict");
    predict.dataset.role = "predict";
    predict.addEventListener("click", () => {
      if (hostCompute()) void submit({ type: "track", data_path: dataPath, model_paths: [card.id] });
    });
    item.append(h("strong", null, card.name), h("span", "hint", ` ${facts} `), predict);
    return item;
  }

  editBtn.addEventListener("click", () => setDirty(true));
  saveBtn.addEventListener("click", () => void save());
  root.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  });
  videoFind.addEventListener("click", () => {
    if (!host.resolveVideo) return say(videoResult, "This page does not look videos up.", "err");
    say(videoResult, "Looking…");
    host.resolveVideo(videoPath.value, ref).then(
      (found) =>
        found
          ? say(videoResult, `Found ${found.name} (${found.fileType}).`, "ok")
          : say(videoResult, "No match.", "err"),
      (e: unknown) => say(videoResult, `Lookup failed: ${e instanceof Error ? e.message : String(e)}`, "err"),
    );
  });
  trainBtn.addEventListener("click", () => {
    if (!file || !hostCompute()) return;
    void submit({
      type: "train",
      config_contents: [STAND_IN_CONFIG],
      model_types: ["single_instance"],
      labels_path: file.url,
      max_epochs: 3,
      run_name: "stand-in",
    });
  });
  modelsBtn.addEventListener("click", () => {
    if (!file || !host.listModels) return;
    const dataPath = file.url;
    say(computeStatus, "Listing models…");
    models.replaceChildren();
    host.listModels({}).then(
      (cards) => {
        say(computeStatus, cards.length ? "" : "No models found.");
        models.append(...cards.map((card) => renderModel(card, dataPath)));
      },
      (e: unknown) => say(computeStatus, `Could not list models: ${e instanceof Error ? e.message : String(e)}`, "err"),
    );
  });
  cancelBtn.addEventListener("click", () => {
    if (jobId) void host.cancelJob?.(jobId);
  });

  return {
    async open(request) {
      const generation = ++opened;
      file = request;
      ref = request.ref;
      setDirty(false);
      fileName.textContent = request.name;
      fileType.textContent = request.fileType;
      fileType.hidden = false;
      videoSection.hidden = request.fileType !== "slp";
      say(saveStatus, "");
      if (pageEffects.title !== false) document.title = `${request.name} - SLEAP`;
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
    isDirty: () => dirty,
    unmount() {
      stopJob?.();
      window.removeEventListener("beforeunload", beforeUnload);
      root.remove();
    },
  };
}
