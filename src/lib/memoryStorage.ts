import {
  entitiesFromPath,
  labelsSavePath,
  packageClock,
  suggestedEntities,
  trainingPackagePath,
} from "./bidsDerivatives";
import type { SavedFile, ProjectStorage } from "./emberStorage";
import { baseName, fileTypeOfPath } from "./fileType";
import { fromHostRef, toHostRef, type EmberLocation } from "./hostRef";
import type { HostRef } from "./sleapContract";

export interface MemoryStorage extends ProjectStorage {
  /** What each save wrote, in order, for the page and tests to show and check. */
  readonly saved: { path: string; size: number }[];
}

export interface MemoryStorageOptions {
  /** The time a training package is named after (see packageClock in bidsDerivatives.ts). */
  now?: () => Date;
}

/**
 * Storage for `?test&mock_project`: saves, training packages included, are placed exactly where
 * EMBER storage would place them, but kept in memory, so the save path can be exercised with no
 * archive, sign-in or network. Where EMBER storage would ask for a subject and session, the
 * suggestion the dialog would offer is taken instead, and a source path naming no subject at all
 * goes under `sub-mock`. Nothing here is an archive asset, so no link is described as one.
 */
export function createMemoryStorage({ now = () => new Date() }: MemoryStorageOptions = {}): MemoryStorage {
  const saved: { path: string; size: number }[] = [];
  const packageTime = packageClock(now);

  function keep(ref: HostRef | undefined, file: Blob, place: (source: EmberLocation) => string): Promise<SavedFile> {
    const source = fromHostRef(ref);
    if (!source) return Promise.reject(new Error("Only a project opened from EMBER can be saved to EMBER."));
    const path = place(source);
    saved.push({ path, size: file.size });
    // A link per save, as EMBER gives one, that nothing fetches: the bytes stay where they were.
    const url = `memory://${source.dandisetId}/${path}?save=${saved.length}`;
    return Promise.resolve({
      ref: toHostRef({ dandisetId: source.dandisetId, path }),
      file: { url, fileType: fileTypeOfPath(path)!, name: baseName(path) },
    });
  }

  const entitiesOf = (path: string) => entitiesFromPath(path) ?? { sub: "mock", ...suggestedEntities(path) };

  return {
    saved,
    save: (file, name, ref) => keep(ref, file, ({ path }) => labelsSavePath(path, name, entitiesOf(path))),
    saveTrainingPackage: (file, ref) =>
      keep(ref, file, ({ path }) => trainingPackagePath(path, entitiesOf(path), packageTime())),
    resolveVideo: () => Promise.resolve(null),
    refreshUrl: (file) => Promise.resolve(file),
    describe: () => null,
  };
}
