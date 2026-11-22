import { EMBER_INSTANCE, type ArchiveConfig } from "@brain-bbqs/ember-client";
import {
  BIDSIGNORE,
  BIDSIGNORE_PATH,
  DATASET_DESCRIPTION_PATH,
  datasetDescription,
  entitiesFromPath,
  isLabelsPath,
  labelsSavePath,
  type BidsEntities,
} from "./bidsDerivatives";
import {
  closestAsset,
  findAssetByPath,
  findAssetsByName,
  resolveDownloadUrl,
  type ArchiveAsset,
  type ProjectAsset,
} from "./emberAssets";
import { putAsset } from "./emberUpload";
import { baseName, fileTypeOfPath, isProjectType } from "./fileType";
import { fromHostRef, toHostRef } from "./hostRef";
import type { HostRef, OpenRequest, ResolvedFile } from "./sleapContract";

/** The storage half of the host contract, which a fake can stand in for (see memoryStorage.ts). */
export interface ProjectStorage {
  save(file: Blob, name: string, ref?: HostRef): Promise<HostRef>;
  resolveVideo(storedPath: string, project?: HostRef): Promise<ResolvedFile | null>;
  refreshUrl(file: ResolvedFile): Promise<ResolvedFile>;
}

export interface EmberStorage extends ProjectStorage {
  /** A listed project, resolved to what the app's `open` takes. */
  open(dandisetId: string, project: ProjectAsset): Promise<OpenRequest>;
}

export interface EmberStorageOptions {
  /** The archive config for a dandiset, with a token freshened for the call about to be made. */
  config: (dandisetId: string) => Promise<ArchiveConfig>;
  /** Asks the person for a subject (and session) when a source path names none; null cancels. */
  askEntities: (sourcePath: string) => Promise<BidsEntities | null>;
  /** Asks before a save replaces labels another project left at `path`; false cancels the save. */
  confirmOverwrite: (path: string) => Promise<boolean>;
  /** Why saving to this dandiset is refused right now (the human-subjects gate), or null. */
  saveRefusal?: (dandisetId: string) => string | null;
  /** Read at save time: the app version is fixed, but the SLEAP component loads on first open. */
  versions: () => { app: string; sleap: string };
  onProgress?: (fraction: number) => void;
  /** Hears about a non-fatal problem, such as the derivative dataset's scaffolding failing to write. */
  onWarning?: (message: string) => void;
  fetch?: typeof fetch;
}

interface Located {
  dandisetId: string;
  assetId: string;
}

export function createEmberStorage(options: EmberStorageOptions): EmberStorage {
  const {
    config,
    askEntities,
    confirmOverwrite,
    saveRefusal,
    versions,
    onProgress,
    onWarning = console.warn,
    fetch,
  } = options;
  // Which asset each URL handed to the app came from, so an expired presigned link can be renewed.
  const located = new Map<string, Located>();

  async function resolve(cfg: ArchiveConfig, asset: ArchiveAsset): Promise<string> {
    const url = await resolveDownloadUrl(cfg, asset.asset_id, fetch);
    located.set(url, { dandisetId: cfg.dandisetId, assetId: asset.asset_id });
    return url;
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
        onWarning(`Saved, but could not write ${path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return {
    async open(dandisetId, project) {
      const cfg = await config(dandisetId);
      const url = await resolve(cfg, project);
      return {
        url,
        fileType: project.fileType,
        name: baseName(project.path),
        ref: toHostRef({ dandisetId, path: project.path }),
      };
    },

    async save(file, name, ref) {
      const source = fromHostRef(ref);
      if (!source) throw new Error("Only a project opened from EMBER can be saved to EMBER.");
      const refusal = saveRefusal?.(source.dandisetId);
      if (refusal) throw new Error(refusal);
      const cfg = await config(source.dandisetId);
      if (!cfg.accessToken) throw new Error("Sign in with EMBER to save.");

      let target = source.path;
      if (!isLabelsPath(source.path)) {
        const entities = entitiesFromPath(source.path) ?? (await askEntities(source.path));
        if (!entities)
          throw new Error("Save cancelled: a subject is needed to place the labels in derivatives/sleap/.");
        target = labelsSavePath(source.path, name, entities);
        // Asked before the upload, so a cancelled save sends no bytes.
        if ((await findAssetByPath(cfg, target)) && !(await confirmOverwrite(target)))
          throw new Error(`Save cancelled: ${target} already holds other labels.`);
      }
      await putAsset(cfg, target, file, onProgress);
      await ensureScaffold(cfg);
      return toHostRef({ dandisetId: source.dandisetId, path: target });
    },

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
      const url = await resolve(cfg, { asset_id: where.assetId, path: "", size: 0 });
      located.delete(file.url);
      return { ...file, url };
    },
  };
}
