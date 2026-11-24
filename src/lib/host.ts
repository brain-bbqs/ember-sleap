import type { ProjectStorage } from "./emberStorage";
import type { ProjectIntent, SleapHost } from "./sleapContract";

export interface HostDeps {
  storage: ProjectStorage;
  /** The page's own picker for the app's New Project… and Open Project…; without it the app picks local files. */
  chooseProject?: (intent: ProjectIntent) => void;
}

/** The callbacks the app is mounted with: EMBER storage, and the page's project picker. */
export type PageHost = Required<Omit<SleapHost, "chooseProject">> & Pick<SleapHost, "chooseProject">;

export function createSleapHost({ storage, chooseProject }: HostDeps): PageHost {
  return {
    ...(chooseProject ? { chooseProject } : {}),
    save: async (file, name, ref) => (await storage.save(file, name, ref)).ref,
    resolveVideo: (storedPath, project) => storage.resolveVideo(storedPath, project),
    refreshUrl: (file) => storage.refreshUrl(file),
  };
}
