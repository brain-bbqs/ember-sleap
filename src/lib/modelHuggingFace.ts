import {
  folderOf,
  isModelHead,
  modelFileRole,
  modelFilesProblem,
  modelsInFolders,
  parseSkeleton,
  type HostModelCard,
  type ModelSource,
} from "./modelCatalogue";
import type { ModelFile } from "./sleapContract";

// Hugging Face Hub models tagged for sleap-nn. The browser reads only the Hub's listing; weights
// go straight from the Hub to the compute container. Conventions: docs/MODEL_INDEX.md.

export interface HuggingFaceSourceOptions {
  fetch?: typeof fetch;
  hubUrl?: string;
  tag?: string;
  /** Models per page of the Hub's listing. */
  limit?: number;
  /** How many pages to follow through the Hub's `Link: rel="next"` headers. */
  maxPages?: number;
  /** Hears about models a listing left out, and why. Defaults to `console.warn`. */
  onProblems?: (problems: string[]) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** The listing's config and checkpoint files, each in the folder it sits in, at the model's pinned revision. */
function hubFiles(siblings: unknown, base: string): ModelFile[] {
  const files: ModelFile[] = [];
  for (const sibling of Array.isArray(siblings) ? siblings : []) {
    const rfilename = isRecord(sibling) ? sibling.rfilename : undefined;
    if (typeof rfilename !== "string") continue;
    const role = modelFileRole(rfilename.slice(rfilename.lastIndexOf("/") + 1));
    if (role) files.push({ role, folder: folderOf(rfilename), url: `${base}/${encodePath(rfilename)}` });
  }
  return files;
}

/**
 * One Hub listing entry as model cards: one per complete sleap-nn model folder (a config and a
 * checkpoint side by side; a folder missing either is left out), except a top-down model's two
 * folders, which make one card. A repository holding several models names each card after its
 * folder. A line in place of a card says why the model there cannot be listed.
 */
export function mapHubModel(model: unknown, hubUrl: string): (HostModelCard | string)[] {
  if (!isRecord(model)) return [];
  const modelId = nonEmptyString(model.id) ?? nonEmptyString(model.modelId);
  if (!modelId) return [];
  const revision = nonEmptyString(model.sha) ?? "main";
  const tags = Array.isArray(model.tags) ? model.tags.filter((t): t is string => typeof t === "string") : [];
  const heads = tags.filter(isModelHead);
  const models = modelsInFolders(heads, hubFiles(model.siblings, `${hubUrl}/${modelId}/resolve/${revision}`));

  const cardData = isRecord(model.cardData) ? model.cardData : {};
  const license =
    nonEmptyString(cardData.license) ?? tags.find((t) => t.startsWith("license:"))?.slice("license:".length);
  const species = nonEmptyString(cardData.species);
  const skeleton = parseSkeleton(cardData.skeleton);
  return models.map((files) => {
    // Split models each hold one folder; a lone model, or one at the top, keeps the repository's id.
    const folder = models.length > 1 ? files[0].folder : "";
    const name = folder ? `${modelId}/${folder}` : modelId;
    const problem = modelFilesProblem(heads, files);
    if (problem) return `Model "hf:${name}": ${problem}.`;
    return {
      id: `hf:${name}`,
      name,
      ...(license ? { license } : {}),
      ...(species ? { species } : {}),
      heads,
      ...(skeleton ? { skeleton } : {}),
      files,
      source: { kind: "huggingface", repo: modelId, revision },
    };
  });
}

const LINK_TARGET = /<([^>]*)>([^<]*)/g;
const REL_NEXT = /;\s*rel\s*=\s*"?next"?\s*(?:[;,]|$)/i;

/** The `rel="next"` target of a `Link` header, followed only while it stays on the Hub. */
export function nextPageUrl(link: string | null, hubUrl: string): string | null {
  for (const [, target, params] of (link ?? "").matchAll(LINK_TARGET)) {
    if (!REL_NEXT.test(params)) continue;
    try {
      const next = new URL(target, hubUrl);
      return next.origin === new URL(hubUrl).origin ? next.href : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function createHuggingFaceSource({
  fetch: fetchImpl = (input, init) => fetch(input, init),
  hubUrl = "https://huggingface.co",
  tag = "sleap-nn",
  limit = 50,
  maxPages = 4,
  onProblems = (problems) => console.warn("Hugging Face models left out:", problems),
}: HuggingFaceSourceOptions = {}): ModelSource {
  const hub = hubUrl.replace(/\/+$/, "");

  async function readPage(url: string, signal?: AbortSignal): Promise<{ listing: unknown[]; next: string | null }> {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`Hugging Face returned HTTP ${response.status}.`);
    const listing: unknown = await response.json();
    if (!Array.isArray(listing)) throw new Error("Hugging Face returned something other than a model list.");
    return { listing, next: nextPageUrl(response.headers.get("Link"), hub) };
  }

  return {
    name: "Hugging Face",
    // Listed by tag alone: the Hub's own `search` matches repo ids only, so a species search would
    // drop models whose card names it. listModels filters the text over id, name, species and
    // repository.
    async list(_query, signal) {
      const params = new URLSearchParams({ filter: tag, full: "true", cardData: "true", limit: String(limit) });
      let url: string | null = `${hub}/api/models?${params.toString()}`;
      const cards: HostModelCard[] = [];
      const problems: string[] = [];
      for (let page = 0; url && page < maxPages; page++) {
        let read: Awaited<ReturnType<typeof readPage>>;
        try {
          read = await readPage(url, signal);
        } catch (e) {
          // Only the first page failing fails the source; a later one keeps what came before it.
          if (page === 0) throw e;
          console.warn(`Hugging Face stopped listing after page ${page}:`, e);
          break;
        }
        for (const card of read.listing.flatMap((model) => mapHubModel(model, hub))) {
          if (typeof card === "string") problems.push(card);
          else cards.push(card);
        }
        url = read.next;
      }
      if (problems.length > 0) onProblems(problems);
      return cards;
    },
  };
}
