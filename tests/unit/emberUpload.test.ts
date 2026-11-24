import { computeDandiEtag, planParts, type ArchiveConfig, type FilePart } from "@brain-bbqs/ember-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOrReplaceAsset, putAsset, putPart, putPartWithRetry, uploadBlob } from "../../src/lib/emberUpload";

const API = "https://api.test/api";
const cfg: ArchiveConfig = { api: API, web: "https://web.test", accessToken: "tok", dandisetId: "000398" };

// ---- A scripted XMLHttpRequest for the S3 part PUTs --------------------------------------------

interface XhrScript {
  status?: number;
  /** The ETag response header; null leaves it out. */
  etag?: string | null;
  progress?: { loaded: number; lengthComputable?: boolean }[];
  fail?: "error" | "abort" | "hang";
  /** Thrown from open(), as a non-Error, the way a broken environment might. */
  throwOnOpen?: unknown;
}

class FakeXhr {
  static scripts: XhrScript[] = [];
  static sent: { method: string; url: string; size: number }[] = [];
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  private method = "";
  private url = "";
  private script: XhrScript = {};
  private headers: Record<string, string> = {};

  open(method: string, url: string): void {
    this.script = FakeXhr.scripts.shift() ?? {};
    if (this.script.throwOnOpen !== undefined) throw this.script.throwOnOpen;
    this.method = method;
    this.url = url;
  }

  getResponseHeader(name: string): string | null {
    return this.headers[name] ?? null;
  }

  abort(): void {
    queueMicrotask(() => this.onabort?.());
  }

  send(body: Blob): void {
    FakeXhr.sent.push({ method: this.method, url: this.url, size: body.size });
    const script = this.script;
    queueMicrotask(() => {
      for (const p of script.progress ?? []) {
        this.upload.onprogress?.({ lengthComputable: p.lengthComputable ?? true, loaded: p.loaded });
      }
      if (script.fail === "hang") return;
      if (script.fail === "error") return this.onerror?.();
      if (script.fail === "abort") return this.onabort?.();
      this.status = script.status ?? 200;
      if (script.etag !== null) this.headers.ETag = script.etag ?? `"etag-${FakeXhr.sent.length}"`;
      this.onload?.();
    });
  }
}

// ---- A router for the archive API calls (global fetch, which apiFetch uses) --------------------

type Handler = (body: unknown) => Response;

