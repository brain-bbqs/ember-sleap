# Draft: the job API ember-sleap needs from the central Pennsieve proxy

Draft, 2026-11-22, for the proxy team to review.
Nothing here is built on the proxy side yet; every name and shape is open for discussion.
See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md#compute) for where this fits.

ember-sleap is a static page on GitHub Pages with no server of its own.
It sends SLEAP training and inference jobs to the central proxy, which runs them on Pennsieve under a service account, reading inputs from and writing results to the EMBER archive.
Until this API exists, the page runs against an in-browser stub (`src/lib/computeStub.ts`) that speaks the same request and event shapes, and the client for the real proxy is `createProxyComputeClient` in `src/lib/computeClient.ts`.

**Contents**

- [Caller auth and CORS](#caller-auth-and-cors)
- [Endpoints](#endpoints)
- [Job request](#job-request)
- [Event stream](#event-stream)
- [Inputs, models and results](#inputs-models-and-results)
- [Open questions](#open-questions)

## Caller auth and CORS

- Every request carries the signed-in user's EMBER access token as `Authorization: Bearer <token>`, the same token the page already uses against the EMBER API.
  The proxy checks it against EMBER, so a user signs in once.
- This is the one exception [SECURITY.md](../SECURITY.md#the-compute-proxy-exception) makes to never forwarding a user's token: the proxy may use it only to identify the user and check their access on EMBER, and must not store it or read or write EMBER with it.
- The proxy records that user as the requester of each job, and refuses a job whose inputs or destination dandiset the user cannot read or write on EMBER.
- CORS must allow the page's origin, `https://brain-bbqs.github.io`: the page is served at `https://brain-bbqs.github.io/ember-sleap/`, with PR previews under the same host. Allowing any `https://*.brain-bbqs.org` too keeps a later custom hostname working.
  Allowed methods `GET` and `POST`; allowed request headers `Authorization` and `Content-Type`.

## Endpoints

All paths are relative to one base URL the page is configured with, for example `https://<proxy-host>/v1`.

| Method and path                     | Body          | Success response                    |
| ----------------------------------- | ------------- | ----------------------------------- |
| `POST /jobs`                        | a job request | `201` or `200`: `{ "job_id": "…" }` |
| `GET /jobs/{job_id}/events?after=N` | none          | `200`: `{ "events": [ … ] }`        |
| `POST /jobs/{job_id}/cancel`        | none          | `200`, `202` or `204`               |

- `job_id` is an opaque string; the page escapes it into the path.
- `events?after=N` returns every event with `seq > N`, oldest first, possibly none.
  The page polls it every 2 seconds and stops after a terminal `job.status` event.
  A server-sent-events or WebSocket variant can come later with the same event objects.
- Any non-2xx status is an error; a JSON body `{ "detail": "…" }` with a human-readable reason is welcome on `4xx`.
- A failed poll (a network error, `401` while the user is signed out, `5xx`) is retried, waiting twice as long after each failure up to 30 seconds, and back to every 2 seconds after the next success.
- `404` or `410` from `events` means the proxy has no record of the job.
  The page then ends the job in its viewer as `failed` ("The compute proxy no longer knows this job") and stops polling, so answer `404` only for a job id the proxy never issued or has forgotten, never for one that is still running.
- Cancelling a job that has already ended should succeed and change nothing.

## Job request

The body of `POST /jobs`.
`spec` is SLEAP's own job spec, as sleap-app's training and inference dialogs build it (`TrainJobSpec` and `TrackJobSpec` in talmolab/sleap-app's `src/lib/sleapConnect.ts`), so the proxy can pass it to the SLEAP container nearly as-is.
The difference from a SLEAP Connect worker is that `labels_path`, `data_path` and `model_paths` name EMBER URLs and model card ids rather than paths on the worker's disk.

```json
{
  "spec": {
    "type": "train",
    "config_contents": ["<training_config.yaml text>"],
    "model_types": ["single_instance"],
    "labels_path": "https://ember-open-data.s3.amazonaws.com/blobs/76a/db8/76adb8e6-…",
    "max_epochs": 100
  },
  "inputs": [
    {
      "url": "https://ember-open-data.s3.amazonaws.com/blobs/76a/db8/76adb8e6-…",
      "fileType": "pkg.slp",
      "name": "train.pkg.slp",
      "archive": {
        "dandisetId": "000398",
        "assetId": "…",
        "path": "sub-NONE/train.pkg.slp",
        "downloadUrl": "https://api-dandi.emberarchive.org/api/assets/…/download/"
      }
    }
  ],
  "models": [],
  "project": { "dandisetId": "000398", "path": "sub-NONE/train.pkg.slp" }
}
```

An inference job:

```json
{
  "spec": {
    "type": "track",
    "data_path": "https://ember-open-data.s3.amazonaws.com/blobs/2f2/eb3/2f2eb3a9-…",
    "model_paths": ["hf:talmolab/mice-topdown"]
  },
  "inputs": [
    {
      "url": "https://ember-open-data.s3.amazonaws.com/blobs/2f2/eb3/2f2eb3a9-…",
      "fileType": "avi",
      "name": "annotated_frames.avi",
      "archive": {
        "dandisetId": "000398",
        "assetId": "…",
        "path": "…/annotated_frames.avi",
        "downloadUrl": "https://api-dandi.emberarchive.org/api/assets/…/download/"
      }
    }
  ],
  "models": [
    {
      "id": "hf:talmolab/mice-topdown",
      "framework": "sleap-nn",
      "files": [
        {
          "role": "config",
          "folder": "centroid",
          "url": "https://huggingface.co/talmolab/mice-topdown/resolve/3f2a…/centroid/training_config.yaml"
        },
        {
          "role": "checkpoint",
          "folder": "centroid",
          "url": "https://huggingface.co/talmolab/mice-topdown/resolve/3f2a…/centroid/best.ckpt",
          "sha256": "…"
        },
        {
          "role": "config",
          "folder": "centered_instance",
          "url": "https://huggingface.co/talmolab/mice-topdown/resolve/3f2a…/centered_instance/training_config.yaml"
        },
        {
          "role": "checkpoint",
          "folder": "centered_instance",
          "url": "https://huggingface.co/talmolab/mice-topdown/resolve/3f2a…/centered_instance/best.ckpt",
          "sha256": "…"
        }
      ]
    }
  ],
  "project": { "dandisetId": "000398", "path": "sub-NONE/sub-NONE_sourcedata.slp" }
}
```

| Field     | Meaning                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec`    | SLEAP's job spec. `type` is `"train"` or `"track"`.                                                                                                                                                 |
| `inputs`  | Every URL the spec names, each with its `fileType` (`slp`, `pkg.slp`, `mp4`, `avi` or `h5`), a display `name` and its EMBER `archive` asset.                                                        |
| `models`  | For a track job, each id in `model_paths` expanded to what the worker runs: its `framework` and its files (see [Inputs, models and results](#inputs-models-and-results)), with `sha256` when known. |
| `project` | The dandiset results are written back to, and the EMBER path of the project the job came from.                                                                                                      |

- **File types are declared, never guessed.** EMBER download links and S3 blob URLs have no file extension, and sleap-nn picks `.slp` versus video handling from the extension of `--data_path`.
  The proxy (or the container) must use `fileType`, for example by downloading to a local file named with the right extension before calling sleap-nn.
- **Inputs carry archive references.** Presigned S3 links expire after 6 hours, which a queued job can outlive.
  So each input the page resolved from an EMBER asset carries `archive`: the asset's `dandisetId`, `assetId` and `path`, and `downloadUrl`, its stable API endpoint (`https://api-dandi.emberarchive.org/api/assets/{asset_id}/download/`).
  The proxy should download through `downloadUrl` with the service account, which renews the link, rather than trust a `url` that may have expired.
- **Training from files on EMBER only.** A train spec sent by this page always has `labels_path` naming a `.pkg.slp` (or `.slp`) on EMBER, and never carries `labels_content`.
  When sleap-app trains on the labels in its window (`labels_content`, the base64 of an `.slp` file), the page first saves them to the draft as a training package beside the project, `derivatives/sleap/sub-<label>/[ses-<label>/]beh/…_desc-trainingset<Source><yyyymmddhhmmss>_pose.pkg.slp` (UTC, one per run; a time another run already took moves on a second), and sends that file as `labels_path`.
  The rest of the spec is checked before that save, so a refused job leaves no package behind.
  A train spec naming neither is refused before it reaches a compute client, and so are inline labels too large for the browser to send (about 384 MiB in Chromium), with advice to save the project and train on that.
- **Jobs name what was saved.** Once a project has been saved, a spec naming the link it was opened under (as `labels_path`, `val_labels_path` or `data_path`) is sent naming the file its latest save wrote in `derivatives/sleap/` instead, since the opened link's bytes predate the save.
  A train result's `labels_path` therefore echoes that saved file.
  A job submitted while such a save is still uploading waits for it, so which file it names follows the order of the presses, not how long the upload took.

## Event stream

Each event has the same shape sleap-app's job viewer already consumes from SLEAP Connect workers (`WorkerEvent` in talmolab/sleap-app), so the page hands them to it unchanged:

```json
{ "topic": "job.status", "seq": 2, "jobId": "…", "data": { "state": "running" } }
```

- `seq` starts at 1 for each job and increases by one per event; the viewer ignores an event at or below the last `seq` it saw.

| `topic`      | `data`                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `job.status` | `{ "state": "queued" \| "running" \| "completed" \| "failed" \| "canceled", "detail"?: "<why, for failed or canceled>" }`     |
| `job.log`    | `{ "line": "<one line of container output>", "progress": false }` (`true` for a progress line that replaces the previous one) |
| `job.epoch`  | `{ "epoch": 0, "train_loss": 0.012, "val_loss": 0.015 }` (0-based epoch)                                                      |
| `job.curve`  | `{ "points": [{ "x": <global batch>, "y": <loss> }, …] }`, the whole downsampled curve each time                              |
| `job.metric` | `{ "epoch", "total_epochs", "latest_train_loss", "latest_val_loss", "best_loss", "wandb_url"?, "eta_seconds"? }`              |
| `job.result` | Train: `{ "model_id", "model_dir", "model_path", "labels_path" }`. Track: `{ "predictions": ["<path>", …] }`. See below.      |

- A train result's `model_dir` is the trained model's card id, `ember:<dandisetId>/<model_id>` (the id the page's EMBER model source gives the folder), so sleap-app can name it in a follow-up track job's `model_paths`.
  `model_path` is the same folder relative to the dandiset (`derivatives/sleap/models/<model_id>/`), and `labels_path` echoes the spec's `labels_path`, which sleap-app uses as that track job's `data_path`.
  The page resolves `model_dir` even when an index entry for the same folder has taken its place in the model list.
- A track job naming a card the page has not listed makes the page list models once more before it refuses the job, so the proxy must have written the model folder (its `training_config.yaml` and `best.ckpt`, in each head's subfolder when the job trained several) to the draft before it reports the train result.
  The in-browser stub writes nothing, so it lists the models it trained itself, under the same ids.
- A track result's `predictions` are paths relative to the dandiset, in the layout under [Inputs, models and results](#inputs-models-and-results).
  Once the job's `completed` status arrives, the page lists each one under the app, to open and proofread, as a file in the dandiset the job was submitted from (`project.dandisetId` in the request).
  It reads only `predictions`, at most its first 100 entries, and only its strings of up to 1024 characters naming a `.slp` or `.pkg.slp` under `derivatives/sleap/` with no empty, `.` or `..` segment.
  Anything else (another dandiset, an absolute path, an object, a result that is not an object) is left out, with one console warning per job naming what was.
  Each path is looked up in the draft when it is opened, so a file must be on EMBER by the time the job completes; until it is, the page says the file is not on EMBER yet and offers to try again.
- `completed`, `failed` and `canceled` are terminal: exactly one of them is the last `job.status` of a job, and nothing follows it.
- `job.epoch`, `job.curve` and `job.metric` are optional; without them the viewer shows status and logs only.
  sleap-nn's training loop already reports per-epoch losses, so forwarding them is cheap.

## Inputs, models and results

- **sleap-nn models load from local disk, one folder per head.** sleap-nn's `resolve_model_dir` accepts only a local model folder (or the `best.ckpt` / `training_config.yaml` in it), and a model folder holds one head.
  A single-head model is one folder; a top-down model is two, its centroid and centered-instance folders, and inference needs both.
  Every file of `models[].files` names its folder (`folder`, a path below where the model is kept: `""` for one kept at the top, e.g. `"centroid"` and `"centered_instance"` for a top-down one), each folder has exactly one `config` and one `checkpoint`, and only a top-down model has two folders.
  The proxy or container downloads each folder into a local directory of its own, saving the config as `training_config.yaml` and the checkpoint as `best.ckpt` (an EMBER download URL carries no file name), checks `sha256` when given, and passes every folder of every model in `model_paths` to `sleap-nn track`, one `--model_paths` each.
- **DeepLabCut models run on their own.** A model whose `framework` is `"deeplabcut"` is one of DeepLabCut's pretrained SuperAnimal models, for inference only, and a job naming one names nothing else (the page refuses any other mix).
  It carries `deeplabcut`, DeepLabCut's model zoo names for it, and two files: the pose model (`role: "checkpoint"`) and its detector (`role: "detector"`):

  ```json
  {
    "id": "index:superanimal-topviewmouse-hrnet-w32",
    "framework": "deeplabcut",
    "deeplabcut": {
      "superanimal": "superanimal_topviewmouse",
      "model": "hrnet_w32",
      "detector": "fasterrcnn_resnet50_fpn_v2"
    },
    "files": [
      {
        "role": "checkpoint",
        "folder": "",
        "url": "https://huggingface.co/mwmathis/DeepLabCutModelZoo-SuperAnimal-TopViewMouse/resolve/d443257…/superanimal_topviewmouse_hrnet_w32.pt",
        "sha256": "5e7ed2b4…"
      },
      {
        "role": "detector",
        "folder": "",
        "url": "https://huggingface.co/mwmathis/DeepLabCutModelZoo-SuperAnimal-TopViewMouse/resolve/d443257…/superanimal_topviewmouse_fasterrcnn_resnet50_fpn_v2.pt",
        "sha256": "1175e31a…"
      }
    ]
  }
  ```

  The container downloads both checkpoints and checks their `sha256`, saves the video under its declared `fileType`, and runs DeepLabCut 3's (PyTorch) `deeplabcut.video_inference_superanimal([video], superanimal_name=…, model_name=…, detector_name=…, customized_pose_checkpoint=<checkpoint>, customized_detector_checkpoint=<detector>, dest_folder=…, create_labeled_video=False)`, with the three names from `deeplabcut`.
  It then converts DeepLabCut's predictions to `.slp` with sleap-io (`sio.load_dlc` reads DeepLabCut's CSV, so the `.h5` DeepLabCut writes is saved as CSV with pandas first) and writes it where any track job's predictions go, so the page lists and opens it the same way.
  The `sleap-nn` models' `framework` is stated too, so the proxy never has to infer it.

- **Model file URLs** are one of:
  - `https://huggingface.co/<repo>/resolve/<revision>/<file>`: public repos need no token; **gated repos need a Hugging Face token held on the proxy side**, never sent from the browser.
  - `https://api-dandi.emberarchive.org/api/assets/{asset_id}/download/`: an EMBER asset the service account downloads with its own EMBER credentials.
  - `ember://<dandiset>/<path>`: an EMBER asset named by dandiset and path rather than id, each path segment percent-encoded, for entries in the central model index; the proxy decodes the path and resolves it through the EMBER API.
- **Results go back to EMBER** in the source dandiset's draft, under `derivatives/sleap/`, written by the service account:
  - trained models under `derivatives/sleap/models/<model-id>/` (`training_config.yaml`, `best.ckpt`, and a `model_card.json`); a job training several heads, as top-down's `centroid` and `centered_instance`, writes each head's `training_config.yaml` and `best.ckpt` to a subfolder named after it, with one `model_card.json` listing every head in `models/<model-id>/` ([MODEL_INDEX.md](MODEL_INDEX.md#model-folders-on-ember-model_cardjson));
  - predictions as `derivatives/sleap/sub-<label>/[ses-<label>/]beh/sub-<label>[_ses-<label>][_task-…][_acq-…][_run-…][_recording-…]_desc-predictions<Source>_pose.slp`, named the way the page names labels files ([BIDS derivatives layout](DEVELOPMENT_PLAN.md#bids-derivatives-layout); `predictionsPath` in `src/lib/bidsDerivatives.ts`), so each project's predictions sit beside its own labels file and two projects of one session never share one.
    The subject, session, kept entities and `<Source>` come from `project.path` when it names the subject, else from the input's name; a job where neither gives its subject (and any session it names) as BIDS labels fails rather than inventing a folder.
  - Each result records the requesting EMBER user and the job id in its provenance (for example in the asset metadata's `wasGeneratedBy`).
  - The page never publishes a dandiset; results stay in the draft until the owner publishes.

There is a precedent: dandiset [000598](https://dandi.emberarchive.org/dandiset/000598) holds an EMBER → Pennsieve → EMBER DeepLabCut training run (2026-10-23) and inference run (2026-11-09).
The SLEAP equivalent needs a Pennsieve app: [`aplbrain/sleap-docker-container`](https://github.com/aplbrain/sleap-docker-container) wraps `sleap-nn train` and `sleap-nn track` but has no `app.yml` yet.

## Open questions

- [ ] **Auth:** can the proxy validate EMBER access tokens directly (EMBER's OAuth introspection, or a call to `/api/users/me/`)?
- [ ] **Base URL and versioning:** where will the proxy live, and is a `/v1` prefix acceptable?
- [ ] **Events:** polling is enough for the prototype; is server-sent events on the roadmap?
- [ ] **Queueing:** how long can a job wait, and should the page show a queue position?
- [ ] **Limits:** maximum input size, GPU type and runtime per job, and per-user quotas.
- [ ] **Results:** does the service account write the `derivatives/sleap/` files, or does the proxy hand result links back for the page to save as the user?
- [ ] **Embargoed data:** does the service account have read access to embargoed dandisets, and on whose authority?
- [ ] **The SLEAP app on Pennsieve:** who writes `app.yml` for `aplbrain/sleap-docker-container`, and which sleap-nn version does it pin?
- [ ] **DeepLabCut on Pennsieve:** can the DeepLabCut app behind dandiset 000598's runs serve SuperAnimal inference, and which DeepLabCut version does it pin (3.0 or later, for the PyTorch engine and `customized_*_checkpoint`)?
- [ ] **SuperAnimal's license:** its weights are for academic, non-commercial use only; does running them on Pennsieve for EMBER's users fit that?
