import { describe, expect, it, vi } from "vitest";
import type { JobRequest } from "../../src/lib/computeClient";
import { createStubCompute } from "../../src/lib/computeStub";
import type { JobEvent } from "../../src/lib/sleapContract";

const LABELS_URL = "https://s3.test/blobs/labels";
const VIDEO_URL = "https://s3.test/blobs/video";

const trainRequest = (maxEpochs?: number): JobRequest => ({
  spec: {
    type: "train",
    config_contents: ["model_config: {}"],
    model_types: ["single_instance"],
    labels_path: LABELS_URL,
    ...(maxEpochs === undefined ? {} : { max_epochs: maxEpochs }),
  },
  inputs: [{ url: LABELS_URL, fileType: "pkg.slp", name: "train.pkg.slp" }],
  models: [],
  project: { dandisetId: "000398", path: "sub-NONE/train.pkg.slp" },
});

const trackRequest: JobRequest = {
  spec: { type: "track", data_path: VIDEO_URL, model_paths: ["hf:lab/mice", "ember:000398/models/a"] },
  inputs: [{ url: VIDEO_URL, fileType: "mp4", name: "session1.mp4" }],
  models: [],
};

/** A stub whose ticks run only when the test fires them. */
function steppedStub() {
  const pending: { id: number; callback: () => void; ms: number }[] = [];
  let next = 1;
  const clearTimer = vi.fn((handle: unknown) => {
    const i = pending.findIndex((t) => t.id === handle);
    if (i >= 0) pending.splice(i, 1);
  });
  const stub = createStubCompute({
    tickMs: 5,
    setTimer: (callback, ms) => {
      const id = next++;
      pending.push({ id, callback, ms });
      return id;
    },
    clearTimer,
  });
  return {
    stub,
    pending,
    clearTimer,
    /** Fires ticks until nothing is scheduled. */
    drain() {
      for (let guard = 0; pending.length > 0 && guard < 1000; guard++) pending.shift()!.callback();
    },
    step() {
      pending.shift()!.callback();
    },
  };
}

const brief = (e: JobEvent) => [e.seq, e.topic, e.data] as const;

