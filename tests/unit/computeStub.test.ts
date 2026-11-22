import { describe, expect, it, vi } from "vitest";
import { TRAIN_NEEDS_SAVED_PROJECT, type JobRequest } from "../../src/lib/computeClient";
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
  project: { dandisetId: "000398", path: "sub-01/ses-02/beh/session1.slp" },
};

/** `request` sent for `project`, or for no project at all. */
function inProject(request: JobRequest, project?: JobRequest["project"]): JobRequest {
  const copy = { ...request };
  delete copy.project;
  return project ? { ...copy, project } : copy;
}

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
      [
        9,
        "job.result",
        {
          model_id: "stub-model-1",
          model_dir: "ember:000398/stub-model-1",
          model_path: "derivatives/sleap/models/stub-model-1/",
          labels_path: LABELS_URL,
        },
      ],
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

  it("leaves out the model card id when the job names no dandiset, still saying where and what it trained", async () => {
    const { stub, drain } = steppedStub();
    const { jobId } = await stub.submit(inProject(trainRequest(1)));
    const results: unknown[] = [];
    stub.subscribe(jobId, (e) => {
      if (e.topic === "job.result") results.push(e.data);
    });
    drain();

    expect(results).toEqual([
      { model_id: "stub-model-1", model_path: "derivatives/sleap/models/stub-model-1/", labels_path: LABELS_URL },
    ]);
  });

  it.each([
    ["inline labels instead of a saved project", { labels_content: "AAAA" }],
    ["inline labels beside a saved project", { labels_path: LABELS_URL, labels_content: "AAAA" }],
  ])("refuses a training job sent with %s, as the proxy would", async (_label, labels) => {
    const { stub, drain } = steppedStub();
    const request = trainRequest();
    request.spec = { type: "train", config_contents: [], model_types: [], ...labels };
    const { jobId } = await stub.submit(request);
    const events: JobEvent[] = [];
    stub.subscribe(jobId, (e) => events.push(e));
    drain();

    expect(events.map(brief)).toEqual([[1, "job.status", { state: "failed", detail: TRAIN_NEEDS_SAVED_PROJECT }]]);
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
      [
        6,
        "job.result",
        { predictions: ["derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_desc-predictionsSession1_pose.slp"] },
      ],
      [7, "job.status", { state: "completed" }],
    ]);
  });

  it.each([
    [
      "the project's folders",
      "sub-01/beh/session1.slp",
      "session1.mp4",
      "sub-01/beh/sub-01_desc-predictionsSession1_pose.slp",
    ],
    [
      "a labels file of the project's, as that file's twin",
      "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_desc-labelsCamTop_pose.slp",
      "x.mp4",
      "sub-01/ses-02/beh/sub-01_ses-02_desc-predictionsCamTop_pose.slp",
    ],
    [
      "the input's name, when the project names no subject",
      "videos/session1.slp",
      "sub-03_ses-04_task-reach.mp4",
      "sub-03/ses-04/beh/sub-03_ses-04_task-reach_desc-predictions_pose.slp",
    ],
    [
      "the input's name, when there is no project",
      null,
      "sub-05_video.mp4",
      "sub-05/beh/sub-05_desc-predictionsVideo_pose.slp",
    ],
  ])("places predictions in the BIDS layout, reading the subject from %s", async (_label, path, name, expected) => {
    const { stub, drain } = steppedStub();
    const request = { ...trackRequest, inputs: [{ url: VIDEO_URL, fileType: "mp4" as const, name }] };
    const { jobId } = await stub.submit(inProject(request, path === null ? undefined : { dandisetId: "000398", path }));
    const results: unknown[] = [];
    stub.subscribe(jobId, (e) => {
      if (e.topic === "job.result") results.push(e.data);
    });
    drain();

    expect(results).toEqual([{ predictions: [`derivatives/sleap/${expected}`] }]);
  });

  it("gives two projects of one session their own predictions", async () => {
    const { stub, drain } = steppedStub();
    const predictions: unknown[] = [];
    for (const path of ["sub-01/ses-02/sub-01_ses-02_task-a_proj.slp", "sub-01/ses-02/sub-01_ses-02_task-b_proj.slp"]) {
      const { jobId } = await stub.submit(inProject(trackRequest, { dandisetId: "000398", path }));
      stub.subscribe(jobId, (e) => {
        if (e.topic === "job.result") predictions.push(...(e.data.predictions as unknown[]));
      });
    }
    drain();

    expect(predictions).toEqual([
      "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_task-a_desc-predictionsProj_pose.slp",
      "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_task-b_desc-predictionsProj_pose.slp",
    ]);
  });

  it.each([
    ["a project path without a subject", { dandisetId: "000398", path: "videos/session1.slp" }],
    ["a project path whose session is not a BIDS label", { dandisetId: "000398", path: "sub-01/ses-day-1/x.slp" }],
    ["no project", undefined],
  ])("fails an inference job whose subject it cannot find, given %s", async (_label, project) => {
    const { stub, drain } = steppedStub();
    const { jobId } = await stub.submit(inProject(trackRequest, project));
    const events: JobEvent[] = [];
    stub.subscribe(jobId, (e) => events.push(e));
    drain();

    const detail =
      "Cannot place the predictions for session1.mp4: neither the project's path nor the input's name gives its " +
      "subject, and any session it names, as BIDS labels (letters and digits only).";
    expect(events.map(brief)).toEqual([[1, "job.status", { state: "failed", detail }]]);
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

  it("keeps delivering to the other subscribers when one throws, live and in replay", async () => {
    const { stub, step, drain } = steppedStub();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { jobId } = await stub.submit(trackRequest);
    step();
    const seen: number[] = [];
    stub.subscribe(jobId, () => {
      throw new Error("viewer bug");
    });
    stub.subscribe(jobId, (e) => seen.push(e.seq));
    drain();

    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Once on replaying seq 1, then once per live event.
    expect(errors).toHaveBeenCalledTimes(7);
    expect(errors.mock.calls[0][0]).toBe(`A subscriber to job ${jobId} threw on event 1:`);
    errors.mockRestore();
  });

  it("lists each model it trained for a dandiset once its result is in, as the EMBER source would", async () => {
    const { stub, step, drain } = steppedStub();
    expect(stub.models.name).toBe("the compute stub");
    await stub.submit(inProject(trainRequest(1)));
    drain();
    const { jobId } = await stub.submit(trainRequest(1));
    const events: JobEvent[] = [];
    stub.subscribe(jobId, (e) => events.push(e));
    while (events.at(-1)?.topic !== "job.metric") step();
    expect(await stub.models.list({})).toEqual([]);

    step();
    expect(events.at(-1)?.topic).toBe("job.result");
    expect(await stub.models.list({})).toEqual([
      {
        id: "ember:000398/stub-model-2",
        name: "stub-model-2 (trained here on the stub)",
        heads: ["single_instance"],
        files: [
          { role: "config", url: "ember://000398/derivatives/sleap/models/stub-model-2/training_config.yaml" },
          { role: "checkpoint", url: "ember://000398/derivatives/sleap/models/stub-model-2/best.ckpt" },
        ],
      },
    ]);
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
