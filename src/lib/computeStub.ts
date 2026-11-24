import { entitiesFromPath, modelFolderPath, predictionsPath } from "./bidsDerivatives";
import { filesByFolder, isModelHead, type HostModelCard, type ModelSource } from "./modelCatalogue";
import { emberModelId, emberModelLocation } from "./modelEmber";
import type { JobEvent, ModelFile, TrackJobSpec, TrainJobSpec } from "./sleapContract";
import {
  INLINE_LABELS_REFUSED,
  isTerminalEvent,
  TRAIN_NEEDS_LABELS,
  type ClearTimer,
  type ComputeClient,
  type JobRequest,
  type SetTimer,
} from "./computeClient";

export interface StubComputeOptions {
  /** Time between one scripted event and the next. */
  tickMs?: number;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
}

/** The stub's compute, and the models its training jobs made, as a source for the model picker. */
export interface StubCompute extends ComputeClient {
  models: ModelSource;
}

type ScriptedEvent = Pick<JobEvent, "topic" | "data"> & {
  /** A trained model's card, listed from the moment its job.result is reported. */
  trained?: HostModelCard;
};

interface StubJob {
  id: string;
  history: JobEvent[];
  pending: ScriptedEvent[];
  listeners: Set<(event: JobEvent) => void>;
  timer: unknown;
  finished: boolean;
}

const DEFAULT_EPOCHS = 3;

const status = (state: string, detail?: string): ScriptedEvent => ({
  topic: "job.status",
  data: detail === undefined ? { state } : { state, detail },
});
const log = (line: string): ScriptedEvent => ({ topic: "job.log", data: { line, progress: false } });

/** A line per input, and an indented one after it naming the EMBER asset a worker would renew it from. */
function inputLogs(request: JobRequest): ScriptedEvent[] {
  return request.inputs.flatMap(({ name, fileType, archive }) => {
    const line = log(`Input: ${name} (${fileType})`);
    if (!archive) return [line];
    const { dandisetId, path, assetId, downloadUrl } = archive;
    return [line, log(`  from EMBER dandiset ${dandisetId}: ${path}, asset ${assetId} (${downloadUrl})`)];
  });
}

const round = (value: number) => Math.round(value * 1e4) / 1e4;

function trainScript(request: JobRequest, spec: TrainJobSpec, jobNumber: number): ScriptedEvent[] {
  // The host saves inline labels to EMBER and refuses a spec with none before submitting; the stub
  // refuses both too, as the proxy would.
  if (spec.labels_content) return [status("failed", INLINE_LABELS_REFUSED)];
  if (!spec.labels_path) return [status("failed", TRAIN_NEEDS_LABELS)];
  const epochs = spec.max_epochs ?? DEFAULT_EPOCHS;
  const events: ScriptedEvent[] = [status("queued"), status("running"), ...inputLogs(request)];
  let trainLoss = 0;
  let valLoss = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    trainLoss = round(1 / (epoch + 1));
    valLoss = round(1.2 / (epoch + 1));
    events.push(
      { topic: "job.epoch", data: { epoch, train_loss: trainLoss, val_loss: valLoss } },
      log(`Epoch ${epoch + 1}/${epochs}: train loss ${trainLoss}, val loss ${valLoss}`),
    );
  }
  const modelId = `stub-model-${jobNumber}`;
  events.push(
    {
      topic: "job.metric",
      data: {
        epoch: epochs - 1,
        total_epochs: epochs,
        latest_train_loss: trainLoss,
        latest_val_loss: valLoss,
        best_loss: valLoss,
      },
    },
    {
      topic: "job.result",
      data: trainResult(request, spec.labels_path, modelId),
      trained: trainedCard(request, spec, modelId),
    },
    status("completed"),
  );
  return events;
}

/**
 * Upstream reads `model_dir` as a `model_paths` entry for a follow-up track job and `labels_path` as
 * that job's `data_path`, so `model_dir` is the card id the EMBER model source gives the folder.
 * Without a dandiset there is no such id, and upstream then skips post-training inference itself.
 */
function trainResult(request: JobRequest, labelsPath: string, modelId: string): Record<string, unknown> {
  const modelDir = request.project ? { model_dir: emberModelId(request.project.dandisetId, modelId) } : {};
  return { model_id: modelId, ...modelDir, model_path: modelFolderPath(modelId), labels_path: labelsPath };
}

/**
 * The card the EMBER model source would give the trained model's folder once the proxy has written
 * it, so a follow-up track job can name `model_dir` here too: one model folder, or a subfolder per
 * head when the job trained several, as top-down's centroid and centered_instance. The stub writes
 * nothing, so the files are references a worker would resolve, never fetched in the page.
 */
