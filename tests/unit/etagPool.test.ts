import { combineDigests, computeDandiEtag, hashPart, type FilePart } from "@brain-bbqs/ember-client";
import { InterruptedError } from "@brain-bbqs/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHashPool,
  poolSize,
  type HashPool,
  type HashWorkerRequest,
  type HashWorkerResponse,
} from "../../src/lib/etagPool";

/**
 * Stands in for the real hashing Worker: it queues hash-part requests until the test drives them
 * to completion (with real digests via hashPart, so results are checkable against
 * computeDandiEtag), acks cancels immediately, and can be told to fail a part or fail to load.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  /** Every hash-part request any worker was handed, in order. */
  static requests: { blob: Blob; part: FilePart }[] = [];
  private listeners = new Map<string, (e: { data: HashWorkerResponse }) => void>();
  pending = new Map<number, { blob: Blob; part: FilePart }>();
  terminated = false;

  constructor(
    readonly url?: URL,
    readonly options?: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, cb: (e: { data: HashWorkerResponse }) => void): void {
    this.listeners.set(type, cb);
  }

  postMessage(msg: HashWorkerRequest): void {
    if (msg.type === "cancel") {
      this.pending.delete(msg.requestId);
      this.emit({ type: "cancelled", requestId: msg.requestId });
    } else {
      this.pending.set(msg.requestId, { blob: msg.blob, part: msg.part });
      FakeWorker.requests.push({ blob: msg.blob, part: msg.part });
    }
  }

  terminate(): void {
    this.terminated = true;
    this.pending.clear();
  }

  private emit(data: HashWorkerResponse): void {
    this.listeners.get("message")?.({ data });
  }

  /** Injects an arbitrary response, standing in for late or out-of-order worker messages. */
  emitRaw(data: HashWorkerResponse): void {
    this.emit(data);
  }

  /** What a worker whose script failed to load raises. */
  failToLoad(): void {
    this.listeners.get("error")?.({ data: undefined as unknown as HashWorkerResponse });
  }

  /** The requestId of the oldest pending part, for hand-crafting responses to it. */
  oldestRequestId(): number {
    const next = this.pending.keys().next();
    if (next.done) throw new Error("no pending part");
    return next.value;
  }

  /** Hashes the oldest pending part for real and reports progress, then done. */
  async completeNext(): Promise<boolean> {
    const next = this.pending.entries().next();
    if (next.done) return false;
    const [requestId, { blob, part }] = next.value;
    this.pending.delete(requestId);
    const digest = await hashPart(blob, part, (bytesDone) => this.emit({ type: "progress", requestId, bytesDone }));
    this.emit({ type: "done", requestId, digest });
    return true;
  }

  failNext(message: string): void {
    const requestId = this.oldestRequestId();
    this.pending.delete(requestId);
    this.emit({ type: "error", requestId, message });
  }

  static pendingCount(): number {
    return FakeWorker.instances.reduce((n, w) => n + w.pending.size, 0);
  }
}

/** Acks a cancel only when the test flushes it, as a real worker does after its current chunk. */
class LateCancelWorker extends FakeWorker {
  private acks: number[] = [];

  postMessage(msg: HashWorkerRequest): void {
    if (msg.type !== "cancel") return super.postMessage(msg);
    this.pending.delete(msg.requestId);
    this.acks.push(msg.requestId);
  }

  flushCancels(): void {
    for (const requestId of this.acks.splice(0)) this.emitRaw({ type: "cancelled", requestId });
  }
}

const spawn = () => new FakeWorker() as unknown as Worker;

/** Keeps completing parts across all workers (the pool re-pumps on each completion) until idle. */
async function drain(): Promise<void> {
  for (;;) {
    let progressed = false;
    for (const worker of FakeWorker.instances) {
      while (await worker.completeNext()) progressed = true;
    }
    if (!progressed) return;
  }
}

function makeBytes(size: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(size).map((_, i) => (i * 7) % 256);
}

function makeBlob(size: number): Blob {
  return new Blob([makeBytes(size)]);
}

/** A blob that records the offset of every read, to show which parts were hashed and how often. */
class CountingBlob extends Blob {
  readonly reads: number[] = [];

  constructor(size: number) {
    super([makeBytes(size)]);
  }

  override slice(start?: number, end?: number, contentType?: string): Blob {
    this.reads.push(start ?? 0);
    return super.slice(start, end, contentType);
  }
}

