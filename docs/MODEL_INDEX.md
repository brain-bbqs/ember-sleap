# Model catalogue formats

The page's model picker merges three sources, in this order: the central index, Hugging Face, and the model folders in the open dandiset.
When two sources name the same card id, the first one wins.
Index entries also replace the direct listing of a model on Hugging Face or EMBER whose every model folder they name, whatever revision each names: an entry's metadata is curated and its revision pinned.
The browser reads only small metadata files from each source; weights go straight from Hugging Face or S3 to the compute container.
Most models are sleap-nn's; the index can also list DeepLabCut's pretrained SuperAnimal models, which compute runs with DeepLabCut instead ([Frameworks](#frameworks)).

The code is `src/lib/modelIndex.ts`, `src/lib/modelHuggingFace.ts`, `src/lib/modelEmber.ts` and the merge in `src/lib/modelCatalogue.ts`.

## Model folders

This section is about sleap-nn models; a DeepLabCut model is two checkpoints instead ([Frameworks](#frameworks)).
sleap-nn loads a model from a folder holding one head's `training_config.yaml` and `best.ckpt`.
A single-head model (`single_instance`, `bottomup`, or a lone `centroid` or `centered_instance`) is one folder.
A top-down model is two, its centroid folder and its centered-instance folder, and inference needs both.

So every file on a card names its model folder (`folder`, a path below the repository or EMBER folder the model is kept in: `""` for one kept at the top, e.g. `"centroid"` and `"centered_instance"` for a top-down one), and:

- every folder holds exactly one config and one checkpoint;
- a card whose `heads` include both `centroid` and `centered_instance` has exactly two folders;
- any other card has exactly one.

A card that declares no heads counts as top-down when it has two folders named after the two heads, either exactly (`centroid/`, `centered_instance/`) or as SLEAP names its runs (`250101_120000.centroid.n=80/`).

The index reports an entry that breaks a rule and leaves it out.
Hugging Face and EMBER leave out a folder missing its config or checkpoint, and list each remaining folder as a model of its own, except a top-down model's two, which make one card.
They skip a repository or folder with no complete model folder, and warn on the console about a top-down model without exactly one folder per head.
A track job sends each model's files with their folders, and the compute side downloads each folder into a directory of its own ([COMPUTE_API.md](COMPUTE_API.md#inputs-models-and-results)).

## Shared fields

| Field      | Type                                                                            | Notes                                                                         |
| ---------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `heads`    | array of `"centroid"`, `"centered_instance"`, `"bottomup"`, `"single_instance"` | The sleap-nn heads the model holds. A top-down model lists both of its heads. |
| `skeleton` | `{ "nodes": string[], "edges": [string, string][] }`                            | Every edge must join two listed nodes, or the skeleton is ignored.            |
| `license`  | string                                                                          | An SPDX identifier where one fits, e.g. `CC-BY-4.0`.                          |
| `species`  | string                                                                          | Free text, matched by the picker's search.                                    |

When the app asks for models matching a skeleton, exact matches (the same node names, in any order) come first, then models that declare no skeleton; models with a different skeleton are left out.

Each source also records where it found a card, in `source` (`HostModelCard` in `src/lib/modelCatalogue.ts`), which only the page reads:

| Found by     | `source`                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------- |
| Hugging Face | `{ "kind": "huggingface", "repo": "<owner>/<name>", "revision": "<the listing's commit>" }` |
| EMBER        | `{ "kind": "ember", "dandisetId": "<id>", "path": "derivatives/sleap/models/<model-id>" }`  |
| The index    | `{ "kind": "index", "target": <one of the two above, as the entry names it> }`              |

The app is told only `sourceLabel`, the same in words, such as `from the model index (Hugging Face talmolab/mice-topdown)`, which the picker shows beside the model.

A model folder is the same whoever lists it when it is in the same Hugging Face repository (any revision, and any case of the repository id) at the same path, or at the same path in the same EMBER dandiset, however the entry splits that path between `source` and `files`.
A direct listing is left out when index entries name every one of its model folders, so an entry for one folder of a repository leaves the repository's other models listed.
A track job may still name a direct listing an entry replaced by its own id, as a train result's `model_dir` does.
The picker's text search also matches the Hugging Face repository a card is kept in, so an index entry is still found by the repository id it replaced.

## The central index: `models.json`

A curated list in a designated EMBER dandiset.
That dandiset does not exist yet, so `MODEL_INDEX_URL` in `src/lib/modelIndex.ts` is `null`, and until it does the page reads its own copy instead ([`src/models.json`](#the-pages-own-copy-srcmodelsjson)).

[`examples/models.json`](examples/models.json) is a complete, valid index: a single-folder model on Hugging Face and a two-folder top-down model on EMBER.
Its repository, dandiset and checksums are illustrative.
A unit test parses it, and every index in this file, so neither can drift out of date.
The top-down entry:

```json
{
  "schema": "ember-sleap.models/v1",
  "models": [
    {
      "id": "mouse-topdown",
      "name": "Mouse top-down",
      "version": "2.1.0",
      "license": "CC-BY-4.0",
      "species": "Mus musculus",
      "heads": ["centroid", "centered_instance"],
      "skeleton": {
        "nodes": ["nose", "ear_left", "ear_right", "tail_base"],
        "edges": [
          ["nose", "ear_left"],
          ["nose", "ear_right"],
          ["nose", "tail_base"]
        ]
      },
      "source": { "ember": { "dandiset": "000123", "path": "derivatives/sleap/models/mouse-topdown" } },
      "files": [
        {
          "role": "config",
          "path": "centroid/training_config.yaml",
          "sha256": "ea493c8a919db569a9e64aab4050b43e1aec3add76138633ab776c702b0d943d"
        },
        {
          "role": "checkpoint",
          "path": "centroid/best.ckpt",
          "sha256": "425c193e1733a26c474d98ad2bcbc6fe7a68b426a2e35485d945a6eda58f8217"
        },
        {
          "role": "config",
          "path": "centered_instance/training_config.yaml",
          "sha256": "6341b01ae9354d021539c5ae12e14f9c311221a4b865c05974f11958eafeab94"
        },
        {
          "role": "checkpoint",
          "path": "centered_instance/best.ckpt",
          "sha256": "260ed212bc5df0f7891e9dcf377261afde751ca3ba6c7b3d1396ccbac4996400"
        }
      ]
    }
  ]
}
```

- `id`, `name`, `version`, `license`, `source` and `files` are required, and so are `heads` for a sleap-nn model; `species`, `skeleton` and `framework` are optional.
- `source` names exactly one of:
  - `{ "huggingface": { "repo": "owner/name", "revision": "<tag, branch or commit>" } }`; pin a tag or commit so the entry cannot change under its checksum.
  - `{ "ember": { "dandiset": "000123", "path": "derivatives/sleap/models/<model-id>" } }`.
- `files[].path` is relative to the source (the repository root, or the EMBER folder), with no empty, `.` or `..` segments, and no `%` or `\`; `source.ember.path` follows the same rules.
  Its directory is the file's model folder, so `centroid/best.ckpt` belongs to `centroid` and `best.ckpt` to the top level, and each folder needs exactly one `config` and one `checkpoint` (see [Model folders](#model-folders)).
  An entry lists each path once, and a file named `training_config.yaml` or `best.ckpt` has the role its name says.
  `sha256` is optional but recommended; the compute side can check what it downloaded against it.
- The card's id is `index:<id>`, and the version is shown beside the name, as `Mouse top-down (2.1.0)`.
- Entries must have unique ids; every entry after the first with an id is left out, even when the first is too.

- `framework` is `"sleap-nn"`, the default, or `"deeplabcut"` ([Frameworks](#frameworks)).

A Hugging Face file becomes `https://huggingface.co/<repo>/resolve/<revision>/<path>`.
An EMBER file becomes the reference `ember://<dandiset>/<path>/<file path>`, each path segment percent-encoded, since the archive has no URL per asset path without an API lookup.
The compute side resolves an `ember://` reference against the archive's draft assets (`?path=` on the assets listing) and downloads it with the service account.

A malformed entry never empties the catalogue: it is left out and named in a warning, and the rest of the index is used.
A document that is not a v1 index at all (wrong `schema`, no `models` array) fails the whole source, which the picker reports and skips.

### Frameworks

An entry's `framework` says what runs its model.
Only the index lists DeepLabCut models; Hugging Face and EMBER list sleap-nn model folders only.

| `framework`          | `heads`  | Names the model by                               | `files[].role`                                       |
| -------------------- | -------- | ------------------------------------------------ | ---------------------------------------------------- |
| `sleap-nn` (default) | required | its model folders                                | a `config` and a `checkpoint` per model folder       |
| `deeplabcut`         | left out | `deeplabcut`: `{ superanimal, model, detector }` | one `checkpoint` (the pose model) and one `detector` |

- `deeplabcut` holds DeepLabCut's model zoo names: the SuperAnimal (`superanimal_topviewmouse`), its pose network (`hrnet_w32`) and its detector (`fasterrcnn_resnet50_fpn_v2`), each in lowercase letters, digits and underscores.
  DeepLabCut builds the model's config from these names, so they must match the two checkpoints the entry pins.
- A DeepLabCut model is for inference only: nothing here trains it, and a track job runs it on its own ([COMPUTE_API.md](COMPUTE_API.md#inputs-models-and-results)).
- Its card reaches the app with `framework: "deeplabcut"` and no heads, and the picker shows "DeepLabCut" where a sleap-nn model shows its heads.
- Searching the picker for "deeplabcut" finds these models.

SuperAnimal-TopViewMouse, as the page's own copy lists it (less its 27 keypoints):

```json
{
  "schema": "ember-sleap.models/v1",
  "models": [
    {
      "id": "superanimal-topviewmouse-hrnet-w32",
      "name": "SuperAnimal-TopViewMouse, HRNet-w32",
      "version": "d443257",
      "license": "Modified MIT: academic, non-commercial use only",
      "species": "Mus musculus, filmed from above",
      "framework": "deeplabcut",
      "deeplabcut": {
        "superanimal": "superanimal_topviewmouse",
        "model": "hrnet_w32",
        "detector": "fasterrcnn_resnet50_fpn_v2"
      },
      "source": {
        "huggingface": {
          "repo": "mwmathis/DeepLabCutModelZoo-SuperAnimal-TopViewMouse",
          "revision": "d443257e4b1145f7439e0953c2015d60fcdc1185"
        }
      },
      "files": [
        {
          "role": "checkpoint",
          "path": "superanimal_topviewmouse_hrnet_w32.pt",
          "sha256": "5e7ed2b4e568fa93e2b1404251f9b060f9bd3ff5d68712f57c8ddb766d0cf6ed"
        },
        {
          "role": "detector",
          "path": "superanimal_topviewmouse_fasterrcnn_resnet50_fpn_v2.pt",
          "sha256": "1175e31a5486731734948da55e4b25adcee84da4e36eafc5768a771809d536e5"
        }
      ]
    }
  ]
}
```

### The page's own copy: `src/models.json`

Until the index dandiset exists, the page reads `src/models.json` from its bundle as it would read the published index, and lists its models in the `?test` mocks as well.
It holds DeepLabCut's SuperAnimal-TopViewMouse and SuperAnimal-Quadruped models, each the HRNet-w32 pose network with the Faster R-CNN ResNet-50 FPN v2 detector, a pairing DeepLabCut's model zoo serves (its other pose networks and detectors can be added the same way).
Each is pinned to its Hugging Face commit and every file to its SHA-256, and its keypoints are DeepLabCut's (27 for the mouse, 39 for quadrupeds; DeepLabCut defines no edges between them).
Their weights are licensed for academic, non-commercial use only (a modified MIT license, in each model card), and the picker shows that as their license.
SuperAnimal-Bird is left out because its model card states no license.
A unit test reads the file as `npm run check-model-index` does, so it cannot go out invalid.
Once the dandiset exists, this file is the first index published to it.

### Checking an index before publishing it

```bash
npm run check-model-index -- path/to/models.json [more.json ...]
```

This reads each file with the page's own parser and prints each model it would list, with its number of model folders.
It then prints the file's problems (text that is not JSON, a document that is not a v1 index, and each entry the page would leave out, with the first thing wrong with it) and exits with status 1 if any file has one, or 0 if none do.
A relative path is read from the directory the command was run in, and a leading byte order mark is ignored, as the page ignores it.
The command is a plain Node script, `scripts/check-model-index.mjs`, that loads `src/lib/modelIndex.ts` through Vite's module runner, so it works on Node 20, which cannot import TypeScript, and needs nothing beyond the installed dev dependencies.

## Model folders on EMBER: `model_card.json`

A trained model saved beside the data lives under `derivatives/sleap/models/<model-id>/` in its dandiset (see the BIDS layout in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md#bids-derivatives-layout)), in one of two layouts:

```text
derivatives/sleap/models/
  fly/                          one model folder
    training_config.yaml
    best.ckpt
    model_card.json
  mouse-topdown/                a model folder per head, in subfolders
    model_card.json
    centroid/
      training_config.yaml
      best.ckpt
    centered_instance/
      training_config.yaml
      best.ckpt
```

| File                   | Where                                        | Role                                                                    |
| ---------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| `training_config.yaml` | `models/<model-id>/`, or one subfolder of it | Required in every model folder.                                         |
| `best.ckpt`            | beside its `training_config.yaml`            | Required in every model folder.                                         |
| `model_card.json`      | `models/<model-id>/`, never in a subfolder   | Optional metadata for the picker; the folder name stands in without it. |

The model card of `mouse-topdown` above:

```json
{
  "name": "Mouse top-down, lab cohort 3",
  "license": "CC-BY-4.0",
  "species": "Mus musculus",
  "heads": ["centroid", "centered_instance"],
  "skeleton": { "nodes": ["nose", "tail"], "edges": [["nose", "tail"]] }
}
```

Every field is optional; an unreadable card, or a field of the wrong type, is ignored rather than hiding the model.
Files deeper than one level of subfolders, and any other files, are ignored.
A folder missing its config or checkpoint is left out, a model with no complete folder is not listed, and a card declaring both top-down heads needs exactly two folders (see [Model folders](#model-folders)).
The card id is `ember:<dandiset>/<model-id>`.
When `models/<model-id>/` holds several models that are not one top-down model, such as a model and an older run in a subfolder, each is listed: the one at the top as `ember:<dandiset>/<model-id>`, and each subfolder's as `ember:<dandiset>/<model-id>/<folder>`, named `<name> (<folder>)`, all described by the one `model_card.json`.
File URLs are the archive's `/api/assets/<asset_id>/download/` links, which the compute side follows with its own credentials; they carry no file name, which is why each file names its folder and role.
The page lists the open dandiset's models only.
While jobs run on the in-browser compute stub, which writes nothing to EMBER, the stub lists the models it trained under the same ids and in the same layout (a subfolder per head when a job trained several), so inference can be tried with them.

## Hugging Face

A repository is listed when it carries the `sleap-nn` tag and holds at least one complete model folder: a `training_config.yaml` with a `best.ckpt` beside it, at its root or in a subfolder.
Each such folder is named by its path in the repository (`""` for the root), and a folder missing either file is left out.
A top-down repository keeps a folder per head, for example `centroid/` and `centered_instance/`, and tags both heads; its card holds both folders.
A repository holding several other models is listed as a card per folder, `hf:<owner>/<name>/<folder>` (the one at the root keeps `hf:<owner>/<name>`), each with the repository's tags and card metadata.
The page reads up to four pages of 50 tagged repositories, following the Hub's `Link: rel="next"` header, and keeps the pages it has if a later one fails.
It never sends the picker's text to the Hub, whose search matches repository ids only; the text is matched in the page against each card's id, name, species and repository.

| Read from                           | Becomes                                                |
| ----------------------------------- | ------------------------------------------------------ |
| the repository id                   | the card's name, and its id as `hf:<owner>/<name>`     |
| `license` in the card metadata      | `license`, falling back to the Hub's `license:<x>` tag |
| `species` in the card metadata      | `species`                                              |
| `skeleton` in the card metadata     | `skeleton`                                             |
| tags named after a head             | `heads`, e.g. tag `centroid`                           |
| `training_config.yaml`, `best.ckpt` | `files`, by folder, pinned to the listing's commit     |
| the repository id and that commit   | `source`                                               |

The card metadata is the YAML front matter of the repository's `README.md`:

```yaml
---
license: cc-by-4.0
tags:
  - sleap-nn
  - centroid
  - centered_instance
species: Mus musculus
skeleton:
  nodes: [nose, tail]
  edges: [[nose, tail]]
---
```

Public repositories need no sign-in.
Gated repositories are out of scope for the browser; the compute side needs its own Hugging Face token to download them.
