// The `derivatives/sleap/` layout from docs/DEVELOPMENT_PLAN.md ("BIDS derivatives layout"), still
// to be confirmed with the EMBER data team. BIDS has no pose-estimation suffix yet, so `_pose` and
// the `.slp` files are kept out of validators' way by the derivative dataset's own `.bidsignore`.
//
// A save goes back over its source only when the source is already a labels file here
// (`..._desc-labels<label>_pose.slp`). Any other source, a `desc-predictions` file included, gets a
// labels file of its own, named so that no two sources share one: it keeps the source name's task,
// acq, run and recording entities, and the rest of the source name (minus a trailing `pose` or
// `labels`) becomes the desc label. So `sub-01/ses-01/beh/cam-top.slp` saves to
// `derivatives/sleap/sub-01/ses-01/beh/sub-01_ses-01_desc-labelsCamTop_pose.slp`.

import { baseName } from "./fileType";

export const DERIVATIVES_ROOT = "derivatives/sleap";
export const DATASET_DESCRIPTION_PATH = `${DERIVATIVES_ROOT}/dataset_description.json`;
export const BIDSIGNORE_PATH = `${DERIVATIVES_ROOT}/.bidsignore`;
export const BIDSIGNORE = "*.slp\n*.ckpt\nmodels/\n";
export const BIDS_VERSION = "1.10.0";

export interface BidsEntities {
  sub: string;
  ses?: string;
}

/** The entities a source's name passes on to its labels file, in BIDS order; all apply to `beh`. */
const KEPT_ENTITIES = ["task", "acq", "run", "recording"] as const;
type KeptEntity = (typeof KEPT_ENTITIES)[number];

/** What a pose file's name carries before its desc: the subject and session, then the kept entities. */
export type PoseEntities = BidsEntities & Partial<Record<KeptEntity, string>>;

export type PoseDesc = "labels" | "predictions";
/** A desc label: `labels` or `predictions`, optionally followed by what tells its source apart. */
export type PoseDescLabel = `${PoseDesc}${string}`;
export type PoseExtension = "slp" | "pkg.slp" | "nwb";

const LABEL = /^[a-zA-Z0-9]+$/;
const INDEX = /^[0-9]+$/;
const PACKAGE = /\.pkg\.slp$/i;
const PROJECT_EXTENSION = /(?:\.pkg)?\.slp$/i;
const LABELS_FILE = /_desc-labels[a-zA-Z0-9]*_pose\.(?:pkg\.)?slp$/i;
const GENERIC_LAST_WORD = /^(?:pose|labels)$/i;

/** BIDS labels are alphanumeric only: no hyphens, underscores or spaces. */
export function isBidsLabel(value: string): boolean {
  return LABEL.test(value);
}

function entityIn(segment: string, key: "sub" | "ses"): string | undefined {
  const match = new RegExp(`(?:^|_)${key}-([a-zA-Z0-9]+)(?=_|\\.|$)`).exec(segment);
  return match?.[1];
}

/**
 * The subject and session a source file belongs to, read from `sub-`/`ses-` folders or, failing
 * those, from the file name's own entities. Null when no subject can be read, or when the path
 * names a session whose label cannot be read: that is when the page has to ask, since guessing "no
 * session" would put every session of the subject in one file.
 */
export function entitiesFromPath(path: string): BidsEntities | null {
  const segments = path.split("/");
  const folders = segments.slice(0, -1);
  const fileName = segments[segments.length - 1];
  const fromFolders = (key: "sub" | "ses") =>
    folders.map((f) => (new RegExp(`^${key}-([a-zA-Z0-9]+)$`).exec(f) ?? [])[1]).find(Boolean);
  const sub = fromFolders("sub") ?? entityIn(fileName, "sub");
  const ses = fromFolders("ses") ?? entityIn(fileName, "ses");
  const namesSession = folders.some((f) => f.startsWith("ses-")) || /(?:^|_)ses-/.test(fileName);
  if (!sub || (namesSession && !ses)) return null;
  return ses ? { sub, ses } : { sub };
}

