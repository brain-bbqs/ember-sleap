import { apiFetch, nextPagePath, type ArchiveConfig, type Asset } from "@brain-bbqs/ember-client";
import { isModelHead, parseSkeleton, type ModelSource } from "./modelCatalogue";
import type { ModelCard, ModelFile } from "./sleapContract";

// Trained models kept beside the data, in the open dandiset's BIDS derivatives:
// derivatives/sleap/models/<model-id>/{training_config.yaml, best.ckpt, model_card.json}.
// The card format is in docs/MODEL_INDEX.md.

export const MODELS_PREFIX = "derivatives/sleap/models/";
const MAX_PAGES = 20;
const FILE_ROLES = new Map<string, ModelFile["role"]>([
  ["training_config.yaml", "config"],
  ["best.ckpt", "checkpoint"],
]);

export interface EmberModelSourceOptions {
  /** The open dandiset's config with a token fresh for this listing; null, or no dandisetId, when nothing is open. */
  getConfig: () => Promise<ArchiveConfig | null>;
  fetch?: typeof fetch;
}

interface ModelFolder {
  id: string;
  files: Map<string, string>;
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

/** Groups assets by model folder, keeping only the files directly inside each folder. */
function groupFolders(assets: Asset[]): ModelFolder[] {
  const folders = new Map<string, ModelFolder>();
  for (const asset of assets) {
    if (!asset.path.startsWith(MODELS_PREFIX)) continue;
    const [id, file, ...deeper] = asset.path.slice(MODELS_PREFIX.length).split("/");
    if (!id || !file || deeper.length > 0) continue;
    const folder = folders.get(id) ?? { id, files: new Map<string, string>() };
    folder.files.set(file, asset.asset_id);
    folders.set(id, folder);
  }
  return [...folders.values()];
}

export function createEmberModelSource({
  getConfig,
  fetch: fetchImpl = (input, init) => fetch(input, init),
}: EmberModelSourceOptions): ModelSource {
  /** The folder's model_card.json, or null when it is missing or unreadable (the folder name stands in). */
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

  async function toCard(cfg: ArchiveConfig, folder: ModelFolder, signal?: AbortSignal): Promise<ModelCard | null> {
    const files: ModelFile[] = [];
    for (const [name, assetId] of folder.files) {
      const role = FILE_ROLES.get(name);
      if (role) files.push({ role, url: downloadUrl(cfg, assetId) });
    }
    if (!files.some((file) => file.role === "config")) return null;

    const card = (await readCard(cfg, folder.files.get("model_card.json"), signal)) ?? {};
    const name = typeof card.name === "string" && card.name ? card.name : folder.id;
    const license = typeof card.license === "string" && card.license ? card.license : undefined;
    const species = typeof card.species === "string" && card.species ? card.species : undefined;
    const skeleton = parseSkeleton(card.skeleton);
    return {
      id: `ember:${cfg.dandisetId}/${folder.id}`,
      name,
      ...(license ? { license } : {}),
      ...(species ? { species } : {}),
      heads: Array.isArray(card.heads) ? card.heads.filter(isModelHead) : [],
      ...(skeleton ? { skeleton } : {}),
      files,
    };
  }

  return {
    name: "EMBER",
    async list(_query, signal) {
      const cfg = await getConfig();
      if (!cfg?.dandisetId) return [];
      const folders = groupFolders(await listModelAssets(cfg, signal));
      const cards = await Promise.all(folders.map((folder) => toCard(cfg, folder, signal)));
      return cards.filter((card): card is ModelCard => card !== null);
    },
  };
}
