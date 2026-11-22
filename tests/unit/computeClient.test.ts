import { describe, expect, it, vi } from "vitest";
import { createProxyComputeClient, isTerminalEvent, type JobRequest } from "../../src/lib/computeClient";
import type { JobEvent } from "../../src/lib/sleapContract";

const BASE = "https://proxy.test/v1/";

const REQUEST: JobRequest = {
  spec: { type: "track", data_path: "https://s3.test/blob", model_paths: ["hf:lab/mice"] },
  inputs: [{ url: "https://s3.test/blob", fileType: "mp4", name: "session1.mp4" }],
  models: [{ id: "hf:lab/mice", files: [{ role: "config", url: "https://hf.test/training_config.yaml" }] }],
  project: { dandisetId: "000398", path: "sub-NONE/sub-NONE_sourcedata.slp" },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ev = (seq: number, topic: string, data: Record<string, unknown> = {}): JobEvent => ({
  topic,
  seq,
  jobId: "j1",
  data,
});

/** Timers held in a list and fired by hand, so polling runs only when a test says so. */
function manualTimers() {
  const pending: { id: number; callback: () => void; ms: number }[] = [];
  let next = 1;
  return {
    pending,
    setTimer: (callback: () => void, ms: number) => {
      const id = next++;
      pending.push({ id, callback, ms });
      return id;
    },
    clearTimer: vi.fn((handle: unknown) => {
      const i = pending.findIndex((t) => t.id === handle);
      if (i >= 0) pending.splice(i, 1);
    }),
    fire() {
      const timer = pending.shift();
      if (!timer) throw new Error("no timer pending");
      timer.callback();
    },
  };
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

describe("isTerminalEvent", () => {
  it.each([
    ["completed", true],
    ["failed", true],
    ["canceled", true],
    ["running", false],
    ["queued", false],
  ])("job.status %s is terminal: %s", (state, expected) => {
    expect(isTerminalEvent(ev(1, "job.status", { state }))).toBe(expected);
  });

  it("is never terminal for another topic", () => {
    expect(isTerminalEvent(ev(1, "job.log", { state: "completed" }))).toBe(false);
  });
});

describe("createProxyComputeClient submit", () => {
  it("posts the request as JSON with the bearer token and returns the job id", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json({ job_id: "j1" }));
    const client = createProxyComputeClient({ baseUrl: BASE, getToken: async () => "tok", fetch: fetchMock });

    const result = await client.submit(REQUEST);

    expect(result).toEqual({ jobId: "j1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proxy.test/v1/jobs");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(REQUEST);
    expect(headerOf(init, "Authorization")).toBe("Bearer tok");
    expect(headerOf(init, "Content-Type")).toBe("application/json");
  });

  it("omits the Authorization header when signed out", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json({ job_id: "j1" }));
    const client = createProxyComputeClient({ baseUrl: BASE, getToken: async () => null, fetch: fetchMock });

    await client.submit(REQUEST);

    expect(headerOf(fetchMock.mock.calls[0][1], "Authorization")).toBe(null);
  });

  it("names the status when the proxy refuses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json({}, 403));
    const client = createProxyComputeClient({ baseUrl: BASE, getToken: async () => "tok", fetch: fetchMock });

    await expect(client.submit(REQUEST)).rejects.toThrow("The compute proxy refused to submit the job (HTTP 403).");
  });

  it.each([[{}], [{ job_id: "" }], [{ job_id: 7 }]])("rejects an acceptance without a usable id: %j", async (body) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(body));
    const client = createProxyComputeClient({ baseUrl: BASE, getToken: async () => "tok", fetch: fetchMock });

    await expect(client.submit(REQUEST)).rejects.toThrow("The compute proxy accepted the job without an id.");
  });

  it("uses the global fetch by default", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json({ job_id: "j9" }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = createProxyComputeClient({ baseUrl: BASE, getToken: async () => null });
      expect(await client.submit(REQUEST)).toEqual({ jobId: "j9" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("createProxyComputeClient cancel", () => {
  it("posts to the job's cancel endpoint, escaping the id", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createProxyComputeClient({ baseUrl: BASE, getToken: async () => "tok", fetch: fetchMock });

    await client.cancel("a/b");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proxy.test/v1/jobs/a%2Fb/cancel");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(undefined);
    expect(headerOf(init, "Authorization")).toBe("Bearer tok");
  });

  it("names the status when the proxy refuses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 409 }));
    const client = createProxyComputeClient({ baseUrl: BASE, getToken: async () => "tok", fetch: fetchMock });

    await expect(client.cancel("j1")).rejects.toThrow("The compute proxy refused to cancel the job (HTTP 409).");
  });
});

describe("createProxyComputeClient subscribe", () => {
  it("delivers events in seq order, polls after the last seq, and stops at a terminal status", async () => {
    const timers = manualTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({ events: [ev(2, "job.status", { state: "running" }), ev(1, "job.status", { state: "queued" })] }),
      )
      .mockResolvedValueOnce(
        json({ events: [ev(2, "job.status", { state: "running" }), ev(3, "job.log", { line: "hi" })] }),
      )
      .mockResolvedValueOnce(
        json({ events: [ev(4, "job.status", { state: "completed" }), ev(5, "job.log", { line: "late" })] }),
      );
    const client = createProxyComputeClient({
      baseUrl: BASE,
      getToken: async () => "tok",
      fetch: fetchMock,
      pollMs: 50,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const seen: number[] = [];

    client.subscribe("j1", (e) => seen.push(e.seq));
    await vi.waitFor(() => expect(timers.pending.length).toBe(1));
    expect(seen).toEqual([1, 2]);
    expect(timers.pending[0].ms).toBe(50);

    timers.fire();
    await vi.waitFor(() => expect(timers.pending.length).toBe(1));
    expect(seen).toEqual([1, 2, 3]);

    timers.fire();
    await vi.waitFor(() => expect(seen).toEqual([1, 2, 3, 4]));
    await Promise.resolve();
    expect(timers.pending.length).toBe(0);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://proxy.test/v1/jobs/j1/events?after=0",
      "https://proxy.test/v1/jobs/j1/events?after=2",
      "https://proxy.test/v1/jobs/j1/events?after=3",
    ]);
    expect(headerOf(fetchMock.mock.calls[0][1], "Authorization")).toBe("Bearer tok");
  });

  it.each([
    ["an HTTP error", () => Promise.resolve(json({}, 502))],
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a body without events", () => Promise.resolve(json({}))],
  ])("retries on the next tick after %s, reporting nothing", async (_label, failure) => {
    const timers = manualTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(failure)
      .mockResolvedValueOnce(json({ events: [ev(1, "job.status", { state: "failed", detail: "boom" })] }));
    const client = createProxyComputeClient({
      baseUrl: BASE,
      getToken: async () => null,
      fetch: fetchMock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const onEvent = vi.fn();

    client.subscribe("j1", onEvent);
    await vi.waitFor(() => expect(timers.pending.length).toBe(1));
    expect(onEvent).not.toHaveBeenCalled();
    expect(timers.pending[0].ms).toBe(2000);

    timers.fire();
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[1][0]).toBe("https://proxy.test/v1/jobs/j1/events?after=0");
  });

  it("clears the pending poll on unsubscribe", async () => {
    const timers = manualTimers();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json({ events: [] }));
    const client = createProxyComputeClient({
      baseUrl: BASE,
      getToken: async () => null,
      fetch: fetchMock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    const stop = client.subscribe("j1", vi.fn());
    await vi.waitFor(() => expect(timers.pending.length).toBe(1));
    stop();

    expect(timers.clearTimer).toHaveBeenCalledTimes(1);
    expect(timers.pending.length).toBe(0);
    stop();
    expect(timers.clearTimer).toHaveBeenCalledTimes(1);
  });

  it("drops events and schedules nothing when unsubscribed mid-poll", async () => {
    const timers = manualTimers();
    let release: (r: Response) => void = () => {};
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    const client = createProxyComputeClient({
      baseUrl: BASE,
      getToken: async () => null,
      fetch: fetchMock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const onEvent = vi.fn();

    const stop = client.subscribe("j1", onEvent);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    stop();
    release(json({ events: [ev(1, "job.status", { state: "running" })] }));
    await new Promise((r) => setTimeout(r, 0));

    expect(onEvent).not.toHaveBeenCalled();
    expect(timers.pending.length).toBe(0);
    expect(timers.clearTimer).not.toHaveBeenCalled();
  });

  it("schedules no retry when unsubscribed while a failed poll was in flight", async () => {
    const timers = manualTimers();
    let fail: (e: Error) => void = () => {};
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(new Promise<Response>((_, reject) => (fail = reject)));
    const client = createProxyComputeClient({
      baseUrl: BASE,
      getToken: async () => null,
      fetch: fetchMock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    const stop = client.subscribe("j1", vi.fn());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    stop();
    fail(new Error("offline"));
    await new Promise((r) => setTimeout(r, 0));

    expect(timers.pending.length).toBe(0);
  });

  it("polls on real timers by default", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({ events: [] }))
        .mockResolvedValueOnce(json({ events: [ev(1, "job.status", { state: "completed" })] }))
        .mockResolvedValue(json({ events: [] }));
      const client = createProxyComputeClient({
        baseUrl: BASE,
        getToken: async () => null,
        fetch: fetchMock,
        pollMs: 10,
      });
      const onEvent = vi.fn();

      const stop = client.subscribe("j1", onEvent);
      await vi.advanceTimersByTimeAsync(10);
      expect(onEvent).toHaveBeenCalledTimes(1);
      stop();

      const stop2 = client.subscribe("j2", vi.fn());
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      stop2();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
