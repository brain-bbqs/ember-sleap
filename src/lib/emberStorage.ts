import { EMBER_INSTANCE, type ArchiveConfig } from "@brain-bbqs/ember-client";
import {
  BIDSIGNORE,
  BIDSIGNORE_PATH,
  DATASET_DESCRIPTION_PATH,
  datasetDescription,
  entitiesFromPath,
  isLabelsPath,
  labelsPathPrefix,
  labelsSavePath,
  numberedLabelsPath,
  packageClock,
  trainingPackagePath,
  trainingPackagePrefix,
  type BidsEntities,
} from "./bidsDerivatives";
import type { ArchiveRef } from "./computeClient";
import {
  closestAsset,
  downloadUrl,
  findAssetByPath,
  findAssetsByName,
  findAssetsByPrefix,
  resolveDownloadUrl,
  type ArchiveAsset,
  type ProjectAsset,
} from "./emberAssets";
import { putAsset, type SaveStage } from "./emberUpload";
import type { EtagHasher } from "./etagPool";
import { baseName, fileTypeOfPath, isProjectType, projectTypeOf } from "./fileType";
import { fromHostRef, toHostRef, type EmberLocation } from "./hostRef";
import type { FileType, HostRef, NewProjectRequest, OpenRequest, ProjectVideo, ResolvedFile } from "./sleapContract";

/** What a save wrote: the ref the app keeps for it, and the file, by a link this storage can renew and describe. */
export interface SavedFile {
  ref: HostRef;
  file: ResolvedFile;
}

/** The storage half of the host contract, which a fake can stand in for (see memoryStorage.ts). */
export interface ProjectStorage {
  save(file: Blob, name: string, ref?: HostRef): Promise<SavedFile>;
  /**
   * Keeps labels a training job was sent inline as a package of their own beside the project, under
   * the rules a save of the project follows (see bidsDerivatives.ts for where it goes).
   */
  saveTrainingPackage(file: Blob, ref?: HostRef): Promise<SavedFile>;
  resolveVideo(storedPath: string, project?: HostRef): Promise<ResolvedFile | null>;
  refreshUrl(file: ResolvedFile): Promise<ResolvedFile>;
  /** The EMBER asset behind a link this storage handed out, or null for any other link. */
  describe(url: string): ArchiveRef | null;
}

/** Opening a project by where it sits rather than from a listing, as the predictions a job wrote are opened. */
export interface PathOpener {
  /**
   * The project at `path` in the dandiset's draft, resolved to what the app's `open` takes. Rejects
   * with {@link notOnEmberYet}'s message when no asset is at `path` (a worker may still be writing
   * it), and when `path` names no SLEAP project.
   */
  openPath(dandisetId: string, path: string): Promise<OpenRequest>;
}

export interface EmberStorage extends ProjectStorage, PathOpener {
  /** A listed project, resolved to what the app's `open` takes. */
  open(dandisetId: string, project: ProjectAsset): Promise<OpenRequest>;
  /**
   * A new project on listed videos, as the app's `create` takes it: each video by a link this
   * storage can renew and describe, recorded by its path in the dandiset. The project belongs where
   * its first video is, so its first save lands in that video's subject (and session) folder.
   */
  startProject(dandisetId: string, videos: ProjectAsset[]): Promise<NewProjectRequest>;
}

/** What a new project is called until its first save names it after its first video. */
export const NEW_PROJECT_NAME = "Untitled.slp";

/** How many video links a new project resolves at once. */
const VIDEO_LINKS_AT_ONCE = 4;

/** Why a file a job reported does not open: nothing is at its path, which a worker may still be writing. */
export function notOnEmberYet(path: string): string {
  return `${path} is not on EMBER yet: the job may still be writing it. Try again in a moment.`;
}

/** What to do when a save's labels file is already there: go over it, save beside it, or stop. */
export type OverwriteChoice = "replace" | "keep-both" | "cancel";

export interface EmberStorageOptions {
  /** The archive config for a dandiset, with a token freshened for the call about to be made. */
  config: (dandisetId: string) => Promise<ArchiveConfig>;
  /**
   * Asks the person for a subject (and session) when a source path names none, or names one that
   * is not a BIDS label; null cancels. Asked once per source: the answer stands for the page's later
   * saves and training packages from it, so they all land in one subject's folder.
   */
  askEntities: (sourcePath: string) => Promise<BidsEntities | null>;
  /**
   * Asks what to do when the labels file a save would create already exists: an earlier save of
   * this project from its source, or another project whose name reads the same.
   */
  askOverwrite: (path: string) => Promise<OverwriteChoice>;
  /** Why saving to this dandiset is refused right now (the human-subjects gate), or null. */
  saveRefusal?: (dandisetId: string) => string | null;
  /** Read at save time: the app version is fixed, but the SLEAP component loads on first open. */
  versions: () => { app: string; sleap: string };
  onProgress?: (stage: SaveStage, fraction: number) => void;
  /** Hashes the project file; the derivative dataset's small scaffold files hash on the main thread. */
  hash?: EtagHasher;
  /** Hears about a non-fatal problem, such as the derivative dataset's scaffolding failing to write. */
  onWarning?: (message: string) => void;
  /** The time a training package is named after (see packageClock in bidsDerivatives.ts). */
  now?: () => Date;
  fetch?: typeof fetch;
}

