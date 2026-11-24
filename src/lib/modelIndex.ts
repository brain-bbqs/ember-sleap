import { isSafeRelativePath } from "./fileType";
import {
  folderOf,
  isModelFramework,
  isModelHead,
  modelFileRole,
  modelFilesProblem,
  parseSkeleton,
  type DeepLabCutModel,
  type HostModelCard,
  type ModelLocation,
  type ModelSource,
} from "./modelCatalogue";
import type { ModelFile, ModelFramework, ModelHead, ModelSkeleton } from "./sleapContract";

// The central model index: a curated `models.json` in a designated EMBER dandiset, each entry
// pointing at a model on Hugging Face or EMBER. Format: docs/MODEL_INDEX.md; a valid example is
// docs/examples/models.json, and `npm run check-model-index` checks a file before it is published.
// Until that dandiset exists, the page reads its own copy, src/models.json, from its bundle.

export const MODEL_INDEX_SCHEMA = "ember-sleap.models/v1";

/**
 * Where the index is served from. Null until the index dandiset exists: no SLEAP model catalogue
 * exists yet (brain-bbqs/bbqs_model_zoo is an empty stub), so this page creates one, and reads the
 * copy in its own bundle until then (createBundledIndexSource).
 */
export const MODEL_INDEX_URL: string | null = null;

