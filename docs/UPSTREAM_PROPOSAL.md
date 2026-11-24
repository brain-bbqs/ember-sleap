# Draft: design proposal issue for `talmolab/sleap-app`

This is a draft for the BBQS team to review, edit and post as an issue on [talmolab/sleap-app](https://github.com/talmolab/sleap-app). Everything below the line is the issue text. See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the full plan behind it.

---

**Title:** Proposal: make sleap-app embeddable as an npm component

Thanks for suggesting we contribute upstream rather than fork. This issue lays out the shape we have in mind, so we can agree on it before writing the larger PRs.

## Summary

The BBQS data ecosystem (the EMBER archive, a DANDI instance) would like to offer SLEAP inside its own web tooling. Our page would handle EMBER sign-in, opening and saving projects on the archive, model catalogues, and sending training and inference jobs to remote compute. SLEAP would handle everything it does today.

To do that without a fork, we'd import sleap-app from npm and mount it inside our page. That needs two things from sleap-app:

1. It can be mounted inside another page without taking over the whole document.
2. The host page can handle a few actions: save, open, finding videos, listing models, and submitting jobs.

We'd do the work as a series of small PRs. The standalone app at app.sleap.ai and the desktop app would behave exactly as they do now; everything new is opt-in through mount options.

## Proposed API

Names and shapes are a starting point; we'd like your input.

```ts
// @talmolab/sleap-app
export function mountSleapApp(el: HTMLElement, options: MountOptions): SleapAppHandle;

export interface MountOptions {
  assetBaseUrl: string;                 // where the host serves h5wasm, decoders, templates
  compute?: { builtIn: boolean };       // false hides Local and SLEAP Connect
  pageEffects?: {                       // all default to true, matching today's behavior
    title?: boolean;                    // document.title
    beforeUnload?: boolean;
    urlParams?: boolean;                // ?open=
    debugGlobal?: boolean;              // window.sleap
  };
  host?: SleapHost;
}

export interface SleapHost {
  chooseProject?(intent: "new" | "open"): void;                          // New/Open Project, menu and start screen
  save?(file: Blob, name: string, ref?: HostRef): Promise<HostRef>;       // Ctrl+S, File > Save
  resolveVideo?(storedPath: string, project?: HostRef): Promise<ResolvedFile | null>;
  refreshUrl?(file: ResolvedFile): Promise<ResolvedFile>;                 // after a 403
  listModels?(query: { text?: string; skeletonNodes?: string[] }): Promise<ModelCard[]>;
  submitJob?(spec: TrainJobSpec | TrackJobSpec, project?: HostRef): Promise<{ jobId: string }>;
  subscribeJob?(jobId: string, onEvent: (e: JobEvent) => void): () => void;
  cancelJob?(jobId: string): Promise<void>;
}

export interface SleapAppHandle {
  open(file: ResolvedFile & { ref?: HostRef }): Promise<void>;
  create(project: NewProjectRequest): Promise<void>;                     // an unsaved project on the host's videos
  isDirty(): boolean;
  unmount(): void;
}

export interface NewProjectRequest {
  name: string;
  videos: (ResolvedFile & { storedPath: string })[];                     // storedPath: what the .slp records
  ref?: HostRef;                                                         // what its first save passes to host.save
}

export interface ResolvedFile {
  url: string;                          // may be an extensionless blob URL
  fileType: "slp" | "pkg.slp" | "mp4" | "avi" | "h5";
  name: string;
}

export type HostRef = { key: string };  // opaque to the app

export interface ModelCard {
  id: string;
  name: string;
  license?: string;
  species?: string;
  framework?: "sleap-nn" | "deeplabcut"; // absent for sleap-nn
  heads: ("centroid" | "centered_instance" | "bottomup" | "single_instance")[];
  skeleton?: { nodes: string[]; edges: [string, string][] };
  files: {
    role: "config" | "checkpoint" | "detector";
    folder: string;                     // the model folder: "" for a single one; a top-down
                                        // model has "centroid" and "centered_instance"
    url: string;
    sha256?: string;
  }[];
  sourceLabel?: string;                 // where the host found it, shown as is
}
```

`chooseProject` hands New Project… and Open Project… (the File menu and the start screen) to the host, which shows its own picker and answers through `create` or `open`; without it the app keeps its local file pickers. A host whose data lives in an archive, as ours does on EMBER, starts a project on videos it already holds, so the New Project dialog's video step is the host's while the project itself, and the `.slp` its first save writes, stay the app's.

`TrainJobSpec` and `TrackJobSpec` are the existing types in `src/lib/sleapConnect.ts`, and `JobEvent` would mirror the events the job viewer already consumes. That way the training and inference dialogs and the job viewer stay exactly as they are; only where a job goes changes.

A model card names the model folder of each file because sleap-nn loads a model one folder per head: a top-down model is a centroid folder and a centered-instance folder, and inference needs both, so the host sends a worker every folder of the model the picker chose; any other model is one folder. A card with `framework: "deeplabcut"` is one of DeepLabCut's pretrained SuperAnimal models, which the host runs with DeepLabCut: it declares no heads, its files are its pose `checkpoint` and its `detector`, and it is for inference only, so the app would offer it to predict with but never to train from.
`sourceLabel` is the host's own words for where it found a model (for example "from Hugging Face talmolab/mice-topdown"), which the picker shows beside it as it is and never parses or fetches.

## What we'd guarantee

- No change to the standalone or desktop app unless a host opts in.
- No EMBER- or BBQS-specific code in sleap-app; the host owns all of that.
- One app instance per page (the state stores are module-level, and we wouldn't change that).
- Your unit and Playwright suites pass on every PR. The style, portal and shortcut refactors come with screenshot tests.

## Proposed PRs

| # | PR | Size | Effect on the standalone app |
| --- | --- | --- | --- |
| 1 | Runtime files (h5wasm and friends) load from the base path. Today `${location.origin}/h5wasm/h5wasm.js` is hard-coded in 8 files, which breaks hosting under a sub-path | Small | Fixes sub-path hosting |
| 2 | URL loading accepts a declared file type, with byte sniffing as a fallback. Today the format comes from the URL's extension, so presigned and blob URLs fail | Small | Presigned and blob links work |
| 3 | Styles scoped to a `.sleap-app` root instead of `:root`, `html` and `body` | Medium | None |
| 4 | One container for all menu, dialog and tooltip portals (36 uses in 10 files) | Medium | None |
| 5 | Keyboard shortcuts bound to the app root instead of `window` | Medium | None |
| 6 | Page-level side effects (`document.title`, `beforeunload`, `?open=`, `window.sleap`) become options | Small | None by default |
| 7a | Host storage callbacks: `save`, `resolveVideo`, `refreshUrl`, `open`, `create`, `chooseProject` | Medium | None by default |
| 7b | Host model catalogue: `listModels` and a model-card picker | Medium | None by default |
| 7c | A compute backend interface, with Local and SLEAP Connect as built-ins and an option to hide them | Large | None by default |
| 8 | Library build, `mountSleapApp`, package exports, and `npm publish` in the release workflow | Medium | New way to distribute the app |

PRs 1 and 2 are plain fixes we could send right away. 3 to 6 are refactors with no visible change. 7 and 8 are the public contract, which is why we're asking before writing them.

## Questions for you

1. **Package name:** is `@talmolab/sleap-app` right?
2. **React:** a framework-free `mountSleapApp` with React bundled inside, a `<SleapApp />` export with React as a peer dependency, or both?
3. **Compute:** `connectStore.ts` changes often. Are you comfortable putting Local and SLEAP Connect behind a backend interface, and is there a shape or timing you'd prefer?
4. **Assets and workers:** would you ship h5wasm (5.5 MB) and the decoders (4.4 MB) inside the package, with hosts passing `assetBaseUrl`? Same question for the worker scripts.
5. **Versioning:** semver on the package, an explicit API version for the embed contract, or something else?
6. **Publishing:** may we add an `npm publish` step to the release workflow? We're happy to write it.
7. **Order and ownership:** anything you'd reorder, or pieces you'd rather do yourselves?

We'll prototype the whole series on a fork first, so we can show it working end to end and keep each PR small when it comes over.
