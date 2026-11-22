// The `derivatives/sleap/` layout from docs/DEVELOPMENT_PLAN.md ("BIDS derivatives layout"), still
// to be confirmed with the EMBER data team. BIDS has no pose-estimation suffix yet, so `_pose` and
// the `.slp` files are kept out of validators' way by the derivative dataset's own `.bidsignore`.
//
// A save goes back over its source only when the source is already a labels file here
// (`..._desc-labels<word>_pose.slp`). Any other source, a `desc-predictions` file included, gets a
// labels file of its own, named so that no two sources share one: it keeps the source name's task,
// acq, run and recording entities, and its desc label goes on with one CamelCase word made of the
// source's folders below its subject and session (datatype folders such as `beh` aside), what its
// own desc adds after `labels` or `predictions`, and the rest of its name (minus a trailing `pose`
// or `labels`). So `sub-01/ses-01/beh/cam-top.slp` saves to
// `derivatives/sleap/sub-01/ses-01/beh/sub-01_ses-01_desc-labelsCamTop_pose.slp`. Predictions are
// named the same way, as `desc-predictions<word>`, so proofreading them saves to that same file.

export const DERIVATIVES_ROOT = "derivatives/sleap";
export const DATASET_DESCRIPTION_PATH = `${DERIVATIVES_ROOT}/dataset_description.json`;
export const BIDSIGNORE_PATH = `${DERIVATIVES_ROOT}/.bidsignore`;
export const BIDSIGNORE = "*.slp\n*.ckpt\nmodels/\n";
export const BIDS_VERSION = "1.10.0";

export interface BidsEntities {
  sub: string;
  ses?: string;
}

/** The entities a source's name passes on to its pose files, in BIDS order; all apply to `beh`. */
const KEPT_ENTITIES = ["task", "acq", "run", "recording"] as const;
type KeptEntity = (typeof KEPT_ENTITIES)[number];

/** What a pose file's name carries before its desc: the subject and session, then the kept entities. */
export type PoseEntities = BidsEntities & Partial<Record<KeptEntity, string>>;

export type PoseDesc = "labels" | "predictions";
/** A desc label: `labels` or `predictions`, optionally followed by what tells its source apart. */
export type PoseDescLabel = `${PoseDesc}${string}`;
export type PoseExtension = "slp" | "pkg.slp" | "nwb";

const LABEL = /^[a-zA-Z0-9]+$/;
const NOT_LABEL = /[^a-zA-Z0-9]+/g;
const INDEX = /^[0-9]+$/;
const PACKAGE = /\.pkg\.slp$/i;
const PROJECT_EXTENSION = /(?:\.pkg)?\.slp$/i;
const OTHER_EXTENSION = /\.[a-zA-Z0-9]+$/;
const LABELS_FILE = /_desc-labels[a-zA-Z0-9]*_pose\.(?:pkg\.)?slp$/i;
const LABELS_DESC = /(_desc-labels[a-zA-Z0-9]*)(_pose\.)/i;
const POSE_SUFFIX = /_pose\.(?:pkg\.)?slp$/i;
const GENERIC_LAST_WORD = /^(?:pose|labels)$/i;
const POSE_DESC_PREFIX = /^(?:labels|predictions)/i;
const NAMES_SUBJECT_OR_SESSION = /(?:^|_)(?:sub|ses)-/;
// BIDS datatype folders: they say what kind of data sits below, not which source it is.
const DATATYPE_FOLDERS: ReadonlySet<string> = new Set([
  "anat",
  "beh",
  "dwi",
  "ecephys",
  "eeg",
  "emg",
  "fmap",
  "func",
  "icephys",
  "ieeg",
  "meg",
  "micr",
  "motion",
  "mrs",
  "nirs",
  "perf",
  "pet",
]);

/** BIDS labels are alphanumeric only: no hyphens, underscores or spaces. */
export function isBidsLabel(value: string): boolean {
  return LABEL.test(value);
}

/** A file name without its extension, `.pkg.slp` counting as one. */
function stem(fileName: string): string {
  const project = fileName.replace(PROJECT_EXTENSION, "");
  return project === fileName ? fileName.replace(OTHER_EXTENSION, "") : project;
}

function entityIn(segment: string, key: "sub" | "ses"): string | undefined {
  const match = new RegExp(`(?:^|_)${key}-([a-zA-Z0-9]+)(?=_|\\.|$)`).exec(segment);
  return match?.[1];
}

/** Whether a folder or the file name in `path` carries a `sub-` or `ses-` entity, readable or not. */
export function namesEntity(path: string, key: "sub" | "ses"): boolean {
  return new RegExp(`(?:^|[/_])${key}-`).test(path);
}

