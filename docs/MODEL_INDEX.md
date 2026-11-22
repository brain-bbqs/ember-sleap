# Model catalogue formats

The page's model picker merges three sources, in this order: the central index, Hugging Face, and the model folders in the open dandiset.
When two sources name the same card id, the first one wins.
The browser reads only small metadata files from each source; weights go straight from Hugging Face or S3 to the compute container.

The code is `src/lib/modelIndex.ts`, `src/lib/modelHuggingFace.ts`, `src/lib/modelEmber.ts` and the merge in `src/lib/modelCatalogue.ts`.

## Shared fields

| Field      | Type                                                                            | Notes                                                                         |
| ---------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `heads`    | array of `"centroid"`, `"centered_instance"`, `"bottomup"`, `"single_instance"` | The sleap-nn heads the model holds. A top-down model lists both of its heads. |
| `skeleton` | `{ "nodes": string[], "edges": [string, string][] }`                            | Every edge must join two listed nodes, or the skeleton is ignored.            |
| `license`  | string                                                                          | An SPDX identifier where one fits, e.g. `CC-BY-4.0`.                          |
| `species`  | string                                                                          | Free text, matched by the picker's search.                                    |

When the app asks for models matching a skeleton, exact matches (the same node names, in any order) come first, then models that declare no skeleton; models with a different skeleton are left out.

## The central index: `models.json`

A curated list in a designated EMBER dandiset.
That dandiset does not exist yet, so `MODEL_INDEX_URL` in `src/lib/modelIndex.ts` is `null` and the source is off until it does.

```json
{
  "schema": "ember-sleap.models/v1",
  "models": [
    {
      "id": "mouse-topdown",
      "name": "Mouse top-down",
      "version": "1.0.0",
      "license": "CC-BY-4.0",
      "species": "Mus musculus",
      "heads": ["centroid", "centered_instance"],
      "skeleton": { "nodes": ["nose", "tail"], "edges": [["nose", "tail"]] },
      "source": { "huggingface": { "repo": "owner/mouse-topdown", "revision": "v1.0.0" } },
      "files": [
        { "role": "config", "path": "centroid/training_config.yaml", "sha256": "<64 lowercase hex digits>" },
        { "role": "checkpoint", "path": "centroid/best.ckpt", "sha256": "<64 lowercase hex digits>" }
      ]
    }
  ]
}
```

- `id`, `name`, `version`, `license`, `heads`, `source` and `files` are required; `species` and `skeleton` are optional.
- `source` names exactly one of:
  - `{ "huggingface": { "repo": "owner/name", "revision": "<tag, branch or commit>" } }`; pin a tag or commit so the entry cannot change under its checksum.
  - `{ "ember": { "dandiset": "000123", "path": "derivatives/sleap/models/<model-id>" } }`.
- `files[].path` is relative to the source (the repository root, or the EMBER folder), with no empty, `.` or `..` segments.
  At least one file must be a `config`.
  `sha256` is optional but recommended; the compute side can check what it downloaded against it.
- The card's id is `index:<id>`, and the version is shown beside the name, as `Mouse top-down (1.0.0)`.
- Entries must have unique ids; a repeated id is left out.

A Hugging Face file becomes `https://huggingface.co/<repo>/resolve/<revision>/<path>`.
An EMBER file becomes the reference `ember://<dandiset>/<path>/<file path>`, since the archive has no URL per asset path without an API lookup.
The compute side resolves an `ember://` reference against the archive's draft assets (`?path=` on the assets listing) and downloads it with the service account.

A malformed entry never empties the catalogue: it is left out and named in a warning, and the rest of the index is used.
A document that is not a v1 index at all (wrong `schema`, no `models` array) fails the whole source, which the picker reports and skips.

## Model folders on EMBER: `model_card.json`

A trained model saved beside the data lives at `derivatives/sleap/models/<model-id>/` in its dandiset (see the BIDS layout in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md#bids-derivatives-layout)).

| File                   | Role                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| `training_config.yaml` | Required; a folder without one is not listed.                           |
| `best.ckpt`            | The checkpoint.                                                         |
| `model_card.json`      | Optional metadata for the picker; the folder name stands in without it. |

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
Only files directly inside the model folder count.
The card id is `ember:<dandiset>/<model-id>`, and file URLs are the archive's `/api/assets/<asset_id>/download/` links, which the compute side follows with its own credentials.
The page lists the open dandiset's models only.

## Hugging Face

A repository is listed when it carries the `sleap-nn` tag and holds at least one `training_config.yaml`, at its root or in a subfolder.

| Read from                           | Becomes                                                |
| ----------------------------------- | ------------------------------------------------------ |
| the repository id                   | the card's name, and its id as `hf:<owner>/<name>`     |
| `license` in the card metadata      | `license`, falling back to the Hub's `license:<x>` tag |
| `species` in the card metadata      | `species`                                              |
| `skeleton` in the card metadata     | `skeleton`                                             |
| tags named after a head             | `heads`, e.g. tag `centroid`                           |
| `training_config.yaml`, `best.ckpt` | `files`, pinned to the listing's commit                |

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
