# ember-sleap development plan

Draft, 2026-11-22. Supersedes the "extension registries" approach in the earlier feasibility report.

**Contents**

- [Summary](#summary)
- [Decisions so far](#decisions-so-far)
- [Progress in this repository](#progress-in-this-repository)
- [Where upstream is today](#where-upstream-is-today)
- [Target architecture](#target-architecture)
- [The component contract](#the-component-contract)
- [Upstream changes needed](#upstream-changes-needed)
- [Prototype setup](#prototype-setup)
- [Validation](#validation)
- [PR series to upstream](#pr-series-to-upstream)
- [ember-sleap work (this repository)](#ember-sleap-work-this-repository)
  - [EMBER sign-in](#ember-sign-in)
  - [EMBER storage](#ember-storage)
  - [BIDS derivatives layout](#bids-derivatives-layout)
  - [Models](#models)
  - [Compute](#compute)
- [Milestones and effort](#milestones-and-effort)
- [Open questions](#open-questions)
- [References](#references)

## Summary

ember-sleap will be a BBQS companion web app that **imports the SLEAP web app as a vendored npm component** and wraps it in our own page. Our page owns EMBER sign-in, opening and saving projects on EMBER, model catalogues, and job submission. The SLEAP app owns labeling, training and inference dialogs, and the job viewer.

Upstream (`talmolab/sleap-app`) does not publish an importable component today. We will prototype the changes it needs on a fork, prove the whole stack end to end, and contribute them upstream as a series of small PRs. The fork exists only to hold PR branches; once the PRs merge, ember-sleap depends on upstream's npm package and the fork goes away.

Rough effort: about 9 to 15 engineer-weeks for one developer. The end-to-end prototype with stubbed compute is the first 5 to 8. These are judgment-based estimates; upstream review time is the main swing factor.

## Decisions so far

- **No hard fork.** Upstream asked us to import and contribute rather than fork. We consume a published npm package and send what we need upstream.
- **A vendored component, not an iframe.** Upstream ships `mountSleapApp(el, options)` with React bundled inside, so our plain-DOM BBQS page does not need React.
- **Sign-in lives in our page.** EMBER OAuth with PKCE via [`@brain-bbqs/ember-client`](https://github.com/brain-bbqs/bbqs-web-components/tree/main/packages/ember-client), using ember-sleap's own OAuth app (see [EMBER sign-in](#ember-sign-in)). The archive's own login is GitHub accounts. The SLEAP app never sees sign-in UI.
- **Pennsieve is the only compute.** Training and inference go through a central proxy to a Pennsieve service account, built by another team. Local and SLEAP Connect compute are switched off in our build.
- **File URLs are extensionless blobs.** EMBER and proxy URLs are routed blob URLs with no file extension. The file type always travels alongside the URL.
- **Hosting is GitHub Pages** at its default address, `https://brain-bbqs.github.io/ember-sleap/`, with PR previews under `/ember-sleap/pr-preview/pr-<n>/`. A `*.brain-bbqs.org` hostname, per the BBQS app convention (bbqs-uploader is `upload.brain-bbqs.org`), can come later by adding `public/CNAME` and updating `preview.yml`.

## Progress in this repository

Updated 2026-11-23. Nothing upstream has been touched: no PRs, issues or pushes to `talmolab/sleap-app`. This is a test run of the fork path below, on our fork [brain-bbqs/sleap-app](https://github.com/brain-bbqs/sleap-app). Its `embed/integration` branch makes the app mountable through the proposed contract (`src/lib/sleapContract.ts`): plan PRs 1, 2, 6, the storage half of 7a, and 8, shown as a stack of draft PRs within the fork to illustrate the upstream series: [brain-bbqs/sleap-app#1](https://github.com/brain-bbqs/sleap-app/pull/1) (asset base), [#2](https://github.com/brain-bbqs/sleap-app/pull/2) (declared file type), [#3](https://github.com/brain-bbqs/sleap-app/pull/3) (page effects), [#4](https://github.com/brain-bbqs/sleap-app/pull/4) (host storage) and [#5](https://github.com/brain-bbqs/sleap-app/pull/5) (mount and build). PRs 3 to 5 (style, portal and shortcut isolation) and 7b and 7c (models, compute) are not done. The fork's `embed/package` branch holds the build, which ember-sleap installs from GitHub, pinned to a commit, and serves at `sleap-app/`. A **stand-in** (`src/ui/sleapStandIn.ts`) still drives every host callback for the `?test` mocks and the unit tests, and for the model catalogue and compute the real app does not reach through the host yet.

| Milestone | ember-sleap part | State |
| --- | --- | --- |
| M1 | Scaffold from `bbqs-web-app-template`, with sign-in | Done. Sign-in goes through `@brain-bbqs/ember-client` with ember-sleap's own OAuth app on EMBER; its redirect URIs are still to confirm ([EMBER sign-in](#ember-sign-in)). Served at the GitHub Pages default, `brain-bbqs.github.io/ember-sleap/`, with no custom domain for now. |
| M3 | Mount the component | Done with the real app from the fork: it mounts at boot to its start screen, its New Project and Open Project go to the page's EMBER picker, its Save to EMBER storage, and a new project reads the dandiset's videos by their declared type over extensionless links (Playwright, `tests/integration/sleap-app.spec.ts`). Without PRs 3 to 5 its styles are global, so the page rolls its own element rules back inside the app (`src/style.css`), and at phone widths its menu bar runs past the edge. Every `pageEffects` is off; `compute.builtIn` is not honored yet (PR 7c). Between the BBQS header (SLEAP's logo and EMBER sign-in) and a trimmed BBQS footer (the version and source link bottom-left, the Talmo Lab and CON marks bottom-right, no What's New or issue links) the page is the SLEAP app, filling the window; like SLEAP, the page is dark only, with no theme toggle. A thin EMBER bar between the two says where the open project is and closes it. The stand-in, used by the `?test` mocks, is laid out like the SLEAP web app too. |
| M4 | Open and save on EMBER as BIDS derivatives | Open verified live (dandiset 000398: `glob` listing, `/download/` to a presigned S3 link, ranged read of the extensionless URL by declared type). Save runs end to end in Playwright against a routed archive (dandi-etag hashed in a worker pool, multipart upload, asset create or replace, `dataset_description.json` and `.bidsignore` on first save, one labels file per source project, and a replace / keep both / cancel question when that file exists); not yet run against the real archive. |
| M5 | Model sources | Hugging Face and EMBER `derivatives/sleap/models/` sources written and unit-tested. A card names the model folder of each file, so a top-down model carries its centroid and centered-instance folders (on EMBER, a subfolder per head) and a track job sends both; a folder without its config and checkpoint, or a top-down card without a folder per head, is left out, and folders that are not one top-down model's are listed as a model each. Each card says where it was found. The central `models.json` index source is held for a follow-up PR until its dandiset exists. Not live: Hugging Face is unreachable from the build sandbox. |
| M6 | Compute | Proxy client written against a drafted API ([COMPUTE_API.md](COMPUTE_API.md)); jobs run on an in-browser stub emitting upstream's `job.*` events until `COMPUTE_PROXY_URL` is set. A model the stub trains is listed in the picker under the id the EMBER source would give its folder, so inference can name it. Each job input carries its EMBER asset (id, path and stable `/download/` URL), a project saved since it was opened is sent as what its latest save wrote, and labels sent inline are saved to EMBER as a `desc-trainingset` package first, so the proxy only ever receives files on EMBER. A completed inference job's `predictions` are listed under the app (only `.slp` and `.pkg.slp` paths under `derivatives/sleap/` in the job's own dandiset; anything else is dropped with a warning) and open from EMBER by path, saying when a file is not there yet; proofreading one and saving writes `desc-labels<Source>` beside it. Runs end to end in Playwright against the stub and a routed archive. |

Validation checklist items covered so far, against the stand-in (see [Validation](#validation)): mounting without changing our header, rendering inside the app's box, Ctrl+S only inside the app, opening an extensionless EMBER link with a declared type, finding a video through `resolveVideo`, saving under `derivatives/sleap/`, the unsaved-work check on sign-out, jobs through the host with status and logs, no built-in compute, and everything loading from our own host. They need re-running once the real component mounts, since upstream's menus, dialogs and workers are what the isolation checks are really about.

## Where upstream is today

Facts from `talmolab/sleap-app` at commit `368db85` (2026-11-19, v0.1.2) unless noted.

| Item | Today | What it means for us |
| --- | --- | --- |
| npm | `package.json` is `"private": true`. Neither `sleap-app` nor `@talmolab/sleap-app` exists on npm. | Nothing to import yet. |
| GitHub Releases | Desktop installers and `latest.json` only. | No web bundle to download. |
| Built web app | Lives only on the `gh-pages` branch, one folder per version, each built for its own path. | Cannot be reused as-is under another path. |
| Importable today | [`@talmolab/sleap-io.js`](https://www.npmjs.com/package/@talmolab/sleap-io.js) 0.5.16 (2026-11-18): `.slp` read/write, no UI. | Useful directly in our page (e.g. reading metadata). |
| ML in the browser | None. Training and inference go to a desktop sidecar or a SLEAP Connect worker. | All compute is remote for us. |
| Pace | 50 commits in 16 days (Nov 3 to 19, 2026), about 3 merged PRs a day. | Keep the PR stack short and rebase weekly. |
| License | BSD-3-Clause. | Vendoring and contributing are fine. |

For reference only, since sleap-nn and the container are handled separately. From `talmolab/sleap-nn` 0.3.5 (commit `1537a2a`, 2026-11-11):

- Trained models load from **local disk only**. `resolve_model_dir` in `sleap_nn/config/utils.py` accepts a model folder or the `best.ckpt` / `training_config.yaml` inside it, and raises `FileNotFoundError` for anything else.
- `--data_path` already accepts `http(s)`, `s3`, `gs`, `gcs`, `az` and `abfs` URLs (`_REMOTE_URL_SCHEMES` in `sleap_nn/cli.py`). It chooses `.slp` vs. video by the URL's file extension, so extensionless blob URLs need a declared type or a download step.
- Only pretrained **backbones** come from Hugging Face (`backbone_config.pretrained`, `source: "hf"`).

## Target architecture

```text
+------------ ember-sleap page (GitHub Pages, brain-bbqs.github.io) ----------------+
|  BBQS shell: header, EMBER account menu, human-subjects gate, footer              |
|    @brain-bbqs/ui  +  @brain-bbqs/ember-client                                    |
|  +-------- mountSleapApp(el, { host }) from @talmolab/sleap-app ---------------+  |
|  |  labeling UI, training and inference dialogs, job viewer                    |  |
|  +-- host callbacks: save / resolveVideo / listModels / submitJob / events ---+  |
+-------------+------------------------+------------------------+-------------------+
              |                        |                        |
       EMBER archive            Hugging Face Hub       central Pennsieve proxy
      (DANDI API + S3)          (model metadata)           (other team)
                                                                |
                                                  Pennsieve run: SLEAP container
                                                  (reads and writes EMBER, pulls weights)
```

Everything we build is static and served by GitHub Pages. We run no servers dedicated to this app, beyond the other pre-existing services such as EMBER/Pennsieve.

## The component contract

A sketch to propose to upstream in a design proposal issue (draft: [UPSTREAM_PROPOSAL.md](UPSTREAM_PROPOSAL.md)). Names and shapes are open for discussion.

<details>
<summary>API sketch (TypeScript)</summary>

```ts
// @talmolab/sleap-app
export function mountSleapApp(el: HTMLElement, options: MountOptions): SleapAppHandle;

export interface MountOptions {
  assetBaseUrl: string;                 // where the host serves h5wasm, decoders, templates
  compute?: { builtIn: boolean };       // false hides Local and SLEAP Connect
  pageEffects?: {                       // all default to true for the standalone app
    title?: boolean;                    // document.title
    beforeUnload?: boolean;
    urlParams?: boolean;                // ?open=
    debugGlobal?: boolean;              // window.sleap
  };
  host?: SleapHost;
}

export interface SleapHost {
  chooseProject?(intent: "new" | "open"): void;                          // New/Open Project go to the host's picker
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
  create(project: NewProjectRequest): Promise<void>;                     // a new, unsaved project on the host's videos
  isDirty(): boolean;
  unmount(): void;
}

export interface NewProjectRequest {
  name: string;
  videos: (ResolvedFile & { storedPath: string })[];                     // storedPath: what the .slp records
  ref?: HostRef;
}

export interface ResolvedFile {
  url: string;
  fileType: "slp" | "pkg.slp" | "mp4" | "avi" | "h5";
  name: string;                         // display name; the URL itself may be an extensionless blob
}

export type HostRef = { key: string };  // opaque to the app, e.g. dandiset + asset path

export interface ModelCard {
  id: string;
  name: string;
  license?: string;
  species?: string;
  heads: ("centroid" | "centered_instance" | "bottomup" | "single_instance")[];
  skeleton?: { nodes: string[]; edges: [string, string][] };
  files: {
    role: "config" | "checkpoint";
    folder: string;                     // the model folder: "" for a single one; a top-down
                                        // model has "centroid" and "centered_instance"
    url: string;
    sha256?: string;
  }[];
  sourceLabel?: string;                 // where the host found it, shown as is
}
```

Notes:

- `TrainJobSpec` and `TrackJobSpec` are upstream's existing job types (`src/lib/sleapConnect.ts`), so the training and inference dialogs stay upstream's. For us, `labels_path`, `data_path` and `model_paths` hold EMBER URLs and model references instead of worker paths.
- `JobEvent` mirrors the events the job viewer already consumes (`job.status`, `job.log`, `job.result`, `job.epoch`).
- Each model file names its model folder, since sleap-nn loads one head per folder: a top-down model is two folders and inference needs both. `sourceLabel` is the host's own words for where it found a model; the structured record of Hugging Face, EMBER or the index stays on the host's side.
- The app keeps 18 module-level state stores, so only one instance can be mounted per page. That is fine for us.

</details>

## Upstream changes needed

Measured in `talmolab/sleap-app` at `368db85`.

| Problem | How much of it there is | Fix |
| --- | --- | --- |
| Runtime files load from the domain root | `${location.origin}/h5wasm/h5wasm.js` in 8 files: `loadProject.ts`, `hdf5VideoSource.ts`, `workerLabels.ts`, `saveLabelsInPlace.ts`, `saveEmbeddedPkgOpfs.ts`, `saveEmbeddedPkgStreaming.ts`, `draftRestore.ts`, `draftRestoreTauri.ts` | Resolve from the base path or `assetBaseUrl`. `newInstance.ts` already does it right. |
| URL loading picks the format by file extension | `loadProjectFromUrl`; the video URL check in `resolveVideos.ts` | Accept a declared file type; sniff the first bytes as a fallback (`.slp` is HDF5, MP4 has an `ftyp` box). |
| Global styles | Theme variables on `:root` (2 rules) plus `html` and `body` rules in `src/index.css`; Tailwind's page-wide reset | Scope everything under a `.sleap-app` root. |
| Menus, dialogs and tooltips render into `document.body` | 36 portal uses in 10 files | Route every portal to a container inside the app root. |
| Keyboard shortcuts listen on the whole window | `tinykeys(window, …)` in `useKeyboardShortcuts.ts`, plus 11 window/document keydown listeners | Bind to the app root. |
| Page-level side effects | 1 `document.title` write, 4 `beforeunload` handlers, 11 `window.location` reads, the `window.sleap` global in `main.tsx` | Make each opt-in via `pageEffects`. |
| Large runtime assets | `public/h5wasm` 5.5 MB, `public/decoders` 4.4 MB | Ship in the package; host copies them and passes `assetBaseUrl`. |
| Web workers | 2 `new Worker(...)` (`Seekbar.tsx`, `imageFeatures.ts`), 4 `?worker` imports, plus sleap-io.js's own streaming worker | Ship prebuilt worker files so the host's bundler does not have to handle them. |
| Desktop-only imports | 56 files import `@tauri-apps/*` | The library build uses the existing browser stubs. |
| Full-window layout | 1 `h-screen` / `100vh` | Fill the container. |
| Compute choice is hard-wired | `BackendPicker.tsx`, `connectStore.ts` (about 2.2k lines) | A backend interface; Local and SLEAP Connect become built-ins; the host can add its own and hide the built-ins. |
| No package | `"private": true`, no library build | Library build, package `exports`, `npm publish` in the release workflow. |

## Prototype setup

1. **Fork** `talmolab/sleap-app` to `brain-bbqs/sleap-app`. One branch per PR (`embed/01-asset-base`, `embed/02-file-type`, …), plus an `embed/integration` branch that merges the whole stack.
2. **Rebase weekly** on upstream `main`. Land the early PRs fast so the stack stays short.
3. **Fork CI** builds the library from `embed/integration` and attaches the package tarball to a pre-release. ember-sleap installs that tarball. When upstream publishes, we change one line in `package.json`.
4. **ember-sleap** is generated from [`bbqs-web-app-template`](https://github.com/brain-bbqs/bbqs-web-app-template): Vite, TypeScript, `@brain-bbqs/ui`, `@brain-bbqs/ember-client`, Vitest, Playwright. It mounts the component and deploys to Pages with PR previews.
5. **Compute** runs against a stub of the central proxy until the other team's job API exists.
6. **sleap-io.js** gets a fork only if PR 2 needs it (if its streaming reader decides file type from the name).

## Validation

Every fork branch must pass:

- Upstream's own suite: 200+ unit tests (`bun test`) and Playwright end-to-end tests. No PR may change how the standalone app behaves.
- Screenshot comparisons of the standalone app for the style, portal and shortcut PRs (3 to 5).

ember-sleap's Playwright suite must show:

- [ ] The app mounts inside our page; our header is pixel-identical before and after mounting.
- [ ] Menus, dialogs and tooltips render styled inside the app's box.
- [ ] Shortcuts fire only when focus is inside the app; Ctrl+S in our header does nothing.
- [ ] A public `.slp` opens from EMBER through an extensionless blob URL with a declared type (e.g. dandiset 000398).
- [ ] A plain `.slp` resolves its videos through `resolveVideo`.
- [ ] Edit, then Ctrl+S uploads a new draft asset to a test dandiset under `derivatives/sleap/`.
- [ ] The unsaved-work flag blocks sign-out until the user confirms.
- [ ] Training and inference jobs submit to the proxy stub; status and logs appear in upstream's job viewer.
- [ ] Local and SLEAP Connect compute are not offered.
- [ ] Assets and workers load from our hostname.

## PR series to upstream

| # | PR | Size | Effect on the standalone app |
| --- | --- | --- | --- |
| 1 | Runtime files load from the base path (8 files) | Small | Fixes hosting under a sub-path |
| 2 | URL loading accepts a declared file type, with byte sniffing as a fallback | Small | Presigned and blob links work |
| 3 | Styles scoped to a `.sleap-app` root instead of `:root`, `html` and `body` | Medium | None (screenshot-tested) |
| 4 | One container for all 36 portals | Medium | None |
| 5 | Keyboard shortcuts bound to the app root | Medium | None |
| 6 | Page-level side effects become options | Small | None by default |
| 7a | Host storage callbacks: `save`, `resolveVideo`, `refreshUrl`, `open`, `create`, `chooseProject` | Medium | None by default |
| 7b | Host model catalogue: `listModels` and the model-card picker | Medium | None by default |
| 7c | Compute backend interface; host jobs; `compute.builtIn` switch | Large | None by default |
| 8 | Library build, `mountSleapApp`, package exports, `npm publish` in the release workflow | Medium | New distribution channel |

Order and process:

- PRs 1 and 2 are plain fixes; send them as soon as they are ready.
- PRs 3 to 6 are refactors with no visible change.
- PRs 7 and 8 define the public contract. Open the design proposal issue on `talmolab/sleap-app` ([draft](UPSTREAM_PROPOSAL.md)) before writing them.
- 7c touches the most-changed code (`connectStore.ts`). Raise it in the proposal early, send it last.

Other repositories:

- `talmolab/sleap-nn`: out of scope for this plan. sleap-nn changes, its licensing and the SLEAP container are handled separately.

## ember-sleap work (this repository)

### EMBER sign-in

ember-sleap has its own public OAuth app on EMBER (PKCE, no client secret), separate from bbqs-uploader's so each tool can be revoked and audited on its own.
Its client ID, `cDxcl68boqpjgBoEXfh2bnuYxwWQLMdYfMnVrHNA`, is public, so it lives in `src/lib/oauth.ts` the way bbqs-uploader's lives in its source.
On 2026-11-23, EMBER's token endpoint recognized it as a public client: an exchange with a dummy code returned `invalid_grant`, where an unknown ID returns `invalid_client`.

Sign-in sends the page's own address (origin and path, without the query) as the redirect URI.
EMBER's OAuth server (django-oauth-toolkit) matches redirect URIs exactly by default, so each address the page is served from has to be registered on the app:

| Where | Redirect URI |
| --- | --- |
| Production | `https://brain-bbqs.github.io/ember-sleap/` |
| PR previews | `https://brain-bbqs.github.io/ember-sleap/pr-preview/pr-<n>/`, one per PR |
| `npm run dev` | `http://localhost:5173/` |
| `npm run preview` and Playwright | `http://localhost:4173/` |

Which of these are registered is not yet confirmed; it cannot be checked without signing in through a browser.

### EMBER storage

Verified live against `api-dandi.emberarchive.org` on 2026-11-21 and 2026-11-22:

| Check | Result |
| --- | --- |
| API reads | CORS allowed for any origin; public dandisets need no login. |
| API writes | CORS allowed for `brain-bbqs.github.io` and any `*.brain-bbqs.org` origin; refused for an unlisted origin. |
| S3 bucket `ember-open-data` | Ranged GET returns 206 with `Access-Control-Allow-Origin: *`; preflight allows `PUT`; `ETag` is exposed for multipart upload. |
| Download links | `/api/assets/{id}/download/` redirects to a presigned S3 URL valid for 6 hours. |

Open: the app's New Project… and Open Project… (menu and start screen) call `host.chooseProject`, and our EMBER picker asks for a dandiset. Open Project lists its SLEAP projects; opening one resolves the asset to a URL and calls `app.open({ url, fileType, name, ref })`. A dandiset with no SLEAP project yet, or any dandiset chosen for New Project, starts a new project on its `.mp4` and `.avi` videos (outside `derivatives/`): each is resolved to a link and recorded by its dandiset path, and `app.create({ name, videos, ref })` starts it unsaved, with `ref` at its first video, so the first save lands in that video's subject and session folder. The stand-in writes a new project's `.slp` with `@talmolab/sleap-io.js` (`saveSlpToBytes`), loaded only when that file is first needed.

Save: `host.save` receives the bytes and runs the upload sequence bbqs-uploader already uses: dandi-etag hash, `/uploads/initialize/`, multipart `PUT` to S3, `/complete/`, `/validate/`, then create the asset or `PUT` over the existing one.

- Saves change the dandiset's draft only; publishing stays a separate step.
- The user must own the dandiset. Reuse ember-client's dataset picker and the human-subjects gate.
- Autosave stays local (upstream's browser-storage drafts). Save to EMBER is explicit, so the archive is not flooded with revisions.
- Large `.pkg.slp` files (dandiset 000398 holds a 649 MB one) should stream from upstream's browser-storage export rather than one in-memory buffer.

### BIDS derivatives layout

No BIDS extension exists for pose estimation; BIDS reviewers treat pose annotations as derivatives, and EMBER's docs ask for NWB inside a BIDS layout with pose as `ndx-pose`. Proposed layout, to confirm with the EMBER data team:

```text
derivatives/sleap/
  dataset_description.json      DatasetType "derivative"; GeneratedBy: ember-sleap + sleap-app versions; SourceDatasets: this dandiset
  .bidsignore                   lists *.slp, *.ckpt, models/
  sub-<label>/[ses-<label>/]beh/
    sub-<label>[_ses-<label>][_task-<label>][_acq-<label>][_run-<index>][_recording-<label>]_desc-labels<Source>_pose.slp
    sub-<label>[_ses-<label>][...]_desc-predictions<Source>_pose.slp
    sub-<label>[_ses-<label>][...]_desc-predictions<Source>_pose.nwb     ndx-pose export
    sub-<label>[_ses-<label>][...]_desc-trainingset<Source><yyyymmddhhmmss>_pose.pkg.slp   labels a training run was sent unsaved
  models/<model-id>/            training_config.yaml, best.ckpt, model_card.json
  models/<model-id>/<head>/     training_config.yaml, best.ckpt per head when a model has several (top-down), model_card.json in models/<model-id>/
```

The `_pose` suffix is not an official BIDS suffix; `.bidsignore` keeps validators quiet. The page writes `dataset_description.json` and `.bidsignore` on the first save into a dandiset.

Each source project gets its own labels file, so two projects of one session never share one. The file keeps the source name's `task`, `acq`, `run` and `recording` entities, and `<Source>` is one CamelCase word made of the source's folders below its subject and session (datatype folders such as `beh` aside), what its own `desc` adds after `labels` or `predictions`, and the rest of its name, minus a trailing `pose` or `labels`. So `sub-01/ses-01/beh/cam-top.slp` saves to `derivatives/sleap/sub-01/ses-01/beh/sub-01_ses-01_desc-labelsCamTop_pose.slp`. Inference writes `desc-predictions<Source>` beside it, and proofreading those predictions saves back to the same labels file. Training on edits not yet saved keeps them beside it too, as a `desc-trainingset<Source><yyyymmddhhmmss>` package (UTC) of each run's own, which never goes over the labels file.

A labels file already in `derivatives/sleap/` is saved back over itself. Any other source, a predictions file included, is never written over: it gets a labels file of its own. When that file already exists (an earlier save of the same source, or another source whose name reads the same), the page asks whether to replace it, keep both (the new labels go beside it as `desc-labels<Source>2`, the first free number), or cancel.

The page reads `sub-` and `ses-` from the source's folders (including a folder such as `sub-01_ses-day1_behavior+image/`) or its file name. It asks for them when it cannot read a subject that is a BIDS label (letters and digits only), or when the path names a session it cannot read one for, so `ses-day-1` is asked about rather than dropped. The dialog offers the path's own labels, with everything else removed, as the answer to check.

### Models

`host.listModels` merges three sources:

| Source | How models are found | Login |
| --- | --- | --- |
| Hugging Face | Hub listing of repos tagged `sleap-nn` (up to four pages), each holding a model folder (a folder per head for top-down) plus a model card; the picker's text is matched in the page | None for public repos; Hugging Face sign-in for gated ones |
| EMBER files | `derivatives/sleap/models/<id>/` in dandisets the user can read, one model folder or a subfolder per head | EMBER, for embargoed data |
| Central index | A designated EMBER dandiset holding `models.json`; each entry points to a Hugging Face repo or EMBER path with version, checksum, skeleton and license | None |

No SLEAP model catalogue exists yet ([`bbqs_model_zoo`](https://github.com/brain-bbqs/bbqs_model_zoo) is an empty stub), so we create the index. The browser fetches only small metadata files; weights go straight from Hugging Face or S3 to the Pennsieve container.

### Compute

`host.submitJob`, `subscribeJob` and `cancelJob` call the central proxy. What we need from the proxy team:

- **Caller auth:** ideally the user's EMBER token, so sign-on stays single; CORS for our hostname.
- **Job API:** submit, status and logs, cancel, result locations. A training job carries a `.pkg.slp` on EMBER plus a sleap-nn config; an inference job carries video assets plus a model reference. Every input URL carries its file type.
- **Models:** the container downloads model folders to local disk before running, since sleap-nn only loads local paths. Gated Hugging Face models need a token on that side.
- **Results:** written to `derivatives/sleap/` in the source dandiset by the service account, with the requesting user recorded in provenance.
- **The SLEAP app on Pennsieve:** [`aplbrain/sleap-docker-container`](https://github.com/aplbrain/sleap-docker-container) wraps `sleap-nn train` and `track` but has no `app.yml` yet. Confirm who finishes it.

A precedent exists: dandiset 000598 holds an EMBER → Pennsieve → EMBER DeepLabCut training run (2026-10-23) and inference run (2026-11-09).

## Milestones and effort

| Milestone | Deliverable | Effort |
| --- | --- | --- |
| M0 Agreements | Design proposal issue upstream; EMBER OAuth app and hostname; BIDS layout approved; proxy job API drafted | 1 week elapsed |
| M1 Foundations | Fork set up with CI tarballs; PRs 1 and 2; ember-sleap scaffolded from the template with sign-in | 1 to 1.5 weeks |
| M2 Embeddable app | PRs 3 to 6 on the fork, upstream tests and screenshots green | 1.5 to 2 weeks |
| M3 Contract | PRs 7a and 8 on the fork; ember-sleap mounts the fork build | 1.5 to 2.5 weeks |
| M4 EMBER storage | Open and save on EMBER as BIDS derivatives, end to end | 1 to 2 weeks |
| M5 Models | PR 7b; Hugging Face, EMBER and index sources; index dandiset | 2 to 4 weeks |
| M6 Compute | PR 7c; proxy client against the stub, then the real proxy | 2 to 3 weeks |
| M7 Switch to upstream | Replace the fork tarball with upstream's npm package; retire the fork | Depends on upstream review |

M1 to M4 is the end-to-end prototype with stubbed compute (about 5 to 8 weeks). M5 and M6 can run in parallel with a second developer once M3 lands. M6 depends on the proxy's job API.

## Open questions

- [ ] **Talmo Lab:** agree the component contract (mount options, host callbacks) and the PR order.
- [x] **EMBER admins:** register a public OAuth app for ember-sleap (client ID `cDxcl68boqpjgBoEXfh2bnuYxwWQLMdYfMnVrHNA`).
- [ ] **EMBER admins:** confirm the redirect URIs listed under [EMBER sign-in](#ember-sign-in) are registered, and how PR previews should be handled, since each has its own address.
- [ ] **EMBER data team:** approve the `derivatives/sleap/` layout; confirm drafts holding `.slp` and `.ckpt` files can be published.
- [ ] **Proxy team:** caller auth, job API, file-type metadata on input URLs, result locations, who finishes the SLEAP Pennsieve app.
- [x] **Us:** hostname. The GitHub Pages default (`https://brain-bbqs.github.io/ember-sleap/`) for now; a `*.brain-bbqs.org` name later needs `public/CNAME`, `preview.yml` and a DNS record. The EMBER OAuth app's redirect URIs follow whichever is in use.
- [ ] **Us:** a test dandiset for end-to-end save tests.
- [ ] **EMBER data team:** does the archive accept a dotfile asset (`derivatives/sleap/.bidsignore`)? The page writes it on first save and only warns if it is refused.
- [x] **Us / proxy team:** presigned links last 6 hours and a queued job can outlive them. Handled in [#10](https://github.com/brain-bbqs/ember-sleap/pull/10): each job input carries its asset's id, path and stable `/download/` URL, for the worker to renew the link from ([COMPUTE_API.md](COMPUTE_API.md#job-request)).
- [ ] **Us:** opening an embargoed asset follows `/download/` with the user's token and relies on the browser dropping `Authorization` on the cross-origin redirect to S3; verify with a real embargoed dandiset.
- [x] **Us:** an index entry and the same Hugging Face repo listed directly both appeared in the model list. Handled with the index source held for a follow-up PR: index entries replace the direct listing of a Hugging Face or EMBER model whose every model folder they name.
- [ ] **Us:** the archive upload sequence and the dandi-etag worker pool are now copied in two apps (bbqs-uploader and here, `src/lib/emberUpload.ts` and `src/lib/etagPool.ts`), which makes them candidates for `@brain-bbqs/ember-client`.
- [ ] **Us:** `src/main.ts` refreshes tokens once however many calls need it, follows another tab's refresh or sign-out, and writes each stored setting without touching the others; sibling apps need the same, so these are candidates for `@brain-bbqs/ember-client`. A human-subjects flag that could not be read is kept apart from an unflagged one here; `createHumanSubjectsGate` in `@brain-bbqs/ui` could grow an "unknown" state for it.

## References

- [talmolab/sleap-app](https://github.com/talmolab/sleap-app), including its [remote-compute guide](https://github.com/talmolab/sleap-app/blob/main/docs/guides/remote-compute.md) and [deploy workflow](https://github.com/talmolab/sleap-app/blob/main/.github/workflows/deploy.yml)
- [talmolab/sleap-nn](https://github.com/talmolab/sleap-nn) and [talmolab/sleap-io.js](https://github.com/talmolab/sleap-io.js)
- [brain-bbqs/bbqs-web-components](https://github.com/brain-bbqs/bbqs-web-components) (`@brain-bbqs/ember-client`, `@brain-bbqs/ui`), [bbqs-web-app-template](https://github.com/brain-bbqs/bbqs-web-app-template), [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader), [study-template](https://github.com/brain-bbqs/study-template)
- [aplbrain/sleap-docker-container](https://github.com/aplbrain/sleap-docker-container), [aplbrain/dandi-cli-docker](https://github.com/aplbrain/dandi-cli-docker)
- BIDS: [derivatives](https://bids-specification.readthedocs.io/en/stable/derivatives/introduction.html), [BEP047 audio/video PR #2231](https://github.com/bids-standard/bids-specification/pull/2231)
- EMBER dandisets referenced: [000398](https://dandi.emberarchive.org/dandiset/000398), [000598](https://dandi.emberarchive.org/dandiset/000598)
