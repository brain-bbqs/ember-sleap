import { entitiesFromPath, labelsSavePath, suggestedEntities } from "./bidsDerivatives";
import type { SavedFile, ProjectStorage } from "./emberStorage";
import { baseName, fileTypeOfPath } from "./fileType";
import { fromHostRef, toHostRef } from "./hostRef";

export interface MemoryStorage extends ProjectStorage {
  /** What each save wrote, in order, for the page and tests to show and check. */
  readonly saved: { path: string; size: number }[];
}

/**
 * Storage for `?test&mock_project`: saves are placed exactly where EMBER storage would place them,
 * but kept in memory, so the save path can be exercised with no archive, sign-in or network. Where
 * EMBER storage would ask for a subject and session, the suggestion the dialog would offer is taken
 * instead, and a source path naming no subject at all goes under `sub-mock`.
 */
export function createMemoryStorage(): MemoryStorage {
  const saved: { path: string; size: number }[] = [];
  const entitiesOf = (path: string) => entitiesFromPath(path) ?? { sub: "mock", ...suggestedEntities(path) };

  return {
    saved,
    save(file, name, ref) {
      const source = fromHostRef(ref);
      if (!source) return Promise.reject(new Error("Only a project opened from EMBER can be saved to EMBER."));
      const path = labelsSavePath(source.path, name, entitiesOf(source.path));
      saved.push({ path, size: file.size });
      // A link per save, as EMBER gives one, that nothing fetches: the bytes stay where they were.
      const url = `memory://${source.dandisetId}/${path}?save=${saved.length}`;
      return Promise.resolve<SavedFile>({
        ref: toHostRef({ dandisetId: source.dandisetId, path }),
        file: { url, fileType: fileTypeOfPath(path)!, name: baseName(path) },
      });
    },
    resolveVideo: () => Promise.resolve(null),
    refreshUrl: (file) => Promise.resolve(file),
  };
}