function stubFetch(routes: Record<string, Handler>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body: unknown =
      typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
    calls.push({ method, url, body });
    const key = `${method} ${url.startsWith(API) ? url.slice(API.length) : url}`;
    const handler = routes[key];
    return Promise.resolve(handler ? handler(body) : new Response(`no route for ${key}`, { status: 599 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const json = (value: unknown, status = 200) => Response.json(value, { status });

/** The routes of a successful single-part upload of `size` bytes, as upload `u1` and blob `blob-1`. */
function uploadRoutes(size: number, extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "POST /uploads/initialize/": () =>
      json({ upload_id: "u1", parts: [{ part_number: 1, size, upload_url: "https://s3.test/part-1" }] }),
    "POST /uploads/u1/complete/": () => json({ complete_url: "https://s3.test/complete", body: "<Complete/>" }),
    "POST https://s3.test/complete": () => new Response("<CompleteMultipartUploadResult/>"),
    "POST /uploads/u1/validate/": () => json({ blob_id: "blob-1" }),
    ...extra,
  };
}

beforeEach(() => {
  FakeXhr.scripts = [];
  FakeXhr.sent = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("putPart", () => {
  it("PUTs the part, reports computable progress and resolves to the unquoted ETag", async () => {
    FakeXhr.scripts = [
      { etag: '"abc123"', progress: [{ loaded: 2 }, { loaded: 3, lengthComputable: false }, { loaded: 5 }] },
    ];
    const progress: number[] = [];
    expect(await putPart("https://s3.test/p", new Blob(["hello"]), (n) => progress.push(n))).toBe("abc123");
    expect(progress).toEqual([2, 5]);
    expect(FakeXhr.sent).toEqual([{ method: "PUT", url: "https://s3.test/p", size: 5 }]);
  });

  it.each<[string, XhrScript, string]>([
    ["a non-2xx status", { status: 403 }, "S3 part upload failed with HTTP 403"],
    ["a status below 200", { status: 101 }, "S3 part upload failed with HTTP 101"],
    ["no readable ETag", { etag: null }, "did not expose its ETag header"],
    ["a network failure", { fail: "error" }, "Network error during S3 part upload"],
    ["an abort", { fail: "abort" }, "Upload cancelled."],
  ])("rejects on %s", async (_, script, message) => {
    FakeXhr.scripts = [script];
    await expect(putPart("https://s3.test/p", new Blob(["x"]), () => {})).rejects.toThrow(message);
  });

  it("aborts the request when the signal fires", async () => {
    FakeXhr.scripts = [{ fail: "hang" }];
    const controller = new AbortController();
    const pending = putPart("https://s3.test/p", new Blob(["x"]), () => {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("Upload cancelled.");
  });
});

describe("putPartWithRetry", () => {
  const noWait = vi.fn(() => Promise.resolve());

  beforeEach(() => noWait.mockClear());

  it("retries a failed part with backoff, resetting its progress, then succeeds", async () => {
    FakeXhr.scripts = [{ fail: "error" }, { status: 500 }, { etag: '"third"' }];
    const progress: number[] = [];
    expect(await putPartWithRetry("u", new Blob(["x"]), (n) => progress.push(n), undefined, noWait)).toBe("third");
    expect(noWait.mock.calls).toEqual([[1500], [3000]]);
    expect(progress).toEqual([0, 0]);
  });

  it("gives up after three attempts with the last failure", async () => {
    FakeXhr.scripts = [{ fail: "error" }, { fail: "error" }, { status: 502 }];
    await expect(putPartWithRetry("u", new Blob(["x"]), () => {}, undefined, noWait)).rejects.toThrow("HTTP 502");
    expect(FakeXhr.sent.length).toBe(3);
  });

  it.each<[string, XhrScript, string]>([
    ["a cancel", { fail: "abort" }, "Upload cancelled."],
    ["a missing ETag header", { etag: null }, "ETag header"],
  ])("does not retry %s", async (_, script, message) => {
    FakeXhr.scripts = [script];
    await expect(putPartWithRetry("u", new Blob(["x"]), () => {}, undefined, noWait)).rejects.toThrow(message);
    expect(noWait).not.toHaveBeenCalled();
  });

  it("retries a failure that is not an Error at all", async () => {
    FakeXhr.scripts = [{ throwOnOpen: "boom" }, { etag: '"ok"' }];
    expect(await putPartWithRetry("u", new Blob(["x"]), () => {}, undefined, noWait)).toBe("ok");
  });

  it("does not start once the signal has fired", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(putPartWithRetry("u", new Blob(["x"]), () => {}, controller.signal, noWait)).rejects.toThrow(
      "Upload cancelled.",
    );
    expect(FakeXhr.sent).toEqual([]);
  });

  it("waits on real timers by default", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    FakeXhr.scripts = [{ fail: "error" }, { etag: '"later"' }];
    const pending = putPartWithRetry("u", new Blob(["x"]), () => {});
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toBe("later");
  });
});

describe("uploadBlob", () => {
  const blob = new Blob(["hello world"]);
  const parts: FilePart[] = [{ number: 1, offset: 0, size: blob.size }];

  it("initializes, PUTs each part, completes on S3 and validates", async () => {
    FakeXhr.scripts = [{ etag: '"part-etag"', progress: [{ loaded: 4 }] }];
    const calls = stubFetch(uploadRoutes(blob.size));
    const progress: number[] = [];
    expect(await uploadBlob(cfg, blob, "etag-1", parts, (f) => progress.push(f))).toBe("blob-1");

    expect(calls[0]).toEqual({
      method: "POST",
      url: `${API}/uploads/initialize/`,
      body: { contentSize: blob.size, digest: { algorithm: "dandi:dandi-etag", value: "etag-1" }, dandiset: "000398" },
    });
    expect(calls[1].body).toEqual({ parts: [{ part_number: 1, size: blob.size, etag: "part-etag" }] });
    expect(calls[2]).toEqual({ method: "POST", url: "https://s3.test/complete", body: "<Complete/>" });
    expect(progress).toEqual([4 / blob.size, 0.999, 1]);
  });

  it("reuses a blob the archive already holds, sending nothing", async () => {
    const calls = stubFetch({
      "POST /uploads/initialize/": () => new Response("exists", { status: 409 }),
      "POST /blobs/digest/": () => json({ blob_id: "existing-blob" }),
    });
    const progress: number[] = [];
    expect(await uploadBlob(cfg, blob, "etag-1", parts, (f) => progress.push(f))).toBe("existing-blob");
    expect(calls[1].body).toEqual({ algorithm: "dandi:dandi-etag", value: "etag-1" });
    expect(FakeXhr.sent).toEqual([]);
    expect(progress).toEqual([1]);
  });

  it("passes any other initialize failure through", async () => {
    stubFetch({ "POST /uploads/initialize/": () => new Response("nope", { status: 403 }) });
    await expect(uploadBlob(cfg, blob, "etag-1", parts)).rejects.toThrow("HTTP 403");
  });

  it("refuses when the archive plans a different number of parts", async () => {
    stubFetch({ "POST /uploads/initialize/": () => json({ upload_id: "u1", parts: [] }) });
    await expect(uploadBlob(cfg, blob, "etag-1", parts)).rejects.toThrow("planned 0 parts but this page computed 1");
  });

  it.each([
    ["a different size", { part_number: 1, size: blob.size + 1 }],
    ["a part number this page has no part for", { part_number: 2, size: blob.size }],
  ])("refuses a part with %s", async (_, serverPart) => {
    stubFetch({
      "POST /uploads/initialize/": () =>
        json({ upload_id: "u1", parts: [{ ...serverPart, upload_url: "https://s3.test/p" }] }),
    });
    await expect(uploadBlob(cfg, blob, "etag-1", parts)).rejects.toThrow("differs in size");
  });

  it.each([
    ["an <Error> body", () => new Response("<Error><Code>InvalidPart</Code></Error>")],
    ["a failing status", () => new Response("bad", { status: 400 })],
  ])("throws when S3 completes the upload with %s", async (_, complete) => {
    stubFetch(uploadRoutes(blob.size, { "POST https://s3.test/complete": complete }));
    await expect(uploadBlob(cfg, blob, "etag-1", parts)).rejects.toThrow("S3 rejected the CompleteMultipartUpload");
  });

  it("reports nothing when no progress callback is given", async () => {
    stubFetch(uploadRoutes(blob.size));
    expect(await uploadBlob(cfg, blob, "etag-1", parts)).toBe("blob-1");
  });
});

describe("createOrReplaceAsset", () => {
  const draft = `/dandisets/000398/versions/draft/assets/`;

  it("creates a new asset with a POST", async () => {
    const calls = stubFetch({ [`POST ${draft}`]: () => json({ asset_id: "new", path: "a/b.slp" }) });
    expect(await createOrReplaceAsset(cfg, "a/b.slp", "blob-1", null)).toEqual({ asset_id: "new", path: "a/b.slp" });
    expect(calls[0].body).toEqual({ blob_id: "blob-1", metadata: { path: "a/b.slp" } });
  });

  it("replaces the existing asset with a PUT", async () => {
    const calls = stubFetch({ [`PUT ${draft}old/`]: () => json({ asset_id: "replaced", path: "a/b.slp" }) });
    expect(await createOrReplaceAsset(cfg, "a/b.slp", "blob-2", "old")).toEqual({
      asset_id: "replaced",
      path: "a/b.slp",
    });
    expect(calls[0]).toMatchObject({ method: "PUT", url: `${API}${draft}old/` });
  });
});

describe("putAsset", () => {
  const path = "derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.slp";
  const lookup = `GET /dandisets/000398/versions/draft/assets/?path=${encodeURIComponent(path)}&metadata=false&order=path&page_size=1000`;

  it("hashes with the dandi-etag, uploads, and creates the asset when none is there", async () => {
    const blob = new Blob(["labels bytes"]);
    const calls = stubFetch(
      uploadRoutes(blob.size, {
        [lookup]: () => json({ results: [] }),
        "POST /dandisets/000398/versions/draft/assets/": () => json({ asset_id: "new", path }),
      }),
    );
    expect(await putAsset(cfg, path, blob)).toEqual({ asset_id: "new", path });
    const expected = await computeDandiEtag(blob, planParts(blob.size));
    expect((calls[0].body as { digest: { value: string } }).digest.value).toBe(expected);
    expect(calls.at(-1)?.body).toEqual({ blob_id: "blob-1", metadata: { path } });
  });

  it("replaces the asset already at the path", async () => {
    const blob = new Blob(["new labels"]);
    const calls = stubFetch(
      uploadRoutes(blob.size, {
        [lookup]: () => json({ results: [{ asset_id: "old", path, size: 3 }] }),
        "PUT /dandisets/000398/versions/draft/assets/old/": () => json({ asset_id: "old2", path }),
      }),
    );
    const progress: [string, number][] = [];
    expect(await putAsset(cfg, path, blob, { onProgress: (...p) => progress.push(p) })).toEqual({
      asset_id: "old2",
      path,
    });
    expect(calls.at(-1)?.method).toBe("PUT");
    expect(progress).toEqual([
      ["hashing", 1],
      ["hashing", 1],
      ["uploading", 0.999],
      ["uploading", 1],
    ]);
  });

  it("hashes with the function it is given, reporting that as the hashing stage", async () => {
    const blob = new Blob(["labels bytes"]);
    const calls = stubFetch(
      uploadRoutes(blob.size, {
        [lookup]: () => json({ results: [] }),
        "POST /dandisets/000398/versions/draft/assets/": () => json({ asset_id: "new", path }),
      }),
    );
    const hash = vi.fn((_blob: Blob, _parts: FilePart[], onProgress?: (fraction: number) => void) => {
      onProgress?.(0.5);
      return Promise.resolve("pooled-etag");
    });
    const signal = new AbortController().signal;
    const progress: [string, number][] = [];

    await putAsset(cfg, path, blob, { hash, signal, onProgress: (...p) => progress.push(p) });
    expect(hash).toHaveBeenCalledWith(blob, planParts(blob.size), expect.any(Function), signal);
    expect((calls[0].body as { digest: { value: string } }).digest.value).toBe("pooled-etag");
    expect(progress[0]).toEqual(["hashing", 0.5]);
  });
});
