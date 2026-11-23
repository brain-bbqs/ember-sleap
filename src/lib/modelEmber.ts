import { apiFetch, nextPagePath, type ArchiveConfig, type Asset } from "@brain-bbqs/ember-client";
import {
  isModelHead,
  modelFileRole,
  modelFilesProblem,
  modelsInFolders,
  parseSkeleton,
  type HostModelCard,
  type ModelLocation,
  type ModelSource,
} from "./modelCatalogue";
import type { ModelCard, ModelFile } from "./sleapContract";

// Trained models kept beside the data, in the open dandiset's BIDS derivatives: one model folder
// derivatives/sleap/models/<model-id>/{training_config.yaml, best.ckpt}, or one per head in its
// subfolders, models/<model-id>/<folder>/{...}, as a top-down model's centroid and
// centered_instance; model_card.json stays in models/<model-id>/. Folders that are not one
// top-down model's are listed as a model each.

export const MODELS_PREFIX = "derivatives/sleap/models/";
const MAX_PAGES = 20;
const CARD_FILE = "model_card.json";

/** The card id of the model in `derivatives/sleap/models/<modelId>/` in a dandiset. */
export function emberModelId(dandisetId: string, modelId: string): string {
  return `ember:${dandisetId}/${modelId}`;
}

/** Where the model in `derivatives/sleap/models/<modelId>/` in a dandiset is kept, as its card's source. */
export function emberModelLocation(dandisetId: string, modelId: string): ModelLocation {
  return { kind: "ember", dandisetId, path: `${MODELS_PREFIX}${modelId}` };
}

export interface EmberModelSourceOptions {
  /** The open dandiset's config with a token fresh for this listing; null, or no dandisetId, when nothing is open. */
  getConfig: () => Promise<ArchiveConfig | null>;
  fetch?: typeof fetch;
  /** Hears about models a listing left out, and why. Defaults to `console.warn`. */
  onProblems?: (problems: string[]) => void;
}

interface StoredModel {
  id: string;
  /** Asset ids by file name, per model folder: "" for the files directly in models/<id>/, else a subfolder's name. */
  folders: Map<string, Map<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function downloadUrl(cfg: ArchiveConfig, assetId: string): string {
  return `${cfg.api}/assets/${assetId}/download/`;
}

async function listModelAssets(cfg: ArchiveConfig, signal?: AbortSignal): Promise<Asset[]> {
  const assets: Asset[] = [];
  let path: string | null =
    `/dandisets/${cfg.dandisetId}/versions/draft/assets/` +
    `?path=${encodeURIComponent(MODELS_PREFIX)}&metadata=false&page_size=1000`;
  for (let page = 0; path && page < MAX_PAGES; page++) {
    signal?.throwIfAborted();
    const listing: { results?: Asset[]; next?: string | null } | null = await apiFetch(cfg, path);
    assets.push(...(listing?.results ?? []));
    path = nextPagePath(cfg, listing?.next);
  }
  return assets;
}

/** Groups assets by model, keeping the files directly in each model's folder and one level of subfolders. */
function groupModels(assets: Asset[]): StoredModel[] {
  const models = new Map<string, StoredModel>();
  for (const asset of assets) {
    if (!asset.path.startsWith(MODELS_PREFIX)) continue;
    const [id, ...rest] = asset.path.slice(MODELS_PREFIX.length).split("/");
    if (!id || rest.length === 0 || rest.length > 2 || rest.includes("")) continue;
    const folder = rest.length === 2 ? rest[0] : "";
    const model = models.get(id) ?? { id, folders: new Map<string, Map<string, string>>() };
    const files = model.folders.get(folder) ?? new Map<string, string>();
    files.set(rest[rest.length - 1], asset.asset_id);
    model.folders.set(folder, files);
    models.set(id, model);
  }
  return [...models.values()];
}

/** The model's config and checkpoint files, each in the folder it sits in. */
function storedFiles(cfg: ArchiveConfig, model: StoredModel): ModelFile[] {
  const files: ModelFile[] = [];
  for (const [folder, names] of model.folders) {
    for (const [name, assetId] of names) {
      const role = modelFileRole(name);
      if (role) files.push({ role, folder, url: downloadUrl(cfg, assetId) });
    }
  }
  return files;
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

/** What a model_card.json says for the picker; a missing or mistyped field is left out, and the folder name stands in for the name. */
function describe(card: Record<string, unknown>, folderName: string): Omit<ModelCard, "id" | "files"> {
  const license = text(card.license);
  const species = text(card.species);
  const skeleton = parseSkeleton(card.skeleton);
  return {
    name: text(card.name) ?? folderName,
    ...(license ? { license } : {}),
    ...(species ? { species } : {}),
    heads: Array.isArray(card.heads) ? card.heads.filter(isModelHead) : [],
    ...(skeleton ? { skeleton } : {}),
  };
}

export function createEmberModelSource({
  getConfig,
  fetch: fetchImpl = (input, init) => fetch(input, init),
  onProblems = (problems) => console.warn("EMBER models left out:", problems),
}: EmberModelSourceOptions): ModelSource {
  /** The model's model_card.json, or null when it is missing or unreadable (the folder name stands in). */
  async function readCard(cfg: ArchiveConfig, assetId: string | undefined, signal?: AbortSignal) {
    if (!assetId) return null;
    const headers: Record<string, string> = cfg.accessToken ? { Authorization: `Bearer ${cfg.accessToken}` } : {};
    try {
      const response = await fetchImpl(downloadUrl(cfg, assetId), { headers, signal });
      if (!response.ok) return null;
      const card: unknown = await response.json();
      return isRecord(card) ? card : null;
    } catch {
      return null;
    }
  }

  /**
   * The cards of the models in a model folder: one per complete folder, except a top-down model's
   * two, which make one card, each split one named after its subfolder. A line in place of a card
   * says why the model there is left out.
   */
  async function toCards(cfg: ArchiveConfig, model: StoredModel, signal?: AbortSignal) {
    const stored = storedFiles(cfg, model);
    // Whatever the heads, a folder without a complete model folder holds no model, so its card goes unread.
    if (modelsInFolders([], stored).length === 0) return [];
    const card = describe((await readCard(cfg, model.folders.get("")?.get(CARD_FILE), signal)) ?? {}, model.id);
    const models = modelsInFolders(card.heads, stored);
    const source = emberModelLocation(cfg.dandisetId, model.id);
    return models.map((files): HostModelCard | string => {
      const folder = models.length > 1 ? files[0].folder : "";
      const id = emberModelId(cfg.dandisetId, folder ? `${model.id}/${folder}` : model.id);
      const problem = modelFilesProblem(card.heads, files);
      if (problem) return `Model "${id}": ${problem}.`;
      return { id, ...card, ...(folder ? { name: `${card.name} (${folder})` } : {}), files, source };
    });
  }

  return {
    name: "EMBER",
    async list(_query, signal) {
      const cfg = await getConfig();
      if (!cfg?.dandisetId) return [];
      const models = groupModels(await listModelAssets(cfg, signal));
      const cards = (await Promise.all(models.map((model) => toCards(cfg, model, signal)))).flat();
      const problems = cards.filter((card): card is string => typeof card === "string");
      if (problems.length > 0) onProblems(problems);
      return cards.filter((card): card is HostModelCard => typeof card !== "string");
    },
  };
}
