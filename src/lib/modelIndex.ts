import { isSafeRelativePath } from "./fileType";
import { isModelHead, parseSkeleton, type ModelSource } from "./modelCatalogue";
import type { ModelCard, ModelFile, ModelSkeleton } from "./sleapContract";

// The central model index: a curated `models.json` in a designated EMBER dandiset, each entry
// pointing at a model folder on Hugging Face or EMBER. Format: docs/MODEL_INDEX.md.

export const MODEL_INDEX_SCHEMA = "ember-sleap.models/v1";

/**
 * Where the index is served from. Null until the index dandiset exists: no SLEAP model catalogue
 * exists yet (brain-bbqs/bbqs_model_zoo is an empty stub), so this page creates one, and the
 * index source stays off until then.
 */
export const MODEL_INDEX_URL: string | null = null;

const HF_HUB_URL = "https://huggingface.co";
const DANDISET_ID = /^\d{6}$/;
const HF_REPO = /^[\w.-]+\/[\w.-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface ParsedModelIndex {
  models: ModelCard[];
  /** One line per entry left out, naming the entry and what was wrong with it. */
  problems: string[];
}

type EntrySource =
  { kind: "huggingface"; repo: string; revision: string } | { kind: "ember"; dandiset: string; path: string };

interface EntryFile {
  role: ModelFile["role"];
  path: string;
  sha256?: string;
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

function parseSource(value: unknown): EntrySource | string {
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
    if (!folder || !isSafeRelativePath(folder)) return "source.ember.path must be a relative folder path";
    return { kind: "ember", dandiset: ember.dandiset, path: folder };
  }
  return 'source must name exactly one of "huggingface" or "ember"';
}

function parseFiles(value: unknown): EntryFile[] | string {
  if (!Array.isArray(value) || value.length === 0) return "files must be a non-empty array";
  const files: EntryFile[] = [];
  for (const file of value) {
    if (!isRecord(file)) return "every file must be an object";
    if (file.role !== "config" && file.role !== "checkpoint") return 'file role must be "config" or "checkpoint"';
    if (!nonEmpty(file.path) || !isSafeRelativePath(file.path)) return "file path must be a relative path";
    if (file.sha256 !== undefined && (typeof file.sha256 !== "string" || !SHA256.test(file.sha256))) {
      return "file sha256 must be 64 lowercase hex digits";
    }
    files.push({ role: file.role, path: file.path, ...(file.sha256 ? { sha256: file.sha256 } : {}) });
  }
  if (!files.some((file) => file.role === "config")) return "files must include a config";
  return files;
}

function fileUrl(source: EntrySource, path: string): string {
  if (source.kind === "huggingface") {
    return `${HF_HUB_URL}/${source.repo}/resolve/${encodeURIComponent(source.revision)}/${encodePath(path)}`;
  }
  // EMBER has no URL per asset path without an API lookup, so the card keeps a reference the
  // compute side resolves against the archive (see docs/MODEL_INDEX.md).
  return `ember://${source.dandiset}/${source.path}/${path}`;
}

function parseEntry(entry: Record<string, unknown>): ModelCard | string {
  const { id, name, version, license, species, heads, skeleton } = entry;
  if (!nonEmpty(name)) return "name must be a non-empty string";
  if (!nonEmpty(version)) return "version must be a non-empty string";
  if (!nonEmpty(license)) return "license must be a non-empty string";
  if (species !== undefined && !nonEmpty(species)) return "species must be a non-empty string when given";
  if (!Array.isArray(heads) || heads.length === 0 || !heads.every(isModelHead)) {
    return "heads must be a non-empty array of centroid, centered_instance, bottomup or single_instance";
  }
  let parsedSkeleton: ModelSkeleton | undefined;
  if (skeleton !== undefined) {
    parsedSkeleton = parseSkeleton(skeleton);
    if (!parsedSkeleton) return "skeleton must be { nodes, edges } with every edge joining two listed nodes";
  }
  const source = parseSource(entry.source);
  if (typeof source === "string") return source;
  const files = parseFiles(entry.files);
  if (typeof files === "string") return files;

  return {
    id: `index:${id as string}`,
    // The card has no version field, so the version rides in the name the picker shows.
    name: `${name} (${version})`,
    license,
    ...(species !== undefined ? { species } : {}),
    heads: [...heads],
    ...(parsedSkeleton ? { skeleton: parsedSkeleton } : {}),
    files: files.map((file) => ({
      role: file.role,
      url: fileUrl(source, file.path),
      ...(file.sha256 ? { sha256: file.sha256 } : {}),
    })),
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
  const models: ModelCard[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  json.models.forEach((entry: unknown, i) => {
    const label = isRecord(entry) && nonEmpty(entry.id) ? `"${entry.id}"` : `#${i}`;
    if (!isRecord(entry) || !nonEmpty(entry.id)) {
      problems.push(`Entry ${label}: id must be a non-empty string.`);
      return;
    }
    if (seen.has(entry.id)) {
      problems.push(`Entry ${label}: duplicate id.`);
      return;
    }
    const card = parseEntry(entry);
    if (typeof card === "string") {
      problems.push(`Entry ${label}: ${card}.`);
      return;
    }
    seen.add(entry.id);
    models.push(card);
  });
  return { models, problems };
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
  onProblems = (problems) => console.warn("Model index entries left out:", problems),
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
