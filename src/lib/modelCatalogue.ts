import type { ModelCard, ModelHead, ModelQuery, ModelSkeleton } from "./sleapContract";

/** One place models are found: Hugging Face, EMBER files, or the central index. */
export interface ModelSource {
  /** Shown in warnings when the source fails. */
  name: string;
  list(query: ModelQuery, signal?: AbortSignal): Promise<ModelCard[]>;
}

export interface ListModelsOptions {
  /** Hears about a source that failed; its models are left out and the rest are still listed. */
  onWarning?: (sourceName: string, error: unknown) => void;
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

export function matchesText(card: ModelCard, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  return [card.id, card.name, card.species ?? ""].some((field) => field.toLowerCase().includes(needle));
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
 * list, the first source to name an id keeps it, and a skeleton query puts exact matches before
 * models of unknown skeleton and drops the rest.
 */
export async function listModels(
  sources: ModelSource[],
  query: ModelQuery,
  options: ListModelsOptions = {},
): Promise<ModelCard[]> {
  const { onWarning = (name, e) => console.warn(`Could not list models from ${name}:`, e), signal } = options;
  const settled = await Promise.allSettled(sources.map((source) => source.list(query, signal)));
  signal?.throwIfAborted();

  const seen = new Set<string>();
  const merged: ModelCard[] = [];
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

  const texted = query.text ? merged.filter((card) => matchesText(card, query.text!)) : merged;
  const nodes = query.skeletonNodes;
  if (!nodes || nodes.length === 0) return texted;
  const matches = texted.filter((card) => skeletonFit(card, nodes) === "match");
  const unknown = texted.filter((card) => skeletonFit(card, nodes) === "unknown");
  return [...matches, ...unknown];
}