function trainedCard(request: JobRequest, spec: TrainJobSpec, modelId: string): HostModelCard | undefined {
  if (!request.project) return undefined;
  const { dandisetId } = request.project;
  const heads = spec.model_types.filter(isModelHead);
  const files = (heads.length > 1 ? heads : [""]).flatMap((folder): ModelFile[] => {
    const base = `ember://${dandisetId}/${modelFolderPath(modelId)}${folder ? `${folder}/` : ""}`;
    return [
      { role: "config", folder, url: `${base}training_config.yaml` },
      { role: "checkpoint", folder, url: `${base}best.ckpt` },
    ];
  });
  return {
    id: emberModelId(dandisetId, modelId),
    name: `${modelId} (trained here on the stub)`,
    heads,
    files,
    source: emberModelLocation(dandisetId, modelId),
  };
}

/**
 * A line per model (with the DeepLabCut model it names, for one DeepLabCut runs), and an indented
 * one per model folder a worker would download, naming its files.
 */
function modelLogs(request: JobRequest, spec: TrackJobSpec): ScriptedEvent[] {
  return spec.model_paths.flatMap((id) => {
    const model = request.models.find((m) => m.id === id);
    const files = model?.files ?? [];
    const dlc = model?.deeplabcut;
    const runs = dlc ? ` (DeepLabCut ${dlc.superanimal}: ${dlc.model}, detector ${dlc.detector})` : "";
    const folders = [...filesByFolder(files)].map(([folder, held]) => {
      const named = held.map((file) => `${file.role} ${file.url}`).join("; ");
      return log(`  model folder ${folder || "(top level)"}: ${named}`);
    });
    return [log(`Model: ${id}${runs}`), ...folders];
  });
}

function trackScript(request: JobRequest, spec: TrackJobSpec): ScriptedEvent[] {
  const projectPath = request.project?.path;
  // Named after the project when it gives the subject, so its predictions sit beside its labels.
  const named = projectPath && entitiesFromPath(projectPath) ? projectPath : null;
  const predictions: string[] = [];
  for (const input of request.inputs) {
    const source = named ?? input.name;
    const entities = entitiesFromPath(source);
    if (!entities) {
      const why =
        "neither the project's path nor the input's name gives its subject, and any session it names, " +
        "as BIDS labels (letters and digits only)";
      return [status("failed", `Cannot place the predictions for ${input.name}: ${why}.`)];
    }
    predictions.push(predictionsPath(source, entities));
  }
  return [
    status("queued"),
    status("running"),
    ...inputLogs(request),
    ...modelLogs(request, spec),
    { topic: "job.result", data: { predictions } },
    status("completed"),
  ];
}

/**
 * Plays the central Pennsieve proxy in the browser until its job API exists: each job replays a
 * fixed script of upstream-shaped events, one per tick, so the job viewer can be built and tested
 * against something that behaves like a remote worker. Nothing leaves the page.
 */
export function createStubCompute({
  tickMs = 600,
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: StubComputeOptions = {}): StubCompute {
  const jobs = new Map<string, StubJob>();
  const trained: HostModelCard[] = [];
  let jobCount = 0;

  // A subscriber's bug must not stall the job, as with the proxy client: the others still hear it.
  function deliver(job: StubJob, listener: (event: JobEvent) => void, event: JobEvent): void {
    try {
      listener(event);
    } catch (error) {
      console.error(`A subscriber to job ${job.id} threw on event ${event.seq}:`, error);
    }
  }

  function emit(job: StubJob, { trained: card, ...scripted }: ScriptedEvent): void {
    const event: JobEvent = { ...scripted, seq: job.history.length + 1, jobId: job.id };
    job.history.push(event);
    if (card) trained.push(card);
    if (isTerminalEvent(event)) job.finished = true;
    for (const listener of job.listeners) deliver(job, listener, event);
  }

  function tick(job: StubJob): void {
    job.timer = null;
    const next = job.pending.shift();
    if (!next) return;
    emit(job, next);
    if (job.pending.length > 0) job.timer = setTimer(() => tick(job), tickMs);
  }

  return {
    models: { name: "the compute stub", list: () => Promise.resolve([...trained]) },

    submit(request) {
      jobCount += 1;
      const spec = request.spec;
      const job: StubJob = {
        id: `stub-${jobCount}`,
        history: [],
        pending: spec.type === "train" ? trainScript(request, spec, jobCount) : trackScript(request, spec),
        listeners: new Set(),
        timer: null,
        finished: false,
      };
      jobs.set(job.id, job);
      job.timer = setTimer(() => tick(job), tickMs);
      return Promise.resolve({ jobId: job.id });
    },

    subscribe(jobId, onEvent) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`Unknown job: ${jobId}`);
      for (const event of job.history) deliver(job, onEvent, event);
      job.listeners.add(onEvent);
      return () => {
        job.listeners.delete(onEvent);
      };
    },

    cancel(jobId) {
      const job = jobs.get(jobId);
      if (!job) return Promise.reject(new Error(`Unknown job: ${jobId}`));
      if (job.finished) return Promise.resolve();
      // An unfinished job always has its next tick scheduled.
      clearTimer(job.timer);
      job.timer = null;
      job.pending = [];
      emit(job, status("canceled", "Canceled by user"));
      return Promise.resolve();
    },
  };
}
