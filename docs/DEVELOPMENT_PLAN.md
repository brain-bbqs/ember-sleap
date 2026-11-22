# ember-sleap development plan

Draft, 2026-11-22. Supersedes the "extension registries" approach in the earlier feasibility report.

## Summary

ember-sleap will be a BBQS companion web app that **imports the SLEAP web app as a vendored npm component** and wraps it in our own page. Our page owns EMBER sign-in, opening and saving projects on EMBER, model catalogues, and job submission. The SLEAP app owns labeling, training and inference dialogs, and the job viewer.

Upstream (`talmolab/sleap-app`) does not publish an importable component today. We will prototype the changes it needs on a fork, prove the whole stack end to end, and contribute them upstream as a series of small PRs. The fork exists only to hold PR branches; once the PRs merge, ember-sleap depends on upstream's npm package and the fork goes away.

Rough effort: about 9 to 15 engineer-weeks for one developer. The end-to-end prototype with stubbed compute is the first 5 to 8. These are judgment-based estimates; upstream review time is the main swing factor.

## Decisions so far

- **No hard fork.** Upstream asked us to import and contribute rather than fork. We consume a published npm package and send what we need upstream.
- **A vendored component, not an iframe.** Upstream ships `mountSleapApp(el, options)` with React bundled inside, so our plain-DOM BBQS page does not need React.
- **Sign-in lives in our page.** EMBER OAuth with PKCE via [`@brain-bbqs/ember-client`](https://github.com/brain-bbqs/bbqs-web-components/tree/main/packages/ember-client). The archive's own login is GitHub accounts. The SLEAP app never sees sign-in UI.
- **Pennsieve is the only compute.** Training and inference go through a central proxy to a Pennsieve service account, built by another team. Local and SLEAP Connect compute are switched off in our build.
- **File URLs are extensionless blobs.** EMBER and proxy URLs are routed blob URLs with no file extension. The file type always travels alongside the URL.
- **Hosting is GitHub Pages** under a `*.brain-bbqs.org` hostname, per the BBQS app convention (bbqs-uploader is `upload.brain-bbqs.org`). The exact name is still open, e.g. `sleap.brain-bbqs.org`.

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
+---------------- ember-sleap page (GitHub Pages, *.brain-bbqs.org) ----------------+
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
  isDirty(): boolean;
  unmount(): void;
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
  files: { role: "config" | "checkpoint"; url: string; sha256?: string }[];
}
```

</details>

Notes:

- `TrainJobSpec` and `TrackJobSpec` are upstream's existing job types (`src/lib/sleapConnect.ts`), so the training and inference dialogs stay upstream's. For us, `labels_path`, `data_path` and `model_paths` hold EMBER URLs and model references instead of worker paths.
- `JobEvent` mirrors the events the job viewer already consumes (`job.status`, `job.log`, `job.result`, `job.epoch`).
- The app keeps 18 module-level state stores, so only one instance can be mounted per page. That is fine for us.

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
| 7a | Host storage callbacks: `save`, `resolveVideo`, `refreshUrl`, `open` | Medium | None by default |
| 7b | Host model catalogue: `listModels` and the model-card picker | Medium | None by default |
| 7c | Compute backend interface; host jobs; `compute.builtIn` switch | Large | None by default |
| 8 | Library build, `mountSleapApp`, package exports, `npm publish` in the release workflow | Medium | New distribution channel |

Order and process:

- PRs 1 and 2 are plain fixes; send them as soon as they are ready.
- PRs 3 to 6 are refactors with no visible change.
- PRs 7 and 8 define the public contract. Open the design proposal issue on `talmolab/sleap-app` ([draft](UPSTREAM_PROPOSAL.md)) before writing them.
- 7c touches the most-changed code (`connectStore.ts`). Raise it in the proposal early, send it last.

Other repositories:

- `talmolab/sleap-io.js`: possibly a small PR for declared file types in the streaming reader (PR 2).
- `talmolab/sleap-nn`: out of scope for this plan. sleap-nn changes, its licensing and the SLEAP container are handled separately.

## ember-sleap work (this repository)

### EMBER storage

Verified live against `api-dandi.emberarchive.org` on 2026-11-21 and 2026-11-22:

| Check | Result |
| --- | --- |
| API reads | CORS allowed for any origin; public dandisets need no login. |
| API writes | CORS allowed for `brain-bbqs.github.io` and any `*.brain-bbqs.org` origin; refused for an unlisted origin. |
| S3 bucket `ember-open-data` | Ranged GET returns 206 with `Access-Control-Allow-Origin: *`; preflight allows `PUT`; `ETag` is exposed for multipart upload. |
| Download links | `/api/assets/{id}/download/` redirects to a presigned S3 URL valid for 6 hours. |

Open: our EMBER picker (from `@brain-bbqs/ember-client` and `@brain-bbqs/ui`) resolves the asset to a URL and calls `app.open({ url, fileType, name, ref })`.

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
  sub-<label>/ses-<label>/beh/
    sub-<label>_ses-<label>_desc-labels_pose.slp
    sub-<label>_ses-<label>_desc-predictions_pose.slp
    sub-<label>_ses-<label>_desc-predictions_pose.nwb     ndx-pose export
  models/<model-id>/            training_config.yaml, best.ckpt, model card
```

