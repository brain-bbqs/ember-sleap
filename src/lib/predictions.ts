import { isDerivativePath } from "./bidsDerivatives";
import { fileTypeOfPath, isProjectType, isSafeRelativePath } from "./fileType";
import type { EmberLocation } from "./hostRef";

// A track job's `job.result` names the predictions files its worker wrote, as paths relative to
// the dandiset (docs/COMPUTE_API.md, "Event stream"). It comes from a remote service, so the page
// offers to open only what that layout allows: SLEAP projects under derivatives/sleap/, named by
// paths that cannot climb out of it, in the dandiset the job was submitted from. Anything else is
// left out, with a line saying why, and a result can name only so much, so a misbehaving service
// cannot fill the page with buttons or the console with warnings.

/** Entries read from one result; any after these are left out together. */
export const MAX_PREDICTIONS = 100;
/** The longest path opened, far beyond any the layout makes. */
export const MAX_PATH_LENGTH = 1024;
/** How much of a string a warning quotes. */
const QUOTED_LENGTH = 120;

export interface ReadPredictions {
  /** The files to offer, in the order the result named them, each once. */
  files: EmberLocation[];
  /** One line per entry left out, naming it and what was wrong with it. */
  ignored: string[];
}

/** Why the page will not open `path` as predictions, or null when it will. */
export function predictionsPathProblem(path: string): string | null {
  if (path.length > MAX_PATH_LENGTH) return `is longer than ${MAX_PATH_LENGTH} characters`;
  if (!isSafeRelativePath(path)) return "has an empty, '.' or '..' segment";
  if (!isDerivativePath(path)) return "is not under derivatives/sleap/";
  const type = fileTypeOfPath(path);
  if (!type || !isProjectType(type)) return "is not a .slp or .pkg.slp file";
  return null;
}

/** An entry as a warning names it: a string quoted (its start, when long), anything else by its kind. */
function shown(entry: unknown): string {
  if (typeof entry === "string") {
    return JSON.stringify(entry.length > QUOTED_LENGTH ? `${entry.slice(0, QUOTED_LENGTH)}…` : entry);
  }
  if (entry === null || typeof entry !== "object") return String(entry);
  return Array.isArray(entry) ? "a list" : "an object";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The predictions files a track job's result names, as files in `dandisetId`, the job's own
 * dandiset. The result is whatever the service sent, so one that is not an object is left out too.
 */
export function readPredictions(result: unknown, dandisetId: string): ReadPredictions {
  if (!isRecord(result)) return { files: [], ignored: [`the result is ${shown(result)}, not an object`] };
  const { predictions } = result;
  if (predictions === undefined) return { files: [], ignored: [] };
  if (!Array.isArray(predictions)) return { files: [], ignored: [`predictions is ${shown(predictions)}, not a list`] };
  const entries = predictions as unknown[];
  const files: EmberLocation[] = [];
  const ignored: string[] = [];
  const listed = new Set<string>();
  for (const entry of entries.slice(0, MAX_PREDICTIONS)) {
    if (typeof entry !== "string") {
      ignored.push(`${shown(entry)} is not a path`);
      continue;
    }
    const problem = predictionsPathProblem(entry);
    if (problem) ignored.push(`${shown(entry)} ${problem}`);
    else if (!listed.has(entry)) {
      listed.add(entry);
      files.push({ dandisetId, path: entry });
    }
  }
  const unread = entries.length - MAX_PREDICTIONS;
  if (unread > 0) ignored.push(`${unread} more after the first ${MAX_PREDICTIONS}`);
  return { files, ignored };
}
