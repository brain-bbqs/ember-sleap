// The `derivatives/sleap/` layout from docs/DEVELOPMENT_PLAN.md ("BIDS derivatives layout"), still
// to be confirmed with the EMBER data team. BIDS has no pose-estimation suffix yet, so `_pose` and
// the `.slp` files are kept out of validators' way by the derivative dataset's own `.bidsignore`.

export const DERIVATIVES_ROOT = "derivatives/sleap";
export const DATASET_DESCRIPTION_PATH = `${DERIVATIVES_ROOT}/dataset_description.json`;
export const BIDSIGNORE_PATH = `${DERIVATIVES_ROOT}/.bidsignore`;
export const BIDSIGNORE = "*.slp\n*.ckpt\nmodels/\n";
export const BIDS_VERSION = "1.10.0";

export interface BidsEntities {
  sub: string;
  ses?: string;
}

export type PoseDesc = "labels" | "predictions";
export type PoseExtension = "slp" | "pkg.slp" | "nwb";

const LABEL = /^[a-zA-Z0-9]+$/;

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
 * those, from the file name's own entities. Null when no subject can be found, which is when the
 * page has to ask.
 */
export function entitiesFromPath(path: string): BidsEntities | null {
  const segments = path.split("/");
  const folders = segments.slice(0, -1);
  const fileName = segments[segments.length - 1];
  const fromFolders = (key: "sub" | "ses") =>
    folders.map((f) => (new RegExp(`^${key}-([a-zA-Z0-9]+)$`).exec(f) ?? [])[1]).find(Boolean);
  const sub = fromFolders("sub") ?? entityIn(fileName, "sub");
  if (!sub) return null;
  const ses = fromFolders("ses") ?? entityIn(fileName, "ses");
  return ses ? { sub, ses } : { sub };
}

export function poseFileName({ sub, ses }: BidsEntities, desc: PoseDesc, ext: PoseExtension): string {
  const entities = ses ? `sub-${sub}_ses-${ses}` : `sub-${sub}`;
  return `${entities}_desc-${desc}_pose.${ext}`;
}

export function posePath(entities: BidsEntities, desc: PoseDesc, ext: PoseExtension): string {
  const folder = entities.ses ? `sub-${entities.sub}/ses-${entities.ses}` : `sub-${entities.sub}`;
  return `${DERIVATIVES_ROOT}/${folder}/beh/${poseFileName(entities, desc, ext)}`;
}

export function isDerivativePath(path: string): boolean {
  return path.startsWith(`${DERIVATIVES_ROOT}/`);
}

/**
 * Where a save of `fileName` lands: back over the same asset when the project already lives in
 * `derivatives/sleap/`, else a labels file for the source's subject and session. A package stays a
 * package, since it carries the frames training needs.
 */
export function labelsSavePath(sourcePath: string, fileName: string, entities: BidsEntities): string {
  if (isDerivativePath(sourcePath)) return sourcePath;
  const ext: PoseExtension = /\.pkg\.slp$/i.test(fileName) || /\.pkg\.slp$/i.test(sourcePath) ? "pkg.slp" : "slp";
  return posePath(entities, "labels", ext);
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