export function poseFileName(entities: PoseEntities, desc: PoseDescLabel, ext: PoseExtension): string {
  const named = (["sub", "ses", ...KEPT_ENTITIES] as const).flatMap((key) =>
    entities[key] ? [`${key}-${entities[key]}`] : [],
  );
  return `${[...named, `desc-${desc}`].join("_")}_pose.${ext}`;
}

export function posePath(entities: PoseEntities, desc: PoseDescLabel, ext: PoseExtension): string {
  const folder = entities.ses ? `sub-${entities.sub}/ses-${entities.ses}` : `sub-${entities.sub}`;
  return `${DERIVATIVES_ROOT}/${folder}/beh/${poseFileName(entities, desc, ext)}`;
}

export function isDerivativePath(path: string): boolean {
  return path.startsWith(`${DERIVATIVES_ROOT}/`);
}

/** A labels file already in `derivatives/sleap/`, which a save goes back over rather than beside. */
export function isLabelsPath(path: string): boolean {
  return isDerivativePath(path) && LABELS_FILE.test(path);
}

function isKeptEntity(key: string): key is KeptEntity {
  return (KEPT_ENTITIES as readonly string[]).includes(key);
}

/** A run is an index; the other kept entities take any BIDS label. */
function isKeptLabel(key: KeptEntity, label: string): boolean {
  return key === "run" ? INDEX.test(label) : isBidsLabel(label);
}

/**
 * Splits a source file name into the entities its labels file keeps and a CamelCase word made of
 * everything else. Its own sub, ses and desc are dropped: the labels file has its own.
 */
function sourceNameParts(fileName: string): { kept: Partial<Record<KeptEntity, string>>; word: string } {
  const kept: Partial<Record<KeptEntity, string>> = {};
  const rest: string[] = [];
  for (const token of fileName.replace(PROJECT_EXTENSION, "").split("_")) {
    const [, key = "", label = ""] = /^([a-zA-Z0-9]+)-(.*)$/.exec(token) ?? [];
    if (key === "sub" || key === "ses" || key === "desc") continue;
    if (isKeptEntity(key) && !kept[key] && isKeptLabel(key, label)) kept[key] = label;
    else rest.push(token);
  }
  if (GENERIC_LAST_WORD.test(rest[rest.length - 1] ?? "")) rest.pop();
  const word = rest
    .flatMap((token) => token.split(/[^a-zA-Z0-9]+/))
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  return { kept, word };
}

/**
 * Where a save of `fileName` lands: back over the source when it is already a labels file in
 * `derivatives/sleap/`, else a labels file of the source's own (see the top of this module). A
 * package stays a package, since it carries the frames training needs.
 */
export function labelsSavePath(sourcePath: string, fileName: string, { sub, ses }: BidsEntities): string {
  if (isLabelsPath(sourcePath)) return sourcePath;
  const ext: PoseExtension = PACKAGE.test(fileName) || PACKAGE.test(sourcePath) ? "pkg.slp" : "slp";
  const { kept, word } = sourceNameParts(baseName(sourcePath));
  return posePath({ sub, ses, ...kept }, `labels${word}`, ext);
}

export function modelFolderPath(modelId: string): string {
  return `${DERIVATIVES_ROOT}/models/${modelId}/`;
}

export interface DatasetDescriptionInput {
  dandisetId: string;
  /** The archive's web front end, e.g. "https://dandi.emberarchive.org". */
  webUrl: string;
  appVersion: string;
  /** The embedded SLEAP app's version, or the stand-in's while that is what is mounted. */
  sleapVersion: string;
}

/** The derivative dataset's `dataset_description.json`, written on the first save into a dandiset. */
export function datasetDescription({ dandisetId, webUrl, appVersion, sleapVersion }: DatasetDescriptionInput) {
  return {
    Name: `SLEAP pose estimation for dandiset ${dandisetId}`,
    BIDSVersion: BIDS_VERSION,
    DatasetType: "derivative",
    GeneratedBy: [
      { Name: "ember-sleap", Version: appVersion, CodeURL: "https://github.com/brain-bbqs/ember-sleap" },
      { Name: "sleap-app", Version: sleapVersion, CodeURL: "https://github.com/talmolab/sleap-app" },
    ],
    SourceDatasets: [{ URL: `${webUrl}/dandiset/${dandisetId}/draft` }],
  };
}
