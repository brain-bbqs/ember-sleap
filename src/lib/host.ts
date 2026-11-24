import { base64ToBytes } from "./base64";
import {
  DEEPLABCUT_RUNS_ALONE,
  INLINE_LABELS_REFUSED,
  isTerminalEvent,
  TRAIN_NEEDS_LABELS,
  type ArchiveRef,
  type ComputeClient,
  type JobInput,
  type JobModel,
  type JobRequest,
} from "./computeClient";
import type { ProjectStorage } from "./emberStorage";
import { fromHostRef, type EmberLocation } from "./hostRef";
import { frameworkOf, listModels, type HostModelCard, type ModelSource } from "./modelCatalogue";
import { readPredictions } from "./predictions";
import type {
  HostRef,
  JobEvent,
  JobSpec,
  ModelCard,
  ModelQuery,
  NewProjectRequest,
  OpenRequest,
  ProjectIntent,
  ResolvedFile,
  SleapHost,
  TrainJobSpec,
} from "./sleapContract";

export interface HostDeps {
  storage: ProjectStorage;
  modelSources: ModelSource[];
  compute: ComputeClient;
  onModelWarning?: (sourceName: string, error: unknown) => void;
  /**
   * Hears the predictions files a track job wrote when it completes, once per job: what its
   * `job.result` names, as files in the dandiset the job was submitted from (see predictions.ts).
   * The host reads them from the app's own subscriptions, so a job the app stops following before
   * it ends goes unreported, and so does one submitted before the page's last `forgetJobs`.
   */
  onPredictions?: (jobId: string, files: EmberLocation[]) => void;
  /** The page's own picker for the app's New Project… and Open Project…; without it the app picks local files. */
  chooseProject?: (intent: ProjectIntent) => void;
}

/** The callbacks the app is mounted with, plus what the page tells the host as it hands files over. */
export interface PageHost extends Required<Omit<SleapHost, "chooseProject">>, Pick<SleapHost, "chooseProject"> {
  /**
   * Records a project the page opened, so later job specs that name its URL can say what it is,
   * and name what the project's saves wrote once it has been saved.
   */
  remember(file: OpenRequest): void;
  /** Records a new project the page started, so job specs can name its videos and its saves are followed. */
  rememberNew(request: NewProjectRequest): void;
  /**
   * Stops reporting the predictions of every job submitted so far, one whose submission is still on
   * its way included, as closing the project does: they belong to an app that is gone.
   */
  forgetJobs(): void;
}

/** What the host knows of the links and models a job spec may name. */
export interface JobContext {
  /** Every link the page handed out or a save wrote, with its type. */
  files: ReadonlyMap<string, ResolvedFile>;
  /** What the latest save of the project a link was opened under wrote, or undefined before a save. */
  latestSave(url: string): ResolvedFile | undefined;
  /** The model cards the page listed, by id. */
  cards: ReadonlyMap<string, HostModelCard>;
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
  const models = sent.type === "track" ? sent.model_paths.map((id) => jobModel(id, known)) : [];
  if (models.length > 1 && models.some((model) => model.framework !== "sleap-nn")) {
    throw new Error(DEEPLABCUT_RUNS_ALONE);
  }
  const location = fromHostRef(project);
  return location ? { spec: sent, inputs, models, project: location } : { spec: sent, inputs, models };
}

/** A model card the page listed, as a worker fetches and runs it. */
function jobModel(id: string, known: JobContext): JobModel {
  const card = known.cards.get(id);
  if (!card) throw new Error(`Model ${id} is not in the catalogue this page listed.`);
  const framework = frameworkOf(card);
  if (framework === "deeplabcut") {
    if (!card.deeplabcut) throw new Error(`Model ${id} runs on DeepLabCut but names no DeepLabCut model.`);
    return { id, framework, deeplabcut: card.deeplabcut, files: card.files };
  }
  return { id, framework, files: card.files };
}

