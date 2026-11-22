// The dandi-etag worker pool, copied from bbqs-uploader's `lib/etag-worker.ts`
// (brain-bbqs/bbqs-uploader@c8bd4e9) without its checksum cache: this page hashes a Blob the app
// hands it, which has no stable identity to cache digests by. This app is the second one carrying
// the pool, which makes it a candidate for @brain-bbqs/ember-client.
import { combineDigests, hashPart, type computeDandiEtag, type FilePart } from "@brain-bbqs/ember-client";
import { InterruptedError } from "@brain-bbqs/utils";

export type HashWorkerRequest =
  { type: "hash-part"; requestId: number; blob: Blob; part: FilePart } | { type: "cancel"; requestId: number };

export type HashWorkerResponse =
  | { type: "progress"; requestId: number; bytesDone: number }
  | { type: "done"; requestId: number; digest: Uint8Array }
  | { type: "error"; requestId: number; message: string }
  | { type: "cancelled"; requestId: number };

/** What a save hashes with: `computeDandiEtag` itself, or a pool's `hash`, which takes the same arguments. */
export type EtagHasher = typeof computeDandiEtag;

export interface HashPool {
  hash: EtagHasher;
  /**
   * Stops every worker and rejects every hash still running with InterruptedError. A later hash
   * starts new workers, unless one has failed to start: every hash after that runs on the main thread.
   */
  dispose: () => void;
}

export interface HashPoolOptions {
  /** The most workers to run at once; {@link poolSize} of the machine's cores by default. */
  size?: number;
  /**
   * Starts one worker (tests pass a fake). Left out where `Worker` does not exist, the pool hashes
   * on the main thread.
   */
  spawn?: () => Worker;
}

/**
 * A few workers, leaving a core for the page: a project of a few hundred MB has only a handful of
 * 64 MB parts to share out, and each worker holds a 16 MB read buffer while it hashes.
 */
export function poolSize(cores: number): number {
  return Math.min(4, Math.max(1, (cores || 2) - 1));
}

/** A blob being hashed: which of its parts are claimed and done, and the promise's settle hooks. */
interface HashJob {
  blob: Blob;
  parts: FilePart[];
  total: number;
  nextQueued: number;
  partDigests: Uint8Array;
  partsDone: number;
  bytesDone: number;
  /** The highest fraction passed to onProgress so far. */
  shown: number;
  onProgress: (fraction: number) => void;
  settled: boolean;
  resolve: (etag: string) => void;
  reject: (err: unknown) => void;
  removeAbortListener: () => void;
  /** Stops the job's main-thread hashing, once it has moved there. */
  stopLocal: () => void;
}

interface InFlightPart {
  job: HashJob;
  part: FilePart;
  worker: Worker;
  /** Bytes already credited to the job from this part's progress messages. */
  lastBytes: number;
}

function spawnModuleWorker(): Worker {
  return new Worker(new URL("../workers/etag.worker.ts", import.meta.url), { type: "module" });
}

/**
 * A pool of stateless part-hashing workers shared by every blob being hashed. Parts are independent
 * (the etag is an md5 of the part md5s), so one large blob's parts fan out across the whole pool
 * instead of serializing on one worker. With several blobs queued, parts are handed out round-robin,
 * so a new blob gets its first part hashed as soon as any worker frees up. Workers are spawned
 * lazily, never more than `size` of them, and reused. Where there are no workers, or once one fails
 * to start, hashing moves to the main thread, keeping the parts workers already finished.
 */