/**
 * The subject and session a source file belongs to, read from its folders (`sub-01/`, or a folder
 * such as `sub-01_ses-day1_behavior+image/` that names them) or, failing those, from the file
 * name's own entities. Null when no subject can be read, or when the path names a session whose
 * label cannot be read: that is when the page has to ask, since guessing "no session" would put
 * every session of the subject in one file.
 */
export function entitiesFromPath(path: string): BidsEntities | null {
  const segments = path.split("/");
  const read = (key: "sub" | "ses") => segments.map((segment) => entityIn(segment, key)).find(Boolean);
  const sub = read("sub");
  const ses = read("ses");
  if (!sub || (namesEntity(path, "ses") && !ses)) return null;
  return ses ? { sub, ses } : { sub };
}

/**
 * The subject and session a path names, read loosely: the first `sub-` and `ses-` among its folders
 * and file name, with everything but letters and digits dropped, so `ses-day-1` reads as `day1`. A
 * suggestion for the person to check, and a way to tell whether two paths name the same subject;
 * never a save location by itself.
 */
export function suggestedEntities(path: string): Partial<BidsEntities> {
  const segments = path.split("/");
  segments.push(stem(segments.pop()!));
  const tokens = segments.flatMap((segment) => segment.split("_"));
  const read = (key: "sub" | "ses") =>
    tokens
      .filter((token) => token.startsWith(`${key}-`))
      .map((token) => token.slice(key.length + 1).replace(NOT_LABEL, ""))
      .find(Boolean);
  const sub = read("sub");
  const ses = read("ses");
  return { ...(sub ? { sub } : {}), ...(ses ? { ses } : {}) };
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

/** The folders below the deepest one naming a subject or session, datatype folders left out. */
function foldersBelowSubject(folders: string[]): string[] {
  let deepest = -1;
  folders.forEach((folder, i) => {
    if (NAMES_SUBJECT_OR_SESSION.test(folder)) deepest = i;
  });
  return deepest < 0 ? [] : folders.slice(deepest + 1).filter((folder) => !DATATYPE_FOLDERS.has(folder));
}

/**
 * Splits a source into the entities its pose files keep and the CamelCase word that tells it apart
 * (see the top of this module). Its own sub and ses are dropped, since the pose file has its own.
 */
function sourceParts(sourcePath: string): { kept: Partial<Record<KeptEntity, string>>; word: string } {
  const segments = sourcePath.split("/");
  const fileName = segments.pop()!;
  const kept: Partial<Record<KeptEntity, string>> = {};
  let qualifier: string | undefined;
  const rest: string[] = [];
  for (const token of stem(fileName).split("_")) {
    const [, key = "", label = ""] = /^([a-zA-Z0-9]+)-(.*)$/.exec(token) ?? [];
    if (key === "sub" || key === "ses") continue;
    if (key === "desc" && qualifier === undefined) qualifier = label.replace(POSE_DESC_PREFIX, "");
    else if (isKeptEntity(key) && !kept[key] && isKeptLabel(key, label)) kept[key] = label;
    else rest.push(token);
  }
  if (GENERIC_LAST_WORD.test(rest[rest.length - 1] ?? "")) rest.pop();
  const word = [...foldersBelowSubject(segments), qualifier ?? "", ...rest]
    .flatMap((part) => part.split(NOT_LABEL))
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  return { kept, word };
}

function sourcePosePath(sourcePath: string, desc: PoseDesc, { sub, ses }: BidsEntities, ext: PoseExtension) {
  const { kept, word } = sourceParts(sourcePath);
  return posePath({ sub, ses, ...kept }, `${desc}${word}`, ext);
}

/**
 * Where a save of `fileName` lands: back over the source when it is already a labels file in
 * `derivatives/sleap/`, else a labels file of the source's own (see the top of this module). A
 * package stays a package, since it carries the frames training needs.
 */
export function labelsSavePath(sourcePath: string, fileName: string, entities: BidsEntities): string {
  if (isLabelsPath(sourcePath)) return sourcePath;
  const ext: PoseExtension = PACKAGE.test(fileName) || PACKAGE.test(sourcePath) ? "pkg.slp" : "slp";
  return sourcePosePath(sourcePath, "labels", entities, ext);
}

/** Where inference for a source writes its predictions: `desc-predictions<word>`, its labels file's twin. */
export function predictionsPath(sourcePath: string, entities: BidsEntities): string {
  return sourcePosePath(sourcePath, "predictions", entities, "slp");
}

/**
 * A labels file's `n`th alternative name, `desc-labels<word><n>`, for keeping both when a save's
 * own target already holds labels.
 */
export function numberedLabelsPath(path: string, n: number): string {
  return path.replace(LABELS_DESC, `$1${n}$2`);
}

/** What a labels file's name and every numbered alternative to it start with. */
export function labelsPathPrefix(path: string): string {
  return path.replace(POSE_SUFFIX, "");
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
