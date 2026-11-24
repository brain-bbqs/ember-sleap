// The embed contract between this page and the SLEAP web app, as proposed to talmolab/sleap-app in
// docs/UPSTREAM_PROPOSAL.md, and as our fork's build implements it (brain-bbqs/sleap-app,
// src/embed/contract.ts): storage (open, create, save, resolveVideo) and the project picker. The
// proposal's model catalogue and host compute come later, with the fork's own support for them.
// src/ui/sleapStandIn.ts mounts against these same types for the unit tests and the `?test` mocks.

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

/** A video a new project starts with: where to read it, and the path the project file records for it. */
export interface ProjectVideo extends ResolvedFile {
  /** What `host.resolveVideo` is given to find the video again once the saved project is reopened. */
  storedPath: string;
}

/** A project the app starts, unsaved; its first save goes to `host.save` with `ref`. */
export interface NewProjectRequest {
  name: string;
  videos: ProjectVideo[];
  ref?: HostRef;
}

export type ProjectIntent = "new" | "open";

export interface SleapHost {
  /**
   * New Project… and Open Project… (the File menu and the start screen) go to the host rather than
   * the browser's file pickers. The host shows its own picker and answers through the handle's
   * `create` or `open`; without this callback the app picks local files as the standalone app does.
   */
  chooseProject?(intent: ProjectIntent): void;
  save?(file: Blob, name: string, ref?: HostRef): Promise<HostRef>;
  resolveVideo?(storedPath: string, project?: HostRef): Promise<ResolvedFile | null>;
  refreshUrl?(file: ResolvedFile): Promise<ResolvedFile>;
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
  /** Starts a new project from the host's videos in place of whatever is open. */
  create(request: NewProjectRequest): Promise<void>;
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
