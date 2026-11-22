import { isModelHead, parseSkeleton, type ModelSource } from "./modelCatalogue";
import type { ModelCard, ModelFile } from "./sleapContract";

// Hugging Face Hub models tagged for sleap-nn. The browser reads only the Hub's listing; weights
// go straight from the Hub to the compute container. Conventions: docs/MODEL_INDEX.md.

export interface HuggingFaceSourceOptions {
  fetch?: typeof fetch;
  hubUrl?: string;
  tag?: string;
  limit?: number;
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

export function createHuggingFaceSource({
  fetch: fetchImpl = (input, init) => fetch(input, init),
  hubUrl = "https://huggingface.co",
  tag = "sleap-nn",
  limit = 50,
}: HuggingFaceSourceOptions = {}): ModelSource {
  const hub = hubUrl.replace(/\/+$/, "");
  return {
    name: "Hugging Face",
    async list(query, signal) {
      const params = new URLSearchParams({ filter: tag, full: "true", cardData: "true", limit: String(limit) });
      const text = query.text?.trim();
      if (text) params.set("search", text);
      const response = await fetchImpl(`${hub}/api/models?${params.toString()}`, { signal });
      if (!response.ok) throw new Error(`Hugging Face returned HTTP ${response.status}.`);
      const listing: unknown = await response.json();
      if (!Array.isArray(listing)) throw new Error("Hugging Face returned something other than a model list.");
      return listing.map((model) => mapHubModel(model, hub)).filter((card): card is ModelCard => card !== null);
    },
  };
}
