import type { ModelCard, ModelFile, ModelHead, ModelQuery, ModelSkeleton } from "./sleapContract";

/** Where a model's files are kept. */
export type ModelLocation =
  { kind: "huggingface"; repo: string; revision: string } | { kind: "ember"; dandisetId: string; path: string };

/** Where the host found a card: a repository or folder listed directly, or an index entry naming one. */
export type ModelCardSource = ModelLocation | { kind: "index"; target: ModelLocation };

/**
 * A card as this page's model sources list it. `source` is the host's own: the merge in listModels
 * reads it, and the app only sees the words `sourceLabel` puts it in. Each file's folder is relative
 * to the location `source` names (the repository root, or the EMBER folder).
 */
export interface HostModelCard extends ModelCard {
  source?: ModelCardSource;
}

/** One place models are found: Hugging Face, EMBER files, or the central index. */
export interface ModelSource {
  /** Shown in warnings when the source fails. */
  name: string;
  list(query: ModelQuery, signal?: AbortSignal): Promise<HostModelCard[]>;
}

export interface ListModelsOptions {
  /** Hears about a source that failed; its models are left out and the rest are still listed. */
  onWarning?: (sourceName: string, error: unknown) => void;
  /**
   * Hears each direct listing an index entry replaced. A job may still name it by its own id, as a
   * train result's `model_dir` names the EMBER folder the job wrote.
   */
  onReplaced?: (card: HostModelCard) => void;
  signal?: AbortSignal;
}

export const MODEL_HEADS: readonly ModelHead[] = ["centroid", "centered_instance", "bottomup", "single_instance"];

export function isModelHead(value: unknown): value is ModelHead {
  return typeof value === "string" && (MODEL_HEADS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A skeleton as the sources declare it, or undefined unless every edge joins two listed nodes. */
export function parseSkeleton(value: unknown): ModelSkeleton | undefined {
  if (!isRecord(value)) return undefined;
  const { nodes, edges } = value;
  if (!Array.isArray(nodes) || !nodes.every((n): n is string => typeof n === "string")) return undefined;
  if (!Array.isArray(edges)) return undefined;
  const names = new Set(nodes);
  const parsed: [string, string][] = [];
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) return undefined;
    const [a, b] = edge as unknown[];
    if (typeof a !== "string" || typeof b !== "string" || !names.has(a) || !names.has(b)) return undefined;
    parsed.push([a, b]);
  }
  return { nodes: [...nodes], edges: parsed };
}

const FILE_ROLES = new Map<string, ModelFile["role"]>([
  ["training_config.yaml", "config"],
  ["best.ckpt", "checkpoint"],
]);

/** The role of a file in a sleap-nn model folder, by its name, or undefined for any other file. */
export function modelFileRole(fileName: string): ModelFile["role"] | undefined {
  return FILE_ROLES.get(fileName);
}

/** The model folder of a path relative to a card: its directory, or "" for a file at the top. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** A card's files by model folder, in the order each folder is first named. */
export function filesByFolder(files: readonly ModelFile[]): Map<string, ModelFile[]> {
  const folders = new Map<string, ModelFile[]>();
  for (const file of files) {
    const held = folders.get(file.folder);
    if (held) held.push(file);
    else folders.set(file.folder, [file]);
  }
  return folders;
}

function isCompleteFolder(files: readonly ModelFile[]): boolean {
  return files.length === 2 && files.some((f) => f.role === "config") && files.some((f) => f.role === "checkpoint");
}

/** Whether a folder's name says it holds `head`, as "centroid" or SLEAP's "<run>.centroid.n=<frames>" do. */
function namedFor(folder: string, head: ModelHead): boolean {
  return folder
    .slice(folder.lastIndexOf("/") + 1)
    .split(".")
    .includes(head);
}

/**
 * Whether a model's folders run together as top-down: its heads say so or, with no heads declared,
 * its two folders are named after top-down's heads.
 */
function isTopDown(heads: readonly ModelHead[], folders: readonly string[]): boolean {
  if (heads.length > 0) return heads.includes("centroid") && heads.includes("centered_instance");
  return (
    folders.length === 2 &&
    folders.some((f) => namedFor(f, "centroid")) &&
    folders.some((f) => namedFor(f, "centered_instance"))
  );
}

/**
 * The models a repository or folder listed directly holds: one per complete model folder, except a
 * top-down model's folders, which go together. A folder missing its config or checkpoint is left out.
 */
export function modelsInFolders(heads: readonly ModelHead[], files: readonly ModelFile[]): ModelFile[][] {
  const folders = [...filesByFolder(files).values()].filter(isCompleteFolder);
  if (folders.length === 0) return [];
  const names = folders.map(([file]) => file.folder);
  return isTopDown(heads, names) ? [folders.flat()] : folders;
}

function describeFolder(folder: string): string {
  return folder ? `model folder "${folder}"` : "the top-level model folder";
}

/**
 * Why a card's files cannot run as its heads say, or null when they can. Every model folder needs
 * exactly one config and one checkpoint, a top-down model (centroid and centered_instance) runs from
 * two folders, one per head, and any other model from one.
 */
