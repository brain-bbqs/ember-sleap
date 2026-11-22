import { isModelHead, parseSkeleton, type ModelSource } from "./modelCatalogue";
import type { ModelCard, ModelFile } from "./sleapContract";

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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function fileRole(rfilename: string): ModelFile["role"] | null {
  if (rfilename === "training_config.yaml" || rfilename.endsWith("/training_config.yaml")) return "config";
  if (rfilename === "best.ckpt" || rfilename.endsWith("/best.ckpt")) return "checkpoint";
  return null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** The listing's config and checkpoint files, at the model's pinned revision. */
function hubFiles(siblings: unknown, base: string): ModelFile[] {
  const files: ModelFile[] = [];
  for (const sibling of Array.isArray(siblings) ? siblings : []) {
    const rfilename = isRecord(sibling) ? sibling.rfilename : undefined;
    if (typeof rfilename !== "string") continue;
    const role = fileRole(rfilename);
    if (role) files.push({ role, url: `${base}/${encodePath(rfilename)}` });
  }
  return files;
}

/** One Hub listing entry as a model card, or null when it holds no sleap-nn config. */
export function mapHubModel(model: unknown, hubUrl: string): ModelCard | null {
  if (!isRecord(model)) return null;
  const modelId = nonEmptyString(model.id) ?? nonEmptyString(model.modelId);
  if (!modelId) return null;
  const revision = nonEmptyString(model.sha) ?? "main";
  const files = hubFiles(model.siblings, `${hubUrl}/${modelId}/resolve/${revision}`);
  if (!files.some((file) => file.role === "config")) return null;

  const tags = Array.isArray(model.tags) ? model.tags.filter((t): t is string => typeof t === "string") : [];
  const cardData = isRecord(model.cardData) ? model.cardData : {};
  const license =
    nonEmptyString(cardData.license) ?? tags.find((t) => t.startsWith("license:"))?.slice("license:".length);
  const species = nonEmptyString(cardData.species);
  const skeleton = parseSkeleton(cardData.skeleton);

  return {
    id: `hf:${modelId}`,
    name: modelId,
    ...(license ? { license } : {}),
    ...(species ? { species } : {}),
    heads: tags.filter(isModelHead),
    ...(skeleton ? { skeleton } : {}),
    files,
  };
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
    // drop models whose card names it. listModels filters the text over id, name and species.
    async list(_query, signal) {
      const params = new URLSearchParams({ filter: tag, full: "true", cardData: "true", limit: String(limit) });
      let url: string | null = `${hub}/api/models?${params.toString()}`;
      const cards: ModelCard[] = [];
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
        for (const model of read.listing) {
          const card = mapHubModel(model, hub);
          if (card) cards.push(card);
        }
        url = read.next;
      }
      return cards;
    },
  };
}