/** A blob whose reads wait until the test opens them, so the test can act while one is under way. */
function gatedBlob(size: number): { blob: Blob; reads: number[]; open: () => void } {
  const bytes = makeBytes(size);
  const reads: number[] = [];
  let open = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const slice = (start = 0, end = size) => {
    reads.push(start);
    return {
      arrayBuffer: async () => {
        await gate;
        return bytes.slice(start, end).buffer;
      },
    };
  };
  return { blob: { size, slice } as unknown as Blob, reads, open };
}

function makeParts(sizes: number[]): FilePart[] {
  let offset = 0;
  return sizes.map((size, i) => {
    const part = { number: i + 1, offset, size };
    offset += size;
    return part;
  });
}

/** The main-thread reference the pool must reproduce. */
const oracle = (blob: Blob, parts: FilePart[]) => computeDandiEtag(blob, parts);

let pool: HashPool | undefined;

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.requests = [];
});

afterEach(() => {
  pool?.dispose();
  pool = undefined;
  vi.unstubAllGlobals();
});

describe("poolSize", () => {
  it.each([
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 2],
    [5, 4],
    [64, 4],
  ])("gives %i cores %i workers", (cores, size) => {
    expect(poolSize(cores)).toBe(size);
  });
});

describe("createHashPool", () => {
  it("fans a blob's parts out across workers, queueing the rest, and matches computeDandiEtag", async () => {
    const blob = makeBlob(300);
    const parts = makeParts([100, 100, 100]);
    pool = createHashPool({ size: 2, spawn });
    const fractions: number[] = [];

    const promise = pool.hash(blob, parts, (f) => fractions.push(f));
    expect(FakeWorker.instances.map((w) => [...w.pending.values()].map((p) => p.part.number))).toEqual([[1], [2]]);
    await drain();

    expect(await promise).toBe(await oracle(blob, parts));
    expect(FakeWorker.instances.length).toBe(2);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions.every((f, i) => i === 0 || f >= fractions[i - 1])).toBe(true);
  });

  it("adds up the progress of parts hashing at the same time", async () => {
    const blob = makeBlob(200);
    pool = createHashPool({ size: 2, spawn });
    const fractions: number[] = [];

    // Left running; dispose rejects it after the test.
    pool.hash(blob, makeParts([100, 100]), (f) => fractions.push(f)).catch(() => {});
    const [a, b] = FakeWorker.instances;
    a.emitRaw({ type: "progress", requestId: a.oldestRequestId(), bytesDone: 40 });
    b.emitRaw({ type: "progress", requestId: b.oldestRequestId(), bytesDone: 30 });
    a.emitRaw({ type: "progress", requestId: a.oldestRequestId(), bytesDone: 70 });
    // A part finishing credits only the bytes its progress had not reported yet.
    a.emitRaw({ type: "done", requestId: a.oldestRequestId(), digest: new Uint8Array(16) });

    expect(fractions).toEqual([0.2, 0.35, 0.5, 0.65]);
  });

  it("never spawns more workers than the pool size, sharing them round-robin between blobs", async () => {
    const blobA = makeBlob(200);
    const blobB = makeBlob(120);
    const partsA = makeParts([100, 100]);
    const partsB = makeParts([60, 60]);
    pool = createHashPool({ size: 1, spawn });

    const a = pool.hash(blobA, partsA, () => {});
    const b = pool.hash(blobB, partsB, () => {});
    await drain();

    expect(FakeWorker.instances.length).toBe(1);
    expect(FakeWorker.requests.map((r) => `${r.blob === blobA ? "A" : "B"}${r.part.number}`)).toEqual([
      "A1",
      "B1",
      "A2",
      "B2",
    ]);
    expect(await a).toBe(await oracle(blobA, partsA));
    expect(await b).toBe(await oracle(blobB, partsB));
  });

  it("skips fully claimed blobs when cycling the round-robin queue", async () => {
    const blobA = makeBlob(100);
    const blobB = makeBlob(200);
    const partsA = makeParts([100]);
    const partsB = makeParts([100, 100]);
    pool = createHashPool({ size: 3, spawn });

    // A's lone part is claimed first; handing out B's two parts then has to cycle past A.
    const a = pool.hash(blobA, partsA);
    const b = pool.hash(blobB, partsB);
    expect(FakeWorker.pendingCount()).toBe(3);
    await drain();

    expect(await a).toBe(await oracle(blobA, partsA));
    expect(await b).toBe(await oracle(blobB, partsB));
  });

  it("starts one worker per core but one, by default", async () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 3 });
    pool = createHashPool({ spawn });
    void pool.hash(makeBlob(400), makeParts([100, 100, 100, 100]));
    expect(FakeWorker.instances.length).toBe(2);
    await drain();
  });

  it("resolves the etag of no parts without asking a worker", async () => {
    const blob = makeBlob(10);
    pool = createHashPool({ size: 1, spawn });
    expect(await pool.hash(blob, [])).toBe(combineDigests(new Uint8Array(0), 0));
    expect(await pool.hash(blob, [])).toBe(await oracle(blob, []));
    expect(FakeWorker.instances.length).toBe(0);
  });

  it("rejects the whole blob when a worker reports an error, cancelling its other parts", async () => {
    pool = createHashPool({ size: 2, spawn });

    const settled = pool.hash(makeBlob(200), makeParts([100, 100])).catch((e: unknown) => e);
    FakeWorker.instances[0].failNext("worker exploded");

    expect(await settled).toEqual(new Error("worker exploded"));
    expect(FakeWorker.pendingCount()).toBe(0);
  });

  it("rejects without starting a worker when the signal has already fired", async () => {
    pool = createHashPool({ size: 1, spawn });
    const controller = new AbortController();
    controller.abort();

    await expect(pool.hash(makeBlob(10), makeParts([10]), undefined, controller.signal)).rejects.toBeInstanceOf(
      InterruptedError,
    );
    expect(FakeWorker.instances.length).toBe(0);
  });

  it("cancels the in-flight parts when the signal fires mid-hash", async () => {
    pool = createHashPool({ size: 2, spawn });
    const controller = new AbortController();

    const settled = pool
      .hash(makeBlob(200), makeParts([100, 100]), undefined, controller.signal)
      .catch((e: unknown) => e);
    expect(FakeWorker.pendingCount()).toBe(2);
    controller.abort();

    expect(await settled).toBeInstanceOf(InterruptedError);
    expect(FakeWorker.pendingCount()).toBe(0);
  });

  it("leaves another blob's in-flight parts alone when one is cancelled", async () => {
    const blobA = makeBlob(100);
    const partsA = makeParts([100]);
    pool = createHashPool({ size: 2, spawn });
    const controller = new AbortController();

    const a = pool.hash(blobA, partsA);
    const b = pool.hash(makeBlob(50), makeParts([50]), undefined, controller.signal).catch((e: unknown) => e);
    expect(FakeWorker.pendingCount()).toBe(2);
    controller.abort();

    expect(await b).toBeInstanceOf(InterruptedError);
    expect(FakeWorker.pendingCount()).toBe(1);
    await drain();
    expect(await a).toBe(await oracle(blobA, partsA));
  });

  it.each<[string, (worker: LateCancelWorker, controller: AbortController) => void]>([
    ["cancelled", (_, controller) => controller.abort()],
    ["failed", (worker) => worker.failNext("worker exploded")],
  ])("hands none of a %s blob's remaining parts to the worker it frees", async (_, stop) => {
    const blob = makeBlob(300);
    pool = createHashPool({ size: 1, spawn: () => new LateCancelWorker() as unknown as Worker });
    const controller = new AbortController();

    const settled = pool.hash(blob, makeParts([100, 100, 100]), undefined, controller.signal).catch(() => {});
    const worker = FakeWorker.instances[0] as LateCancelWorker;
    stop(worker, controller);
    worker.flushCancels();
    await settled;

    expect(FakeWorker.requests.filter((r) => r.blob === blob).map((r) => r.part.number)).toEqual([1]);
    // The freed worker takes the next blob instead.
    const other = makeBlob(50);
    const otherParts = makeParts([50]);
    const next = pool.hash(other, otherParts);
    await drain();
    expect(await next).toBe(await oracle(other, otherParts));
    expect(FakeWorker.instances.length).toBe(1);
  });

  it.each<[string, (requestId: number) => HashWorkerResponse]>([
    ["a part's progress", (requestId) => ({ type: "progress", requestId, bytesDone: 50 })],
    ["a finished part", (requestId) => ({ type: "done", requestId, digest: new Uint8Array(16) })],
  ])("rejects with the error the progress callback throws on %s, and frees the worker", async (_, response) => {
    const blob = makeBlob(100);
    const parts = makeParts([100]);
    const boom = new Error("callback failed");
    const throwing = () => {
      throw boom;
    };
    pool = createHashPool({ size: 1, spawn });

    const settled = pool.hash(blob, parts, throwing).catch((e: unknown) => e);
    const [worker] = FakeWorker.instances;
    worker.emitRaw(response(worker.oldestRequestId()));

    expect(await settled).toBe(boom);
    expect(await computeDandiEtag(blob, parts, throwing).catch((e: unknown) => e)).toBe(boom);
    const next = pool.hash(blob, parts);
    await drain();
    expect(await next).toBe(await oracle(blob, parts));
    expect(FakeWorker.instances.length).toBe(1);
  });

  it("drops a worker that a progress callback's dispose stopped, starting a fresh one next time", async () => {
    const blob = makeBlob(100);
    const parts = makeParts([100]);
    pool = createHashPool({ size: 1, spawn });

    const settled = pool.hash(blob, parts, () => pool?.dispose()).catch((e: unknown) => e);
    const [first] = FakeWorker.instances;
    first.emitRaw({ type: "done", requestId: first.oldestRequestId(), digest: new Uint8Array(16) });

    expect(await settled).toEqual(new InterruptedError("Hashing stopped."));
    const next = pool.hash(blob, parts);
    expect(first.terminated).toBe(true);
    expect(FakeWorker.instances.length).toBe(2);
    await drain();
    expect(await next).toBe(await oracle(blob, parts));
  });

  it("drops progress that lands after the hash settled but before the worker acked the cancel", async () => {
    // A worker whose cancel acks never arrive, so the in-flight entry outlives the settle.
    class QuietCancelWorker extends FakeWorker {
      postMessage(msg: HashWorkerRequest): void {
        if (msg.type !== "cancel") super.postMessage(msg);
      }
    }
    pool = createHashPool({ size: 1, spawn: () => new QuietCancelWorker() as unknown as Worker });
    const controller = new AbortController();
    const fractions: number[] = [];

    const settled = pool
      .hash(makeBlob(100), makeParts([100]), (f) => fractions.push(f), controller.signal)
      .catch((e: unknown) => e);
    const worker = FakeWorker.instances[0];
    const requestId = worker.oldestRequestId();
    controller.abort();
    worker.emitRaw({ type: "progress", requestId, bytesDone: 50 });

    expect(await settled).toBeInstanceOf(InterruptedError);
    expect(fractions).toEqual([]);
  });

  it("ignores worker messages for requests it no longer tracks", async () => {
    const blob = makeBlob(100);
    const parts = makeParts([100]);
    pool = createHashPool({ size: 1, spawn });

    const promise = pool.hash(blob, parts);
    const worker = FakeWorker.instances[0];
    worker.emitRaw({ type: "progress", requestId: 999, bytesDone: 10 });
    worker.emitRaw({ type: "done", requestId: 999, digest: new Uint8Array(16) });
    await drain();

    expect(await promise).toBe(await oracle(blob, parts));
  });

  it("ignores an unsolicited 'cancelled' for a live request without settling the hash", async () => {
    pool = createHashPool({ size: 1, spawn });

    const outcome = pool.hash(makeBlob(100), makeParts([100])).then(
      () => "settled",
      () => "rejected",
    );
    const worker = FakeWorker.instances[0];
    worker.emitRaw({ type: "cancelled", requestId: worker.oldestRequestId() });
    // The pool dropped its tracking entry, so the eventual real completion is ignored too and
    // the hash simply never settles; nothing crashes and no wrong result is produced.
    await drain();

    expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
  });

  it("stops its workers and rejects running hashes on dispose, starting fresh ones afterwards", async () => {
    const blob = makeBlob(100);
    const parts = makeParts([100]);
    pool = createHashPool({ size: 1, spawn });

    const settled = pool.hash(blob, parts).catch((e: unknown) => e);
    const first = FakeWorker.instances[0];
    pool.dispose();

    expect(await settled).toEqual(new InterruptedError("Hashing stopped."));
    expect(first.terminated).toBe(true);
    const again = pool.hash(blob, parts);
    expect(FakeWorker.instances.length).toBe(2);
    await drain();
    expect(await again).toBe(await oracle(blob, parts));
  });

  it("moves only the unfinished parts to the main thread when a worker fails to load", async () => {
    const blob = new CountingBlob(210);
    const parts = makeParts([100, 10, 100]);
    pool = createHashPool({ size: 2, spawn });
    const fractions: number[] = [];

    const running = pool.hash(blob, parts, (f) => fractions.push(f));
    const [healthy, broken] = FakeWorker.instances;
    // Part 1 finishes, and the healthy worker is 90 bytes into part 3 when the other one fails.
    await healthy.completeNext();
    healthy.emitRaw({ type: "progress", requestId: healthy.oldestRequestId(), bytesDone: 90 });
    blob.reads.length = 0;
    broken.failToLoad();
    healthy.failToLoad(); // a later failure finds the hash already moved

    const etag = await running;
    expect(blob.reads).toEqual([100, 110]);
    expect(etag).toBe(await oracle(blob, parts));
    // Redoing part 3 from its start reports nothing until it passes what was already shown.
    expect(fractions).toEqual([100 / 210, 100 / 210, 190 / 210, 1]);
    expect([healthy.terminated, broken.terminated]).toEqual([true, true]);
    expect(await pool.hash(blob, parts)).toBe(await oracle(blob, parts));
    expect(FakeWorker.instances.length).toBe(2);
  });

  it("moves every blob to the main thread when a worker cannot even be started", async () => {
    const blobA = makeBlob(100);
    const partsA = makeParts([100]);
    const blobB = makeBlob(300);
    const partsB = makeParts([100, 100, 100]);
    let spawned = 0;
    pool = createHashPool({
      size: 3,
      spawn: () => {
        if (spawned++ === 2) throw new DOMException("blocked", "SecurityError");
        return new FakeWorker() as unknown as Worker;
      },
    });

    // A's part and B's first part reach a worker; starting a third worker for B's second part throws.
    const a = pool.hash(blobA, partsA);
    const b = pool.hash(blobB, partsB);

    expect(await a).toBe(await oracle(blobA, partsA));
    expect(await b).toBe(await oracle(blobB, partsB));
    expect(FakeWorker.requests.length).toBe(2);
    expect(FakeWorker.instances.map((w) => w.terminated)).toEqual([true, true]);
    expect(spawned).toBe(3);
  });

  it.each<[string, () => HashPool, () => void]>([
    [
      "where there are no workers",
      () => {
        vi.stubGlobal("Worker", undefined);
        return createHashPool();
      },
      () => {},
    ],
    [
      "once a worker has failed to load",
      () => createHashPool({ size: 1, spawn }),
      () => FakeWorker.instances[0].failToLoad(),
    ],
  ])("rejects a hash running on the main thread on dispose, %s", async (_, create, moveToMainThread) => {
    const { blob, reads, open } = gatedBlob(200);
    pool = create();
    const fractions: number[] = [];

    const settled = pool.hash(blob, makeParts([100, 100]), (f) => fractions.push(f)).catch((e: unknown) => e);
    moveToMainThread();
    pool.dispose();
    open();

    expect(await settled).toEqual(new InterruptedError("Hashing stopped."));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The read under way when it stopped lands, but reports nothing and is the last one.
    expect(fractions).toEqual([]);
    expect(reads).toEqual([0]);
  });

  it("starts module workers on the bundled etag.worker script", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const blob = makeBlob(100);
    const parts = makeParts([100]);
    pool = createHashPool({ size: 1 });

    const promise = pool.hash(blob, parts);
    const [worker] = FakeWorker.instances;
    expect(worker.url?.pathname).toMatch(/\/src\/workers\/etag\.worker\.ts$/);
    expect(worker.options).toEqual({ type: "module" });
    await drain();
    expect(await promise).toBe(await oracle(blob, parts));
  });

  it("hashes on the main thread where there are no workers", async () => {
    vi.stubGlobal("Worker", undefined);
    const blob = makeBlob(300);
    const parts = makeParts([100, 100, 100]);
    pool = createHashPool();
    const fractions: number[] = [];

    expect(await pool.hash(blob, parts, (f) => fractions.push(f))).toBe(await oracle(blob, parts));
    expect(fractions).toEqual([1 / 3, 2 / 3, 1]);
    expect(FakeWorker.instances.length).toBe(0);
  });
});