The `_pose` suffix is not an official BIDS suffix; `.bidsignore` keeps validators quiet. The page writes `dataset_description.json` on first save, derives `sub-` and `ses-` from the source video's path, and asks when it cannot.

### Models

`host.listModels` merges three sources:

| Source | How models are found | Login |
| --- | --- | --- |
| Hugging Face | Hub search for repos tagged `sleap-nn`, each holding a model folder plus a model card | None for public repos; Hugging Face sign-in for gated ones |
| EMBER files | `derivatives/sleap/models/<id>/` in dandisets the user can read | EMBER, for embargoed data |
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
- [ ] **EMBER admins:** register a public OAuth app for ember-sleap with every serving URL as a redirect URI, including PR previews.
- [ ] **EMBER data team:** approve the `derivatives/sleap/` layout; confirm drafts holding `.slp` and `.ckpt` files can be published.
- [ ] **Proxy team:** caller auth, job API, file-type metadata on input URLs, result locations, who finishes the SLEAP Pennsieve app.
- [ ] **Us:** final hostname (e.g. `sleap.brain-bbqs.org`).
- [ ] **Us:** a test dandiset for end-to-end save tests.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Upstream wants a different contract | Rework of PRs 7 and 8 | Design proposal before writing them; keep 1 to 6 contract-free |
| Upstream pace (about 3 PRs a day) | Fork branches conflict | Weekly rebase; short stack; land early PRs fast |
| Style or portal refactors regress the standalone app | PRs rejected | Screenshot tests on every branch |
| Proxy job API not defined yet | Compute cannot be finished | Build against a stub; agree the API early |
| Proxy or Pennsieve outage | No training or inference, with no local fallback | Clear job status; labeling, open and save keep working |
| No BIDS standard for pose | Layout may change; validators may flag `.slp` | Confirm with the EMBER data team; also export NWB with `ndx-pose` |
| Tokens held in the browser | Script injection could act as the user on EMBER | Strict content security policy; short-lived tokens |

## References

- [talmolab/sleap-app](https://github.com/talmolab/sleap-app), including its [remote-compute guide](https://github.com/talmolab/sleap-app/blob/main/docs/guides/remote-compute.md) and [deploy workflow](https://github.com/talmolab/sleap-app/blob/main/.github/workflows/deploy.yml)
- [talmolab/sleap-nn](https://github.com/talmolab/sleap-nn) and [talmolab/sleap-io.js](https://github.com/talmolab/sleap-io.js)
- [brain-bbqs/bbqs-web-components](https://github.com/brain-bbqs/bbqs-web-components) (`@brain-bbqs/ember-client`, `@brain-bbqs/ui`), [bbqs-web-app-template](https://github.com/brain-bbqs/bbqs-web-app-template), [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader), [study-template](https://github.com/brain-bbqs/study-template)
- [aplbrain/sleap-docker-container](https://github.com/aplbrain/sleap-docker-container), [aplbrain/dandi-cli-docker](https://github.com/aplbrain/dandi-cli-docker)
- BIDS: [derivatives](https://bids-specification.readthedocs.io/en/stable/derivatives/introduction.html), [BEP047 audio/video PR #2231](https://github.com/bids-standard/bids-specification/pull/2231)
- EMBER dandisets referenced: [000398](https://dandi.emberarchive.org/dandiset/000398), [000598](https://dandi.emberarchive.org/dandiset/000598)