const HF_HUB_URL = "https://huggingface.co";
const DANDISET_ID = /^\d{6}$/;
const HF_REPO = /^[\w.-]+\/[\w.-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** A DeepLabCut model zoo name, as "superanimal_topviewmouse", "hrnet_w32" or "fasterrcnn_resnet50_fpn_v2". */
const DLC_NAME = /^[a-z0-9_]+$/;

/** The file roles each framework's models are made of. */
const FRAMEWORK_ROLES: Record<ModelFramework, readonly ModelFile["role"][]> = {
  "sleap-nn": ["config", "checkpoint"],
  deeplabcut: ["checkpoint", "detector"],
};

export interface ParsedModelIndex {
  models: HostModelCard[];
  /** One line per entry left out, naming the entry and what was wrong with it. */
  problems: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * A relative path that stays inside where it is read from: no empty, `.` or `..` segments, and no
 * `%` or backslash, which a URL parser or a worker's file system could turn into either.
 */
function isModelPath(path: string): boolean {
  return isSafeRelativePath(path) && !/[%\\]/.test(path);
}

function parseSource(value: unknown): ModelLocation | string {
  if (!isRecord(value)) return "source must be an object";
  const keys = Object.keys(value);
  if (keys.length !== 1) return 'source must name exactly one of "huggingface" or "ember"';
  const hf = value.huggingface;
  if (isRecord(hf)) {
    if (!nonEmpty(hf.repo) || !HF_REPO.test(hf.repo)) return 'source.huggingface.repo must look like "owner/name"';
    if (!nonEmpty(hf.revision)) return "source.huggingface.revision must be a non-empty string";
    return { kind: "huggingface", repo: hf.repo, revision: hf.revision };
  }
  const ember = value.ember;
  if (isRecord(ember)) {
    if (!nonEmpty(ember.dandiset) || !DANDISET_ID.test(ember.dandiset))
      return "source.ember.dandiset must be a six-digit id";
    const folder = nonEmpty(ember.path) ? ember.path.replace(/\/+$/, "") : "";
    if (!folder || !isModelPath(folder)) return "source.ember.path must be a relative folder path";
    return { kind: "ember", dandisetId: ember.dandiset, path: folder };
  }
  return 'source must name exactly one of "huggingface" or "ember"';
}

function fileUrl(source: ModelLocation, path: string): string {
  if (source.kind === "huggingface") {
    return `${HF_HUB_URL}/${source.repo}/resolve/${encodeURIComponent(source.revision)}/${encodePath(path)}`;
  }
  // EMBER has no URL per asset path without an API lookup, so the card keeps a reference the
  // compute side resolves against the archive (see docs/MODEL_INDEX.md).
  return `ember://${source.dandisetId}/${encodePath(source.path)}/${encodePath(path)}`;
}

/**
 * One of an entry's files at the source, in the model folder its path's directory names, or why
 * not. `paths` holds the paths of the entry's files read so far.
 */
function parseFile(
  file: unknown,
  source: ModelLocation,
  paths: Set<string>,
  framework: ModelFramework,
): ModelFile | string {
  if (!isRecord(file)) return "every file must be an object";
  const { role, path, sha256 } = file;
  const roles = FRAMEWORK_ROLES[framework];
  if (!roles.some((r) => r === role)) {
    return `file role must be ${roles.map((r) => `"${r}"`).join(" or ")} in a ${framework} entry`;
  }
  const fileRole = role as ModelFile["role"];
  if (!nonEmpty(path) || !isModelPath(path)) return "file path must be a relative path";
  if (paths.has(path)) return `file "${path}" is listed twice`;
  paths.add(path);
  // The compute side saves each file under its role's name, so a known name must match its role.
  const named = modelFileRole(path.slice(path.lastIndexOf("/") + 1));
  if (named && named !== fileRole) return `file "${path}" is named as a ${named}, not a ${fileRole}`;
  if (sha256 !== undefined && (typeof sha256 !== "string" || !SHA256.test(sha256))) {
    return "file sha256 must be 64 lowercase hex digits";
  }
  return { role: fileRole, folder: folderOf(path), url: fileUrl(source, path), ...(sha256 ? { sha256 } : {}) };
}

/** The entry's files at the source, or why they cannot run as the entry's heads and framework say. */
function parseFiles(
  value: unknown,
  source: ModelLocation,
  heads: readonly ModelHead[],
  framework: ModelFramework,
): ModelFile[] | string {
  if (!Array.isArray(value) || value.length === 0) return "files must be a non-empty array";
  const files: ModelFile[] = [];
  const paths = new Set<string>();
  for (const entry of value) {
    const file = parseFile(entry, source, paths, framework);
    if (typeof file === "string") return file;
    files.push(file);
  }
  return modelFilesProblem(heads, files, framework) ?? files;
}

/** A DeepLabCut entry's model zoo names, or why not. */
function parseDeepLabCut(value: unknown): DeepLabCutModel | string {
  const why =
    'deeplabcut must be { superanimal, model, detector }, each a DeepLabCut model zoo name such as "superanimal_topviewmouse"';
  if (!isRecord(value)) return why;
  const { superanimal, model, detector } = value;
  const names = [superanimal, model, detector];
  if (!names.every((n): n is string => typeof n === "string" && DLC_NAME.test(n))) return why;
  return { superanimal: superanimal as string, model: model as string, detector: detector as string };
}

/** The heads a sleap-nn entry declares, or a DeepLabCut entry's model names, or why not. */
function parseRuntime(
  entry: Record<string, unknown>,
  framework: ModelFramework,
): { heads: ModelHead[]; deeplabcut?: DeepLabCutModel } | string {
  const { heads, deeplabcut } = entry;
  if (framework === "deeplabcut") {
    if (heads !== undefined) return "heads are sleap-nn's, so a DeepLabCut entry leaves them out";
    const model = parseDeepLabCut(deeplabcut);
    return typeof model === "string" ? model : { heads: [], deeplabcut: model };
  }
  if (deeplabcut !== undefined) return 'deeplabcut is only for an entry whose framework is "deeplabcut"';
  if (!Array.isArray(heads) || heads.length === 0 || !heads.every(isModelHead)) {
    return "heads must be a non-empty array of centroid, centered_instance, bottomup or single_instance";
  }
  return { heads: [...heads] };
}

/** The fields that describe an entry to people. */
interface Description {
  name: string;
  version: string;
  license: string;
  species?: string;
}

function parseDescription({ name, version, license, species }: Record<string, unknown>): Description | string {
  if (!nonEmpty(name)) return "name must be a non-empty string";
  if (!nonEmpty(version)) return "version must be a non-empty string";
  if (!nonEmpty(license)) return "license must be a non-empty string";
  if (species === undefined) return { name, version, license };
  return nonEmpty(species) ? { name, version, license, species } : "species must be a non-empty string when given";
}

function parseEntry(entry: Record<string, unknown>): HostModelCard | string {
  const description = parseDescription(entry);
  if (typeof description === "string") return description;
  const { id, skeleton, framework = "sleap-nn" } = entry;
  if (!isModelFramework(framework)) return 'framework must be "sleap-nn" or "deeplabcut" when given';
  const runtime = parseRuntime(entry, framework);
  if (typeof runtime === "string") return runtime;
  let parsedSkeleton: ModelSkeleton | undefined;
  if (skeleton !== undefined) {
    parsedSkeleton = parseSkeleton(skeleton);
    if (!parsedSkeleton) return "skeleton must be { nodes, edges } with every edge joining two listed nodes";
  }
  const source = parseSource(entry.source);
  if (typeof source === "string") return source;
  const files = parseFiles(entry.files, source, runtime.heads, framework);
  if (typeof files === "string") return files;

  return {
    id: `index:${id as string}`,
    // The card has no version field, so the version rides in the name the picker shows.
    name: `${description.name} (${description.version})`,
    license: description.license,
    ...(description.species !== undefined ? { species: description.species } : {}),
    // sleap-nn, the default, is left unsaid, as every other source leaves it.
    ...(framework === "sleap-nn" ? {} : { framework }),
    heads: runtime.heads,
    ...(parsedSkeleton ? { skeleton: parsedSkeleton } : {}),
    files,
    source: { kind: "index", target: source },
    ...(runtime.deeplabcut ? { deeplabcut: runtime.deeplabcut } : {}),
  };
}

/**
 * The model cards in a `models.json`. Throws only when the document is not a v1 index at all; a bad
 * entry is left out and named in `problems`, so one typo does not empty the catalogue.
 */
export function parseModelIndex(json: unknown): ParsedModelIndex {
  if (!isRecord(json) || json.schema !== MODEL_INDEX_SCHEMA || !Array.isArray(json.models)) {
    throw new Error(`Not a model index: expected { "schema": "${MODEL_INDEX_SCHEMA}", "models": [...] }.`);
  }
  const models: HostModelCard[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  json.models.forEach((entry: unknown, i) => {
    const label = isRecord(entry) && nonEmpty(entry.id) ? `"${entry.id}"` : `#${i}`;
    if (!isRecord(entry) || !nonEmpty(entry.id)) {
      problems.push(`Entry ${label}: id must be a non-empty string.`);
      return;
    }
    // Claimed on first sight, so a later entry with the id is left out even when this one is.
    if (seen.has(entry.id)) {
      problems.push(`Entry ${label}: duplicate id.`);
      return;
    }
    seen.add(entry.id);
    const card = parseEntry(entry);
    if (typeof card === "string") problems.push(`Entry ${label}: ${card}.`);
    else models.push(card);
  });
  return { models, problems };
}

/**
 * An index file's text checked as the page would read it, for `npm run check-model-index`: text
 * that is not JSON, or JSON that is not a v1 index, is one problem, and every entry left out is one.
 * A leading byte order mark is dropped, as the page's `response.json()` drops it.
 */
export function checkModelIndex(text: string): ParsedModelIndex {
  try {
    return parseModelIndex(JSON.parse(text.replace(/^\uFEFF/, "")));
  } catch (e) {
    const why = e instanceof SyntaxError ? `Not JSON: ${e.message}` : (e as Error).message;
    return { models: [], problems: [why] };
  }
}

const warnLeftOut = (problems: string[]) => console.warn("Model index entries left out:", problems);

/**
 * An index this page carries in its bundle (src/models.json), read as a fetched one is: the models
 * curated so far, SuperAnimal's first, until the index dandiset exists and MODEL_INDEX_URL names it.
 */
export function createBundledIndexSource(json: unknown, onProblems = warnLeftOut): ModelSource {
  return {
    name: "Model index",
    // In a promise, so a document that is not an index fails the source as a failed fetch would.
    list: () =>
      new Promise<HostModelCard[]>((resolve) => {
        const { models, problems } = parseModelIndex(json);
        if (problems.length > 0) onProblems(problems);
        resolve(models);
      }),
  };
}

export interface IndexSourceOptions {
  url: string;
  fetch?: typeof fetch;
  /** Hears about entries the index holds but this page could not use. Defaults to `console.warn`. */
  onProblems?: (problems: string[]) => void;
}

export function createIndexSource({
  url,
  fetch: fetchImpl = (input, init) => fetch(input, init),
  onProblems = warnLeftOut,
}: IndexSourceOptions): ModelSource {
  return {
    name: "Model index",
    async list(_query, signal) {
      const response = await fetchImpl(url, { signal });
      if (!response.ok) throw new Error(`The model index returned HTTP ${response.status}.`);
      const { models, problems } = parseModelIndex(await response.json());
      if (problems.length > 0) onProblems(problems);
      return models;
    },
  };
}
