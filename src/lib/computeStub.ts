import type { JobEvent, TrackJobSpec, TrainJobSpec } from "./sleapContract";
import { isTerminalEvent, type ClearTimer, type ComputeClient, type JobRequest, type SetTimer } from "./computeClient";

export interface StubComputeOptions {
  /** Time between one scripted event and the next. */
  tickMs?: number;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
}

type ScriptedEvent = Pick<JobEvent, "topic" | "data">;

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

function inputLogs(request: JobRequest): ScriptedEvent[] {
  return request.inputs.map((input) => log(`Input: ${input.name} (${input.fileType})`));
}

const round = (value: number) => Math.round(value * 1e4) / 1e4;

function trainScript(request: JobRequest, spec: TrainJobSpec, jobNumber: number): ScriptedEvent[] {
  if (!spec.labels_path) {
    return [
      status(
        "failed",
        "This host trains from a project saved on EMBER (labels_path), not from inline labels: save the project to EMBER first.",
      ),
    ];
  }
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
    { topic: "job.result", data: { model_id: modelId, model_dir: `derivatives/sleap/models/${modelId}/` } },
    status("completed"),
  );
  return events;
}

function trackScript(request: JobRequest, spec: TrackJobSpec): ScriptedEvent[] {
  return [
    status("queued"),
    status("running"),
    ...inputLogs(request),
    ...spec.model_paths.map((id) => log(`Model: ${id}`)),
    {
      topic: "job.result",
      data: {
        predictions: request.inputs.map((input) => `derivatives/sleap/predictions/${input.name}.predictions.slp`),
      },
    },
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
}: StubComputeOptions = {}): ComputeClient {
  const jobs = new Map<string, StubJob>();
  let jobCount = 0;

  function emit(job: StubJob, scripted: ScriptedEvent): void {
    const event: JobEvent = { ...scripted, seq: job.history.length + 1, jobId: job.id };
    job.history.push(event);
    if (isTerminalEvent(event)) job.finished = true;
    for (const listener of job.listeners) listener(event);
  }

  function tick(job: StubJob): void {
    job.timer = null;
    const next = job.pending.shift();
    if (!next) return;
    emit(job, next);
    if (job.pending.length > 0) job.timer = setTimer(() => tick(job), tickMs);
  }

  return {
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
      for (const event of job.history) onEvent(event);
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
