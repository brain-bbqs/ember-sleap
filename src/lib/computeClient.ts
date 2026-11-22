import type { FileType, JobEvent, JobSpec, JobState } from "./sleapContract";

/**
 * The central Pennsieve proxy's job API root. Null until the proxy team's API exists (see
 * docs/COMPUTE_API.md); while it is, jobs run on the in-browser stub in computeStub.ts.
 */
export const COMPUTE_PROXY_URL: string | null = null;

/** An input the job reads, with its type stated, since EMBER and proxy URLs carry no extension. */
export interface JobInput {
  url: string;
  fileType: FileType;
  name: string;
}

/** What this page sends to compute: the app's own job spec, plus what the spec's URLs are. */
export interface JobRequest {
  spec: JobSpec;
  /** Every URL the spec names (`labels_path`, `data_path`, ...), with its file type. */
  inputs: JobInput[];
  /** The model card ids in a track job's `model_paths`, expanded to the files the worker fetches. */
  models: { id: string; files: { role: "config" | "checkpoint"; url: string; sha256?: string }[] }[];
  /** The EMBER dandiset results go back to, and the project they came from. */
  project?: { dandisetId: string; path: string };
}

/**
 * Where jobs run. The real one is the central Pennsieve proxy (docs/COMPUTE_API.md is the API this
 * page asks the proxy team for); until it exists, computeStub.ts plays it in the browser.
 */
export interface ComputeClient {
  submit(request: JobRequest): Promise<{ jobId: string }>;
  /** Replays the job's events so far, then delivers new ones; the returned function stops delivery. */
  subscribe(jobId: string, onEvent: (event: JobEvent) => void): () => void;
  cancel(jobId: string): Promise<void>;
}

export const TERMINAL_JOB_STATES: ReadonlySet<JobState> = new Set<JobState>(["completed", "failed", "canceled"]);

/** Whether `event` is the `job.status` that ends its job's stream. */
export function isTerminalEvent(event: JobEvent): boolean {
  return event.topic === "job.status" && TERMINAL_JOB_STATES.has(event.data.state as JobState);
}

export type SetTimer = (callback: () => void, ms: number) => unknown;
export type ClearTimer = (handle: unknown) => void;

export interface ProxyComputeClientOptions {
  /** The proxy's job API root, e.g. "https://proxy.example.org/v1" (no trailing slash needed). */
  baseUrl: string;
  /** The signed-in user's EMBER access token, or null when there is none. */
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
  pollMs?: number;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
}

/** The central Pennsieve proxy's job API, as drafted in docs/COMPUTE_API.md. */
export function createProxyComputeClient({
  baseUrl,
  getToken,
  fetch: fetchImpl = (input, init) => fetch(input, init),
  pollMs = 2000,
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: ProxyComputeClientOptions): ComputeClient {
  const root = baseUrl.replace(/\/+$/, "");
  const jobUrl = (jobId: string, rest: string) => `${root}/jobs/${encodeURIComponent(jobId)}${rest}`;

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetchImpl(url, { ...init, headers });
  }

  async function post(url: string, what: string, body?: unknown): Promise<Response> {
    const init: RequestInit = { method: "POST" };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { "Content-Type": "application/json" };
    }
    const response = await call(url, init);
    if (!response.ok) throw new Error(`The compute proxy refused to ${what} (HTTP ${response.status}).`);
    return response;
  }

  return {
    async submit(request) {
      const response = await post(`${root}/jobs`, "submit the job", request);
      const { job_id } = (await response.json()) as { job_id?: unknown };
      if (typeof job_id !== "string" || !job_id) throw new Error("The compute proxy accepted the job without an id.");
      return { jobId: job_id };
    },

    subscribe(jobId, onEvent) {
      let lastSeq = 0;
      let stopped = false;
      let timer: unknown = null;

      async function poll(): Promise<void> {
        timer = null;
        try {
          const response = await call(jobUrl(jobId, `/events?after=${lastSeq}`));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const { events } = (await response.json()) as { events?: JobEvent[] };
          for (const event of [...(events ?? [])].sort((a, b) => a.seq - b.seq)) {
            if (stopped) return;
            if (event.seq <= lastSeq) continue;
            lastSeq = event.seq;
            onEvent(event);
            if (isTerminalEvent(event)) {
              stopped = true;
              return;
            }
          }
        } catch {
          // A dropped poll is retried on the next tick; the stream resumes from the last seq seen.
        }
        if (!stopped) timer = setTimer(() => void poll(), pollMs);
      }

      void poll();
      return () => {
        stopped = true;
        if (timer !== null) clearTimer(timer);
        timer = null;
      };
    },

    async cancel(jobId) {
      await post(jobUrl(jobId, "/cancel"), "cancel the job");
    },
  };
}
