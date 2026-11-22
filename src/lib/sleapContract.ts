// The embed contract between this page and the SLEAP web app, as proposed to talmolab/sleap-app in
// docs/UPSTREAM_PROPOSAL.md. Nothing upstream implements it yet: until `@talmolab/sleap-app` is
// published, src/ui/sleapStandIn.ts mounts in its place against these same types, so the host side
// (EMBER storage, model catalogue, compute) is built and tested against the contract rather than
// against any one implementation of it. When the real package ships, these types are replaced by
// its own exports and anything that no longer compiles is a contract change to talk through.

/** What a URL holds. The URL itself is often an extensionless blob, so the type always travels beside it. */
export type FileType = "slp" | "pkg.slp" | "mp4" | "avi" | "h5";

export interface ResolvedFile {
  url: string;
  fileType: FileType;
  /** For display; the URL may say nothing about the file's name. */
  name: string;
}

/** Opaque to the app; this page encodes an EMBER dandiset and asset path in it (see hostRef.ts). */
export interface HostRef {
  key: string;
}

export type ModelHead = "centroid" | "centered_instance" | "bottomup" | "single_instance";

export interface ModelSkeleton {
  nodes: string[];
  edges: [string, string][];
}

export interface ModelFile {
  role: "config" | "checkpoint";
  /**
   * The model folder the file belongs to, as a path below where the host keeps the model: "" for
   * one kept at the top, or e.g. "centroid" and "centered_instance" for the two folders of a
   * top-down model. sleap-nn loads a model from a folder holding one head's config and checkpoint,
   * so every folder a card names has exactly one of each, and only a top-down card names two.
   */
  folder: string;
  url: string;
  sha256?: string;
}

export interface ModelCard {
  id: string;
  name: string;
  license?: string;
  species?: string;
  heads: ModelHead[];
  skeleton?: ModelSkeleton;
  files: ModelFile[];
  /** Where the host found the model, in its own words, which the picker shows as they are. */
  sourceLabel?: string;
}

export interface ModelQuery {
  text?: string;
  skeletonNodes?: string[];
}

// The slices of upstream's job specs (`src/lib/sleapConnect.ts`, talmolab/sleap-app@368db85) that
// this page reads. Upstream's full types carry more optional fields and stay assignable to these.
// For this host, `labels_path`, `data_path` and `model_paths` hold EMBER URLs and model card ids
// rather than paths on a worker's disk, and `labels_content` (an `.slp` file's bytes in base64, as
// upstream sends "labels from this window") is saved to EMBER before the job goes to compute. Being
// a string, it is capped by the browser's longest one: about 384 MiB of labels in Chromium.

export interface TrainJobSpec {
  type: "train";
  config_contents: string[];
  model_types: string[];
  labels_path?: string;
  labels_content?: string | null;
  val_labels_path?: string;
  max_epochs?: number;
  batch_size?: number;
  learning_rate?: number;
  run_name?: string;
}

export interface TrackJobSpec {
  type: "track";
  data_path: string;
  model_paths: string[];
  output_path?: string;
  batch_size?: number;
  peak_threshold?: number;
  tracker?: string;
  max_tracks?: number;
}

export type JobSpec = TrainJobSpec | TrackJobSpec;

/**
 * One event in a job's stream, shaped like upstream's `WorkerEvent` so its job viewer can fold it
 * unchanged: `job.status` ({ state, detail }), `job.log` ({ line, progress }), `job.result`, and
 * the training telemetry topics `job.epoch` ({ epoch, train_loss, val_loss }), `job.curve` and
 * `job.metric`. `seq` increases per job; the viewer drops anything at or below the last one seen.
 */
export interface JobEvent {
  topic: string;
  seq: number;
  jobId?: string;
  data: Record<string, unknown>;
}

export type JobState = "queued" | "running" | "completed" | "failed" | "canceled";

export interface SleapHost {
  save?(file: Blob, name: string, ref?: HostRef): Promise<HostRef>;
  resolveVideo?(storedPath: string, project?: HostRef): Promise<ResolvedFile | null>;
  refreshUrl?(file: ResolvedFile): Promise<ResolvedFile>;
  listModels?(query: ModelQuery): Promise<ModelCard[]>;
  submitJob?(spec: JobSpec, project?: HostRef): Promise<{ jobId: string }>;
  subscribeJob?(jobId: string, onEvent: (event: JobEvent) => void): () => void;
  cancelJob?(jobId: string): Promise<void>;
}

/** Everything the standalone app does to the page around it, each opt-out for an embedding host. */
export interface PageEffects {
  title?: boolean;
  beforeUnload?: boolean;
  urlParams?: boolean;
  debugGlobal?: boolean;
}

export interface MountOptions {
  /** Where the host serves the app's runtime files (h5wasm, decoders, workers). */
  assetBaseUrl: string;
  /** `builtIn: false` hides the Local and SLEAP Connect backends, leaving only the host's. */
  compute?: { builtIn: boolean };
  pageEffects?: PageEffects;
  host?: SleapHost;
}

export type OpenRequest = ResolvedFile & { ref?: HostRef };

export interface SleapAppHandle {
  open(file: OpenRequest): Promise<void>;
  isDirty(): boolean;
  unmount(): void;
}

export type MountSleapApp = (el: HTMLElement, options: MountOptions) => SleapAppHandle;

/** This page embeds the app with every page-level side effect off: the page owns all of them. */
export const EMBEDDED_PAGE_EFFECTS: Required<PageEffects> = {
  title: false,
  beforeUnload: false,
  urlParams: false,
  debugGlobal: false,
};
