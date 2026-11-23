# Model catalogue formats

The page's model picker merges two sources, in this order: Hugging Face, and the model folders in the open dandiset.
When two sources name the same card id, the first one wins.
The browser reads only small metadata files from each source; weights go straight from Hugging Face or S3 to the compute container.

The code is `src/lib/modelHuggingFace.ts`, `src/lib/modelEmber.ts` and the merge in `src/lib/modelCatalogue.ts`.

## Model folders

sleap-nn loads a model from a folder holding one head's `training_config.yaml` and `best.ckpt`.
A single-head model (`single_instance`, `bottomup`, or a lone `centroid` or `centered_instance`) is one folder.
A top-down model is two, its centroid folder and its centered-instance folder, and inference needs both.

So every file on a card names its model folder (`folder`, a path below the repository or EMBER folder the model is kept in: `""` for one kept at the top, e.g. `"centroid"` and `"centered_instance"` for a top-down one), and:

- every folder holds exactly one config and one checkpoint;
- a card whose `heads` include both `centroid` and `centered_instance` has exactly two folders;
- any other card has exactly one.

A card that declares no heads counts as top-down when it has two folders named after the two heads, either exactly (`centroid/`, `centered_instance/`) or as SLEAP names its runs (`250101_120000.centroid.n=80/`).

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

The app is told only `sourceLabel`, the same in words, such as `from Hugging Face talmolab/mice-topdown`, which the picker shows beside the model.

The picker's text search also matches the Hugging Face repository a card is kept in.

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