/** A project the page opened, and the file its latest save wrote. */
interface OpenedProject {
  /** Which open this was, so a save landing after a later open of the same file leaves that open's ref alone. */
  order: number;
  saved?: ResolvedFile;
  /** Settles once every save of the project started so far has. */
  saves: Promise<void>;
}

/** A track job whose predictions are still to report, and what its result named once it arrives. */
interface TrackedJob {
  dandisetId: string;
  predictions?: EmberLocation[];
}

const settled = () => undefined;

export function createSleapHost({
  storage,
  modelSources,
  compute,
  onModelWarning,
  onPredictions,
  chooseProject,
}: HostDeps): PageHost {
  const files = new Map<string, ResolvedFile>();
  const cards = new Map<string, HostModelCard>();
  // Track jobs submitted from a project on EMBER, by job id, until each ends: one that has left
  // reports nothing again, however many subscribers hear it or replay its history.
  const tracked = new Map<string, TrackedJob>();
  // Bumped by forgetJobs, so a submission it overtook is not tracked once it lands.
  let jobEpoch = 0;
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
    // A listing an index entry replaced stays known by its own id, as a train result's model_dir names it.
    const remember = (card: HostModelCard) => cards.set(card.id, card);
    const listed = await listModels(modelSources, query, { onWarning: onModelWarning, onReplaced: remember });
    listed.forEach(remember);
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

  /** Reads a tracked job's predictions from its result, and reports them when it completes. */
  function observe(jobId: string, event: JobEvent): void {
    const job = tracked.get(jobId);
    if (!job) return;
    if (event.topic === "job.result" && !job.predictions) {
      const { files: written, ignored } = readPredictions(event.data, job.dandisetId);
      if (ignored.length) console.warn(`Ignored predictions job ${jobId} reported: ${ignored.join("; ")}.`);
      job.predictions = written;
    } else if (isTerminalEvent(event)) {
      tracked.delete(jobId);
      if (event.data.state === "completed" && job.predictions?.length) onPredictions?.(jobId, job.predictions);
    }
  }

  return {
    ...(chooseProject ? { chooseProject } : {}),
    remember(request) {
      know(request);
      const project: OpenedProject = { order: ++opens, saves: Promise.resolve() };
      projectsByLink.set(request.url, project);
      if (request.ref) projectsByRef.set(request.ref.key, project);
    },
    rememberNew(request) {
      request.videos.forEach(know);
      const project: OpenedProject = { order: ++opens, saves: Promise.resolve() };
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
      const epoch = jobEpoch;
      // A job sent while a project it names is still saving names what that save wrote, as the same
      // press a moment later would.
      await Promise.all(linksOf(spec).flatMap((url) => projectsByLink.get(url)?.saves ?? []));
      const ready =
        spec.type === "train" && spec.labels_content ? await withSavedLabels(spec, spec.labels_content, project) : spec;
      // A model trained since the last listing (upstream names a train result's model_dir in the
      // inference it runs next) is looked for once more before the job is refused.
      if (ready.type === "track" && ready.model_paths.some((id) => !cards.has(id))) await listAll({});
      const request = buildJobRequest(ready, project, context);
      const submitted = await compute.submit(request);
      // Before the app hears the id, so its first subscription is already watched.
      if (onPredictions && request.spec.type === "track" && request.project && epoch === jobEpoch) {
        tracked.set(submitted.jobId, { dandisetId: request.project.dandisetId });
      }
      return submitted;
    },
    forgetJobs() {
      jobEpoch++;
      tracked.clear();
    },
    subscribeJob(jobId, onEvent) {
      if (!tracked.has(jobId)) return compute.subscribe(jobId, onEvent);
      return compute.subscribe(jobId, (event) => {
        try {
          onEvent(event);
        } finally {
          observe(jobId, event);
        }
      });
    },
    cancelJob: (jobId) => compute.cancel(jobId),
  };
}
