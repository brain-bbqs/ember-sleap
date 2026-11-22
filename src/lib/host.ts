import { TRAIN_NEEDS_SAVED_PROJECT, type ComputeClient, type JobInput, type JobRequest } from "./computeClient";
import type { ProjectStorage } from "./emberStorage";
import { fromHostRef } from "./hostRef";
import { listModels, type ModelSource } from "./modelCatalogue";
import type { HostRef, JobSpec, ModelCard, OpenRequest, ResolvedFile, SleapHost } from "./sleapContract";

export interface HostDeps {
  storage: ProjectStorage;
  modelSources: ModelSource[];
  compute: ComputeClient;
  onModelWarning?: (sourceName: string, error: unknown) => void;
}

/** The callbacks the app is mounted with, plus what the page tells the host as it hands files over. */
export interface PageHost extends Required<SleapHost> {
  /** Records a file the page opened, so later job specs that name its URL can say what it is. */
  remember(file: OpenRequest): void;
}

/**
 * The job request for one of the app's specs: every URL it names paired with the type this page
 * knows it to be, and every model id expanded to the files a worker downloads. A URL this page did
 * not hand out has no known type, and a worker cannot guess one from an extensionless link, so the
 * job is refused here rather than failing on the worker. So is training from inline labels: the
 * proxy is promised a saved project's `labels_path` and never a `labels_content` upload, and this is
 * the one place every compute client's requests pass through.
 */
export function buildJobRequest(
  spec: JobSpec,
  project: HostRef | undefined,
  files: ReadonlyMap<string, ResolvedFile>,
  cards: ReadonlyMap<string, ModelCard>,
): JobRequest {
  if (spec.type === "train" && (!spec.labels_path || spec.labels_content)) {
    throw new Error(TRAIN_NEEDS_SAVED_PROJECT);
  }
  const urls = spec.type === "train" ? [spec.labels_path, spec.val_labels_path] : [spec.data_path];
  const inputs = urls.flatMap((url): JobInput[] => {
    if (!url) return [];
    const file = files.get(url);
    if (!file) throw new Error(`This page did not open ${url}, so it cannot tell the worker what kind of file it is.`);
    return [{ url, fileType: file.fileType, name: file.name }];
  });
  const models =
    spec.type === "track"
      ? spec.model_paths.map((id) => {
          const card = cards.get(id);
          if (!card) throw new Error(`Model ${id} is not in the catalogue this page listed.`);
          return { id, files: card.files };
        })
      : [];
  const location = fromHostRef(project);
  return location ? { spec, inputs, models, project: location } : { spec, inputs, models };
}

export function createSleapHost({ storage, modelSources, compute, onModelWarning }: HostDeps): PageHost {
  const files = new Map<string, ResolvedFile>();
  const cards = new Map<string, ModelCard>();
  const remember = (file: ResolvedFile) => files.set(file.url, file);

  return {
    remember,
    save: (file, name, ref) => storage.save(file, name, ref),
    async resolveVideo(storedPath, project) {
      const file = await storage.resolveVideo(storedPath, project);
      if (file) remember(file);
      return file;
    },
    async refreshUrl(file) {
      const fresh = await storage.refreshUrl(file);
      remember(fresh);
      return fresh;
    },
    async listModels(query) {
      const listed = await listModels(modelSources, query, { onWarning: onModelWarning });
      for (const card of listed) cards.set(card.id, card);
      return listed;
    },
    // Async so a refused request rejects the promise rather than throwing at the call site.
    submitJob: async (spec, project) => compute.submit(buildJobRequest(spec, project, files, cards)),
    subscribeJob: (jobId, onEvent) => compute.subscribe(jobId, onEvent),
    cancelJob: (jobId) => compute.cancel(jobId),
  };
}