type Located = Pick<ArchiveAsset, "asset_id" | "path">;

/** A message as a sentence, so warnings read one after another. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function createEmberStorage(options: EmberStorageOptions): EmberStorage {
  const {
    config,
    askEntities,
    askOverwrite,
    saveRefusal,
    versions,
    onProgress,
    hash,
    onWarning = console.warn,
    now = () => new Date(),
    fetch,
  } = options;
  // Which asset each URL handed to the app came from, so an expired presigned link can be renewed
  // and a job can name the asset. A renewed link's old URL stays known, since a caller holding it
  // may ask again later.
  const located = new Map<string, ArchiveRef>();
  // Saves run one at a time, so a save's check for an existing labels file sees the one before it.
  let saving: Promise<unknown> = Promise.resolve();
  const packageTime = packageClock(now);
  // The subject and session the person gave for each source, by its ref's key.
  const answered = new Map<string, BidsEntities>();

  function locate(cfg: ArchiveConfig, { asset_id, path }: Located, url: string): string {
    located.set(url, { dandisetId: cfg.dandisetId, assetId: asset_id, path, downloadUrl: downloadUrl(cfg, asset_id) });
    return url;
  }

  async function resolve(cfg: ArchiveConfig, asset: Located): Promise<string> {
    return locate(cfg, asset, await resolveDownloadUrl(cfg, asset.asset_id, fetch));
  }

  /** A project asset as the app's `open` takes it, by a link this storage can renew and describe. */
  async function opened(
    cfg: ArchiveConfig,
    dandisetId: string,
    asset: Located,
    fileType: FileType,
  ): Promise<OpenRequest> {
    const url = await resolve(cfg, asset);
    return { url, fileType, name: baseName(asset.path), ref: toHostRef({ dandisetId, path: asset.path }) };
  }

  /** Writes the derivative dataset's description and ignore file once; a failure only warns. */
  async function ensureScaffold(cfg: ArchiveConfig): Promise<void> {
    const files: [string, string][] = [
      [
        DATASET_DESCRIPTION_PATH,
        `${JSON.stringify(
          datasetDescription({
            dandisetId: cfg.dandisetId,
            webUrl: cfg.web || EMBER_INSTANCE.web,
            appVersion: versions().app,
            sleapVersion: versions().sleap,
          }),
          null,
          2,
        )}\n`,
      ],
      [BIDSIGNORE_PATH, BIDSIGNORE],
    ];
    for (const [path, content] of files) {
      try {
        if (!(await findAssetByPath(cfg, path))) await putAsset(cfg, path, new Blob([content]));
      } catch (e) {
        onWarning(sentence(`Could not write ${path}: ${e instanceof Error ? e.message : String(e)}`));
      }
    }
  }

  /** The first `desc-labels<word><n>` beside `target` that nothing holds yet, from one listing. */
  async function besideTarget(cfg: ArchiveConfig, target: string): Promise<string> {
    const taken = new Set((await findAssetsByPrefix(cfg, labelsPathPrefix(target))).map((a) => a.path));
    let n = 2;
    while (taken.has(numberedLabelsPath(target, n))) n++;
    return numberedLabelsPath(target, n);
  }

  /** The project a save comes from, once saving is allowed: one on EMBER, with an account signed in. */
  async function saveSource(ref?: HostRef): Promise<{ source: EmberLocation; cfg: ArchiveConfig }> {
    const source = fromHostRef(ref);
    if (!source) throw new Error("Only a project opened from EMBER can be saved to EMBER.");
    const refusal = saveRefusal?.(source.dandisetId);
    if (refusal) throw new Error(refusal);
    const cfg = await config(source.dandisetId);
    if (!cfg.accessToken) throw new Error("Sign in with EMBER to save.");
    return { source, cfg };
  }

  async function entitiesOf(source: EmberLocation): Promise<BidsEntities> {
    const read = entitiesFromPath(source.path);
    if (read) return read;
    const key = toHostRef(source).key;
    const entities = answered.get(key) ?? (await askEntities(source.path));
    if (!entities) throw new Error("Save cancelled: labels in derivatives/sleap/ are placed by subject and session.");
    answered.set(key, entities);
    return entities;
  }

  /** Uploads `file` to `target`, then hands it back by a fresh link a job can name. */
  async function write(cfg: ArchiveConfig, target: string, file: Blob): Promise<SavedFile> {
    const asset = await putAsset(cfg, target, file, { onProgress, hash });
    await ensureScaffold(cfg);
    // The bytes are saved by now, so a link that cannot be had does not fail the save: the asset's
    // own download endpoint names it as well, and a worker resolves that itself.
    const url = await resolve(cfg, asset).catch(() => locate(cfg, asset, downloadUrl(cfg, asset.asset_id)));
    return {
      ref: toHostRef({ dandisetId: cfg.dandisetId, path: target }),
      file: { url, fileType: fileTypeOfPath(target)!, name: baseName(target) },
    };
  }

  async function saveNow(file: Blob, name: string, ref?: HostRef): Promise<SavedFile> {
    const { source, cfg } = await saveSource(ref);
    let target = source.path;
    if (!isLabelsPath(source.path)) {
      target = labelsSavePath(source.path, name, await entitiesOf(source));
      // Asked before the upload, so a cancelled save sends no bytes.
      if (await findAssetByPath(cfg, target)) {
        const choice = await askOverwrite(target);
        if (choice === "cancel") throw new Error(`Save cancelled: ${target} already holds labels.`);
        if (choice === "keep-both") target = await besideTarget(cfg, target);
      }
    }
    return write(cfg, target, file);
  }

  async function saveTrainingPackageNow(file: Blob, ref?: HostRef): Promise<SavedFile> {
    const { source, cfg } = await saveSource(ref);
    const entities = await entitiesOf(source);
    // Another page, or this one before a reload, may have named a package for the same second: each
    // run keeps a snapshot of its own, so a name already taken moves on rather than going over it.
    const prefix = trainingPackagePrefix(source.path, entities);
    const taken = new Set((await findAssetsByPrefix(cfg, prefix)).map((a) => a.path));
    let target: string;
    do {
      target = trainingPackagePath(source.path, entities, packageTime());
    } while (taken.has(target));
    return write(cfg, target, file);
  }

  function queued(run: () => Promise<SavedFile>): Promise<SavedFile> {
    const next = saving.then(run);
    saving = next.catch(() => undefined);
    return next;
  }

  return {
    async open(dandisetId, project) {
      return opened(await config(dandisetId), dandisetId, project, project.fileType);
    },

    async startProject(dandisetId, videos) {
      if (videos.length === 0) throw new Error(`Dandiset ${dandisetId} holds no videos to start a project from.`);
      const cfg = await config(dandisetId);
      const resolved: ProjectVideo[] = new Array<ProjectVideo>(videos.length);
      let next = 0;
      async function worker(): Promise<void> {
        while (next < videos.length) {
          const i = next++;
          const video = videos[i];
          const url = await resolve(cfg, video);
          resolved[i] = { url, fileType: video.fileType, name: baseName(video.path), storedPath: video.path };
        }
      }
      await Promise.all(Array.from({ length: Math.min(VIDEO_LINKS_AT_ONCE, videos.length) }, worker));
      return {
        name: NEW_PROJECT_NAME,
        videos: resolved,
        ref: toHostRef({ dandisetId, path: videos[0].path }),
      };
    },

    async openPath(dandisetId, path) {
      const fileType = projectTypeOf(path);
      const cfg = await config(dandisetId);
      const asset = await findAssetByPath(cfg, path);
      if (!asset) throw new Error(notOnEmberYet(path));
      return opened(cfg, dandisetId, asset, fileType);
    },

    save: (file, name, ref) => queued(() => saveNow(file, name, ref)),

    saveTrainingPackage: (file, ref) => queued(() => saveTrainingPackageNow(file, ref)),

    async resolveVideo(storedPath, project) {
      const source = fromHostRef(project);
      const fileType = fileTypeOfPath(storedPath);
      if (!source || !fileType || isProjectType(fileType)) return null;
      const cfg = await config(source.dandisetId);
      const name = baseName(storedPath);
      const candidates = await findAssetsByName(cfg, name);
      if (candidates.length === 0) return null;
      const asset = closestAsset(candidates, source.path, storedPath);
      return { url: await resolve(cfg, asset), fileType, name };
    },

    async refreshUrl(file) {
      const where = located.get(file.url);
      if (!where) return file;
      const cfg = await config(where.dandisetId);
      const url = await resolve(cfg, { asset_id: where.assetId, path: where.path });
      return { ...file, url };
    },

    describe: (url) => located.get(url) ?? null,
  };
}