export function modelFilesProblem(heads: readonly ModelHead[], files: readonly ModelFile[]): string | null {
  const folders = filesByFolder(files);
  if (folders.size === 0) return "a model needs at least one model folder";
  const incomplete = [...folders].filter(([, held]) => !isCompleteFolder(held)).map(([name]) => describeFolder(name));
  if (incomplete.length > 0) {
    const each = incomplete.length > 1 ? "each " : "";
    return `${incomplete.join(" and ")} must ${each}hold exactly one config and one checkpoint`;
  }
  if (isTopDown(heads, [...folders.keys()])) {
    if (folders.size === 2) return null;
    return `a top-down model (centroid and centered_instance) needs two model folders, one per head, not ${folders.size}`;
  }
  return folders.size === 1 ? null : `a model that is not top-down needs one model folder, not ${folders.size}`;
}

/** The location a card's files are kept at, the one an index entry names for an index card. */
function locationOf(source: ModelCardSource): ModelLocation {
  return source.kind === "index" ? source.target : source;
}

/**
 * One key per model folder a card's files are kept in, however the location and folder split its
 * path and whatever revision or trailing slash they name. The Hub ignores case in repository ids.
 */
function folderKeys(source: ModelCardSource, files: readonly ModelFile[]): string[] {
  const location = locationOf(source);
  const base =
    location.kind === "huggingface"
      ? `huggingface:${location.repo.toLowerCase()}`
      : `ember:${location.dandisetId}/${location.path.replace(/\/+$/, "")}`;
  return [...filesByFolder(files).keys()].map((folder) => (folder ? `${base}/${folder}` : base));
}

/** Whether index entries name every model folder of a card listed directly, so it is not listed again. */
function isIndexed(card: HostModelCard, indexed: ReadonlySet<string>): boolean {
  if (!card.source || card.source.kind === "index") return false;
  const keys = folderKeys(card.source, card.files);
  return keys.length > 0 && keys.every((key) => indexed.has(key));
}

function describeLocation(location: ModelLocation): string {
  return location.kind === "huggingface" ? `Hugging Face ${location.repo}` : `EMBER dandiset ${location.dandisetId}`;
}

/** Where a listed model comes from, as its `sourceLabel` puts it for the picker. */
export function describeSource(source: ModelCardSource): string {
  return source.kind === "index"
    ? `from the model index (${describeLocation(source.target)})`
    : `from ${describeLocation(source)}`;
}

export function matchesText(card: HostModelCard, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  // The repository too, so an index entry is still found by the Hugging Face id it replaced.
  const location = card.source && locationOf(card.source);
  const repo = location?.kind === "huggingface" ? location.repo : "";
  return [card.id, card.name, card.species ?? "", repo].some((field) => field.toLowerCase().includes(needle));
}

export type SkeletonFit = "match" | "unknown" | "mismatch";

/** Whether a model's skeleton has exactly the queried nodes, in any order. */
export function skeletonFit(card: ModelCard, nodes: readonly string[]): SkeletonFit {
  if (!card.skeleton) return "unknown";
  const have = new Set(card.skeleton.nodes);
  const want = new Set(nodes);
  if (have.size !== want.size) return "mismatch";
  for (const node of want) if (!have.has(node)) return "mismatch";
  return "match";
}

/**
 * Every source's models, merged: a failed source is reported and skipped rather than failing the
 * list, the first source to name an id keeps it, index entries replace a direct listing whose every
 * model folder they name, and a skeleton query puts exact matches before models of unknown skeleton
 * and drops the rest. Each card that says where it was found gets a `sourceLabel` for the picker.
 */
export async function listModels(
  sources: ModelSource[],
  query: ModelQuery,
  options: ListModelsOptions = {},
): Promise<HostModelCard[]> {
  const {
    onWarning = (name, e) => console.warn(`Could not list models from ${name}:`, e),
    onReplaced,
    signal,
  } = options;
  const settled = await Promise.allSettled(sources.map((source) => source.list(query, signal)));
  signal?.throwIfAborted();

  const seen = new Set<string>();
  const merged: HostModelCard[] = [];
  settled.forEach((result, i) => {
    if (result.status === "rejected") {
      onWarning(sources[i].name, result.reason);
      return;
    }
    for (const card of result.value) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      merged.push(card);
    }
  });

  // Whatever revision either names: the index pins one and carries curated metadata, so it wins.
  const indexed = new Set(
    merged.flatMap((card) => (card.source?.kind === "index" ? folderKeys(card.source, card.files) : [])),
  );
  const collapsed: HostModelCard[] = [];
  for (const card of merged) {
    if (isIndexed(card, indexed)) onReplaced?.(card);
    else collapsed.push(card.source ? { ...card, sourceLabel: describeSource(card.source) } : card);
  }

  const texted = query.text ? collapsed.filter((card) => matchesText(card, query.text!)) : collapsed;
  const nodes = query.skeletonNodes;
  if (!nodes || nodes.length === 0) return texted;
  const matches = texted.filter((card) => skeletonFit(card, nodes) === "match");
  const unknown = texted.filter((card) => skeletonFit(card, nodes) === "unknown");
  return [...matches, ...unknown];
}
