import { base64ToBytes } from "./base64";
import {
  INLINE_LABELS_REFUSED,
  TRAIN_NEEDS_LABELS,
  type ArchiveRef,
  type ComputeClient,
  type JobInput,
  type JobRequest,
} from "./computeClient";
import type { ProjectStorage } from "./emberStorage";
import { fromHostRef } from "./hostRef";
import { listModels, type ModelSource } from "./modelCatalogue";
import type {
  HostRef,
  JobSpec,
  ModelCard,
  ModelQuery,
  OpenRequest,
  ResolvedFile,
  SleapHost,
  TrainJobSpec,
} from "./sleapContract";

export interface HostDeps {
  storage: ProjectStorage;
  modelSources: ModelSource[];
  compute: ComputeClient;
  onModelWarning?: (sourceName: string, error: unknown) => void;
}

/** The callbacks the app is mounted with, plus what the page tells the host as it hands files over. */
export interface PageHost extends Required<SleapHost> {
  /**
   * Records a project the page opened, so later job specs that name its URL can say what it is,
   * and name what the project's saves wrote once it has been saved.
   */
  remember(file: OpenRequest): void;
}

/** What the host knows of the links and models a job spec may name. */
export interface JobContext {
  /** Every link the page handed out or a save wrote, with its type. */
  files: ReadonlyMap<string, ResolvedFile>;
  /** What the latest save of the project a link was opened under wrote, or undefined before a save. */
  latestSave(url: string): ResolvedFile | undefined;
  /** The model cards the page listed, by id. */
  cards: ReadonlyMap<string, ModelCard>;
  /** The EMBER asset behind a link, or null. */
  describe(url: string): ArchiveRef | null;
}

export const INLINE_LABELS_NOT_BASE64 = "The labels sent to train from (labels_content) are not base64.";

/** Why a train spec whose only labels are an empty `labels_content` is refused. */
export const INLINE_LABELS_EMPTY =
  "The labels sent to train from (labels_content) arrived empty, as labels too large to send inline can: save the project, then train.";

/** The spec with `url` as its labels, and no inline labels left. */
function namedLabels(spec: TrainJobSpec, url: string): TrainJobSpec {
  const named: TrainJobSpec = { ...spec, labels_path: url };
  delete named.labels_content;
  return named;
}

/** Every link a spec names as a file to read. */
function linksOf(spec: JobSpec): string[] {
  const links = spec.type === "train" ? [spec.labels_path, spec.val_labels_path] : [spec.data_path];
  return links.filter((link): link is string => Boolean(link));
}

/**
 * The job request for one of the app's specs: every URL it names paired with the type this page
 * knows it to be and the EMBER asset behind it, and every model id expanded to the files a worker
 * downloads. A URL this page did not hand out has no known type, and a worker cannot guess one from
 * an extensionless link, so the job is refused here rather than failing on the worker.
 *
 * `labels_path`, `val_labels_path` and `data_path` naming the link a project was opened under are
 * sent as the file that project's latest save wrote, when it has been saved since: the app keeps
 * naming the link it opened, whose bytes predate the save. A train spec reaching here still carrying
 * inline labels is refused, since compute is never sent them (`submitJob` saves them first). An
 * empty `labels_content` beside a `labels_path` is dropped, and with none it is refused as empty.
 */
export function buildJobRequest(spec: JobSpec, project: HostRef | undefined, known: JobContext): JobRequest {
  const inputs: JobInput[] = [];
  const input = (url: string): string => {
    const file = known.latestSave(url) ?? known.files.get(url);
    if (!file) throw new Error(`This page did not open ${url}, so it cannot tell the worker what kind of file it is.`);
    const archive = known.describe(file.url);
    const { fileType, name } = file;
    inputs.push(archive ? { url: file.url, fileType, name, archive } : { url: file.url, fileType, name });
    return file.url;
  };

  let sent: JobSpec;
  if (spec.type === "train") {
    if (spec.labels_content) throw new Error(INLINE_LABELS_REFUSED);
    if (!spec.labels_path) throw new Error(spec.labels_content === "" ? INLINE_LABELS_EMPTY : TRAIN_NEEDS_LABELS);
    const train = namedLabels(spec, input(spec.labels_path));
    if (spec.val_labels_path) train.val_labels_path = input(spec.val_labels_path);
    sent = train;
  } else {
    sent = { ...spec, data_path: input(spec.data_path) };
  }
  const models =
    sent.type === "track"
      ? sent.model_paths.map((id) => {
          const card = known.cards.get(id);
          if (!card) throw new Error(`Model ${id} is not in the catalogue this page listed.`);
          return { id, files: card.files };
        })
      : [];
  const location = fromHostRef(project);
  return location ? { spec: sent, inputs, models, project: location } : { spec: sent, inputs, models };
}