export function createHashPool(options: HashPoolOptions = {}): HashPool {
  const { spawn: spawnWorker = spawnModuleWorker, size = poolSize(navigator.hardwareConcurrency) } = options;
  const workers: Worker[] = [];
  const idle: Worker[] = [];
  const inFlight = new Map<number, InFlightPart>();
  // Unsettled jobs, in insertion order; pump cycles over this list starting at rrIndex.
  const jobs: HashJob[] = [];
  let rrIndex = 0;
  let nextRequestId = 0;
  let onMainThread = !options.spawn && typeof Worker === "undefined";

  function spawn(): Worker {
    const worker = spawnWorker();
    worker.addEventListener("message", (e: MessageEvent<HashWorkerResponse>) => onResponse(worker, e.data));
    // A worker whose script cannot load (gone after a redeploy, say) never answers, which would
    // leave the save waiting for good.
    worker.addEventListener("error", fallBackToMainThread);
    return worker;
  }

  /** The index of the next job with a part still to hand out, counting on from rrIndex, or -1. */
  function nextQueuedJob(): number {
    for (let i = 0; i < jobs.length; i++) {
      const index = (rrIndex + i) % jobs.length;
      if (jobs[index].nextQueued < jobs[index].parts.length) return index;
    }
    return -1;
  }

  function takeWorker(): Worker | null {
    const existing = idle.pop();
    if (existing) return existing;
    if (workers.length === size) return null;
    let worker: Worker;
    try {
      worker = spawn();
    } catch {
      // Refused outright, as a script on another origin is.
      fallBackToMainThread();
      return null;
    }
    workers.push(worker);
    return worker;
  }

  /** Hands queued parts to idle (or newly spawned) workers until one of the two runs out. */
  function pump(): void {
    for (;;) {
      const index = nextQueuedJob();
      if (index === -1) return;
      const worker = takeWorker();
      if (!worker) return;
      rrIndex = index + 1;
      const job = jobs[index];
      const part = job.parts[job.nextQueued++];
      const requestId = nextRequestId++;
      inFlight.set(requestId, { job, part, worker, lastBytes: 0 });
      worker.postMessage({ type: "hash-part", requestId, blob: job.blob, part } satisfies HashWorkerRequest);
    }
  }

  /** Takes a job out of the pool for good, dropping its unclaimed parts; false if it already was. */
  function release(job: HashJob): boolean {
    if (job.settled) return false;
    job.settled = true;
    job.nextQueued = job.parts.length;
    jobs.splice(jobs.indexOf(job), 1);
    job.removeAbortListener();
    job.stopLocal();
    // Interrupt the job's in-flight parts so their workers free up promptly; each worker acks with
    // "cancelled" (or a harmless late "done") and rejoins the idle set via onResponse.
    for (const [requestId, entry] of inFlight) {
      if (entry.job === job) entry.worker.postMessage({ type: "cancel", requestId } satisfies HashWorkerRequest);
    }
    return true;
  }

  function finish(job: HashJob): void {
    if (release(job)) job.resolve(combineDigests(job.partDigests, job.parts.length));
  }

  function fail(job: HashJob, error: unknown): void {
    if (release(job)) job.reject(error);
  }

  /** Passes progress on, never below what was already shown; a callback that throws fails the hash. */
  function report(job: HashJob, bytes: number): void {
    const fraction = bytes / job.total;
    // A part still running when its hash settled can report once more before it stops.
    if (job.settled || fraction < job.shown) return;
    job.shown = fraction;
    try {
      job.onProgress(fraction);
    } catch (err) {
      fail(job, err);
    }
  }

  function stopWorkers(): void {
    for (const worker of workers) worker.terminate();
    workers.length = 0;
    idle.length = 0;
    inFlight.clear();
  }

  /** Hashes `parts` of a job one after another on the main thread, then settles it. */
  async function hashHere(job: HashJob, parts: FilePart[]): Promise<void> {
    const local = new AbortController();
    job.stopLocal = () => local.abort();
    try {
      for (const part of parts) {
        const digest = await hashPart(job.blob, part, (read) => report(job, job.bytesDone + read), local.signal);
        job.partDigests.set(digest, (part.number - 1) * 16);
        job.bytesDone += part.size;
      }
      finish(job);
    } catch (err) {
      fail(job, err);
    }
  }

  /** Moves every running hash to the main thread for good, keeping the parts already finished. */
  function fallBackToMainThread(): void {
    if (onMainThread) return;
    onMainThread = true;
    const running = [...inFlight.values()];
    stopWorkers();
    for (const job of [...jobs]) {
      const unfinished = job.parts.slice(job.nextQueued);
      for (const entry of running) {
        if (entry.job !== job) continue;
        unfinished.push(entry.part);
        job.bytesDone -= entry.lastBytes;
      }
      job.nextQueued = job.parts.length;
      unfinished.sort((a, b) => a.number - b.number);
      void hashHere(job, unfinished);
    }
  }

  function onResponse(worker: Worker, msg: HashWorkerResponse): void {
    const entry = inFlight.get(msg.requestId);
    if (!entry) return;
    const { job, part } = entry;
    if (msg.type === "progress") {
      job.bytesDone += msg.bytesDone - entry.lastBytes;
      entry.lastBytes = msg.bytesDone;
      report(job, job.bytesDone);
      return;
    }
    inFlight.delete(msg.requestId);
    // Idle again before any callback runs, so a callback that disposes the pool drops this worker too.
    idle.push(worker);
    if (!job.settled) {
      if (msg.type === "done") onPartDone(job, part, entry.lastBytes, msg.digest);
      else if (msg.type === "error") fail(job, new Error(msg.message));
      // "cancelled" for an unsettled job cannot happen (cancels are only sent on settle).
    }
    pump();
  }

  function onPartDone(job: HashJob, part: FilePart, lastBytes: number, digest: Uint8Array): void {
    job.partDigests.set(digest, (part.number - 1) * 16);
    job.bytesDone += part.size - lastBytes;
    job.partsDone++;
    report(job, job.bytesDone);
    if (job.partsDone === job.parts.length) finish(job);
  }

  return {
    hash(blob, parts, onProgress = () => {}, signal) {
      if (signal?.aborted) return Promise.reject(new InterruptedError());
      // No worker would ever answer for no parts; the etag of nothing is still well defined.
      if (parts.length === 0) return Promise.resolve(combineDigests(new Uint8Array(0), 0));
      return new Promise<string>((resolve, reject) => {
        const job: HashJob = {
          blob,
          parts,
          total: parts.reduce((sum, p) => sum + p.size, 0),
          nextQueued: 0,
          partDigests: new Uint8Array(parts.length * 16),
          partsDone: 0,
          bytesDone: 0,
          shown: 0,
          onProgress,
          settled: false,
          resolve,
          reject,
          removeAbortListener: () => {},
          stopLocal: () => {},
        };
        jobs.push(job);
        if (signal) {
          const onAbort = () => fail(job, new InterruptedError());
          job.removeAbortListener = () => signal.removeEventListener("abort", onAbort);
          signal.addEventListener("abort", onAbort, { once: true });
        }
        if (onMainThread) {
          job.nextQueued = parts.length;
          void hashHere(job, parts);
        } else {
          pump();
        }
      });
    },

    dispose() {
      // Stopped first, so failing the jobs below sends no cancels to workers that are gone.
      stopWorkers();
      for (const job of [...jobs]) fail(job, new InterruptedError("Hashing stopped."));
    },
  };
}