describe("createStubCompute", () => {
  it("scripts a training job, one event per tick, with upstream's data keys", async () => {
    const { stub, pending, drain } = steppedStub();
    const { jobId } = await stub.submit(trainRequest(2));
    const events: JobEvent[] = [];
    stub.subscribe(jobId, (e) => events.push(e));

    expect(jobId).toBe("stub-1");
    expect(pending[0].ms).toBe(5);
    drain();

    expect(events.map(brief)).toEqual([
      [1, "job.status", { state: "queued" }],
      [2, "job.status", { state: "running" }],
      [3, "job.log", { line: "Input: train.pkg.slp (pkg.slp)", progress: false }],
      [4, "job.epoch", { epoch: 0, train_loss: 1, val_loss: 1.2 }],
      [5, "job.log", { line: "Epoch 1/2: train loss 1, val loss 1.2", progress: false }],
      [6, "job.epoch", { epoch: 1, train_loss: 0.5, val_loss: 0.6 }],
      [7, "job.log", { line: "Epoch 2/2: train loss 0.5, val loss 0.6", progress: false }],
      [8, "job.metric", { epoch: 1, total_epochs: 2, latest_train_loss: 0.5, latest_val_loss: 0.6, best_loss: 0.6 }],
      [9, "job.result", { model_id: "stub-model-1", model_dir: "derivatives/sleap/models/stub-model-1/" }],
      [10, "job.status", { state: "completed" }],
    ]);
    expect(events.every((e) => e.jobId === "stub-1")).toBe(true);
  });

  it("trains for three epochs when the spec names none", async () => {
    const { stub, drain } = steppedStub();
    const { jobId } = await stub.submit(trainRequest());
    const epochs: unknown[] = [];
    stub.subscribe(jobId, (e) => {
      if (e.topic === "job.epoch") epochs.push(e.data.epoch);
    });
    drain();

    expect(epochs).toEqual([0, 1, 2]);
  });

  it("refuses a training job sent with inline labels instead of an EMBER project", async () => {
    const { stub, drain } = steppedStub();
    const request = trainRequest();
    request.spec = { type: "train", config_contents: [], model_types: [], labels_content: "AAAA" };
    const { jobId } = await stub.submit(request);
    const events: JobEvent[] = [];
    stub.subscribe(jobId, (e) => events.push(e));
    drain();

    expect(events.length).toBe(1);
    expect(events[0].topic).toBe("job.status");
    expect(events[0].data.state).toBe("failed");
    expect(events[0].data.detail).toMatch(/saved on EMBER \(labels_path\), not from inline labels/);
  });

  it("scripts an inference job, naming each input and model", async () => {
    const { stub, drain } = steppedStub();
    await stub.submit(trainRequest());
    const { jobId } = await stub.submit(trackRequest);
    const events: JobEvent[] = [];
    stub.subscribe(jobId, (e) => events.push(e));
    drain();

    expect(jobId).toBe("stub-2");
    expect(events.map(brief)).toEqual([
      [1, "job.status", { state: "queued" }],
      [2, "job.status", { state: "running" }],
      [3, "job.log", { line: "Input: session1.mp4 (mp4)", progress: false }],
      [4, "job.log", { line: "Model: hf:lab/mice", progress: false }],
      [5, "job.log", { line: "Model: ember:000398/models/a", progress: false }],
      [6, "job.result", { predictions: ["derivatives/sleap/predictions/session1.mp4.predictions.slp"] }],
      [7, "job.status", { state: "completed" }],
    ]);
  });

  it("replays history to a late subscriber, then delivers live events to every subscriber", async () => {
    const { stub, step } = steppedStub();
    const { jobId } = await stub.submit(trackRequest);
    step();
    step();
    const early: number[] = [];
    const late: number[] = [];
    stub.subscribe(jobId, (e) => early.push(e.seq));
    expect(early).toEqual([1, 2]);

    step();
    stub.subscribe(jobId, (e) => late.push(e.seq));
    step();

    expect(early).toEqual([1, 2, 3, 4]);
    expect(late).toEqual([1, 2, 3, 4]);
  });

  it("stops delivering to an unsubscribed listener", async () => {
    const { stub, step, drain } = steppedStub();
    const { jobId } = await stub.submit(trackRequest);
    const seen: number[] = [];
    const stop = stub.subscribe(jobId, (e) => seen.push(e.seq));
    step();
    stop();
    drain();

    expect(seen).toEqual([1]);
  });

  it("cancels a running job: stops its script and ends it as canceled", async () => {
    const { stub, pending, clearTimer, step } = steppedStub();
    const { jobId } = await stub.submit(trainRequest());
    const events: JobEvent[] = [];
    stub.subscribe(jobId, (e) => events.push(e));
    step();
    step();

    await stub.cancel(jobId);

    expect(clearTimer).toHaveBeenCalledTimes(1);
    expect(pending.length).toBe(0);
    expect(events.map(brief).at(-1)).toEqual([3, "job.status", { state: "canceled", detail: "Canceled by user" }]);
  });

  it("cancels a job that has not ticked yet", async () => {
    const { stub, pending } = steppedStub();
    const { jobId } = await stub.submit(trackRequest);
    const events: JobEvent[] = [];
    stub.subscribe(jobId, (e) => events.push(e));

    await stub.cancel(jobId);

    expect(pending.length).toBe(0);
    expect(events.map((e) => e.data.state)).toEqual(["canceled"]);
  });

  it("treats cancelling a finished job as a no-op", async () => {
    const { stub, drain } = steppedStub();
    const { jobId } = await stub.submit(trackRequest);
    drain();
    const events: JobEvent[] = [];
    stub.subscribe(jobId, (e) => events.push(e));

    await stub.cancel(jobId);
    await stub.cancel(jobId);

    expect(events.length).toBe(7);
    expect(events.at(-1)?.data.state).toBe("completed");
  });

  it("does nothing on a stray tick after the script has run out", async () => {
    const pending: (() => void)[] = [];
    const stub = createStubCompute({
      setTimer: (callback) => {
        pending.push(callback);
        return pending.length;
      },
      clearTimer: () => {},
    });
    const { jobId } = await stub.submit(trackRequest);
    const first = pending[0];
    while (pending.length > 0) pending.shift()!();
    const seen: number[] = [];
    stub.subscribe(jobId, (e) => seen.push(e.seq));

    first();

    expect(seen.length).toBe(7);
  });

  it("throws on subscribing to an unknown job", () => {
    const stub = createStubCompute();
    expect(() => stub.subscribe("stub-9", () => {})).toThrow("Unknown job: stub-9");
  });

  it("rejects cancelling an unknown job", async () => {
    await expect(createStubCompute().cancel("stub-9")).rejects.toThrow("Unknown job: stub-9");
  });

  it("runs on real timers by default", async () => {
    vi.useFakeTimers();
    try {
      const stub = createStubCompute({ tickMs: 10 });
      const { jobId } = await stub.submit(trackRequest);
      const states: unknown[] = [];
      stub.subscribe(jobId, (e) => {
        if (e.topic === "job.status") states.push(e.data.state);
      });
      await vi.advanceTimersByTimeAsync(20);
      expect(states).toEqual(["queued", "running"]);

      await stub.cancel(jobId);
      expect(vi.getTimerCount()).toBe(0);
      expect(states).toEqual(["queued", "running", "canceled"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