/** A project the page opened, and the file its latest save wrote. */
interface OpenedProject {
  /** Which open this was, so a save landing after a later open of the same file leaves that open's ref alone. */
  order: number;
  saved?: ResolvedFile;
  /** Settles once every save of the project started so far has. */
  saves: Promise<void>;
}

const settled = () => undefined;

export function createSleapHost({ storage, modelSources, compute, onModelWarning }: HostDeps): PageHost {
  const files = new Map<string, ResolvedFile>();
  const cards = new Map<string, ModelCard>();
  // Each opened project by every link it was handed under (a refresh adds one) and by every ref the
  // app has held for it (each save returns the next), so a save reaches the link a job names.
  const projectsByLink = new Map<string, OpenedProject>();
  const projectsByRef = new Map<string, OpenedProject>();
  let opens = 0;
  const know = (file: ResolvedFile) => files.set(file.url, file);
  const context: JobContext = {
    files,
    latestSave: (url) => projectsByLink.get(url)?.saved,
    cards,
    describe: (url) => storage.describe(url),
  };

  async function listAll(query: ModelQuery): Promise<ModelCard[]> {
    const listed = await listModels(modelSources, query, { onWarning: onModelWarning });
    for (const card of listed) cards.set(card.id, card);
    return listed;
  }

  /**
   * The spec with its inline labels (upstream's "labels from this window") kept on EMBER as a
   * training package beside the project, and named by that file instead.
   */
  async function withSavedLabels(spec: TrainJobSpec, content: string, project?: HostRef): Promise<TrainJobSpec> {
    // Checked as though the package were written, so a job refused for anything else leaves none behind.
    const unwritten: ResolvedFile = { url: "about:training-package", fileType: "pkg.slp", name: "training package" };
    buildJobRequest(namedLabels(spec, unwritten.url), project, {
      ...context,
      files: new Map(files).set(unwritten.url, unwritten),
    });
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = base64ToBytes(content);
    } catch {
      throw new Error(INLINE_LABELS_NOT_BASE64);
    }
    const saved = await storage.saveTrainingPackage(new Blob([bytes]), project);
    know(saved.file);
    return namedLabels(spec, saved.file.url);
  }

  return {
    remember(request) {
      know(request);
      const project: OpenedProject = { order: ++opens, saves: Promise.resolve() };
      projectsByLink.set(request.url, project);
      if (request.ref) projectsByRef.set(request.ref.key, project);
    },
    async save(file, name, ref) {
      // Looked up before the save runs, since the same file may be opened again before it lands.
      const project = ref && projectsByRef.get(ref.key);
      const saving = storage.save(file, name, ref);
      if (project) project.saves = project.saves.then(() => saving).then(settled, settled);
      const saved = await saving;
      know(saved.file);
      if (project) {
        project.saved = saved.file;
        const holder = projectsByRef.get(saved.ref.key);
        if (!holder || holder.order <= project.order) projectsByRef.set(saved.ref.key, project);
      }
      return saved.ref;
    },
    async resolveVideo(storedPath, project) {
      const file = await storage.resolveVideo(storedPath, project);
      if (file) know(file);
      return file;
    },
    async refreshUrl(file) {
      const fresh = await storage.refreshUrl(file);
      know(fresh);
      const project = projectsByLink.get(file.url);
      if (project) projectsByLink.set(fresh.url, project);
      return fresh;
    },
    listModels: listAll,
    // Async so a refused request rejects the promise rather than throwing at the call site.
    async submitJob(spec, project) {
      // A job sent while a project it names is still saving names what that save wrote, as the same
      // press a moment later would.
      await Promise.all(linksOf(spec).flatMap((url) => projectsByLink.get(url)?.saves ?? []));
      const ready =
        spec.type === "train" && spec.labels_content ? await withSavedLabels(spec, spec.labels_content, project) : spec;
      // A model trained since the last listing (upstream names a train result's model_dir in the
      // inference it runs next) is looked for once more before the job is refused.
      if (ready.type === "track" && ready.model_paths.some((id) => !cards.has(id))) await listAll({});
      return compute.submit(buildJobRequest(ready, project, context));
    },
    subscribeJob: (jobId, onEvent) => compute.subscribe(jobId, onEvent),
    cancelJob: (jobId) => compute.cancel(jobId),
  };
}
