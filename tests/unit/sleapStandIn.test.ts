// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newProjectFile } from "../../src/lib/newProjectFile";
import type {
  HostRef,
  JobEvent,
  MountOptions,
  NewProjectRequest,
  ResolvedFile,
  SleapAppHandle,
  SleapHost,
} from "../../src/lib/sleapContract";
import { describeSignature, mountStandIn, readHead, STAND_IN_VERSION } from "../../src/ui/sleapStandIn";

// The new project's file as its paths, so a test can read back what was written without HDF5
// (newProjectFile.test.ts writes the real thing).
// Made through a Response, since jsdom's own Blob cannot be read back.
vi.mock("../../src/lib/newProjectFile", () => ({
  newProjectFile: vi.fn((paths: string[]) => new Response(JSON.stringify(paths)).blob()),
}));

const HDF5 = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const FILE = { url: "https://bucket.example/blobs/abc", fileType: "slp" as const, name: "labels.slp" };
const REF = { key: "ember:000123:sub-01/labels.slp" };
const FRESH_URL = `${FILE.url}?fresh`;
const OTHER_REF = { key: "ember:000123:sub-02/other.slp" };
const OTHER = { url: "https://bucket.example/blobs/def", fileType: "slp" as const, name: "other.slp", ref: OTHER_REF };
const SAVED = { key: "ember:000123:derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.slp" };
const STARTED_REF = { key: "ember:000123:sub-01/beh/top.mp4" };
const STARTED: NewProjectRequest = {
  name: "Untitled.slp",
  videos: [
    { url: "https://bucket.example/blobs/top", fileType: "mp4", name: "top.mp4", storedPath: "sub-01/beh/top.mp4" },
    { url: "https://bucket.example/blobs/side", fileType: "mp4", name: "side.mp4", storedPath: "sub-01/beh/side.mp4" },
  ],
  ref: STARTED_REF,
};

function bytesResponse(bytes: number[], status = 206): Response {
  return new Response(new Uint8Array(bytes), { status });
}

/** What S3 answers once a presigned link has expired: a 403 with a body the page can read. */
const expired = () =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code></Error>', { status: 403 });

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] = () => {};
  let reject: Deferred<T>["reject"] = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function q<T extends HTMLElement = HTMLElement>(root: ParentNode, name: string): T {
  const found = root.querySelector<T>(`[data-role="${name}"]`);
  if (!found) throw new Error(`missing [data-role="${name}"]`);
  return found;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let container: HTMLDivElement;
let handle: SleapAppHandle | null;
let fetchMock: ReturnType<typeof vi.fn>;

function mount(options: Partial<MountOptions> = {}): SleapAppHandle {
  handle = mountStandIn(container, { assetBaseUrl: "https://page.example/sleap-assets/", ...options });
  return handle;
}

/** Answers each URL from its own route, and anything else with a 404. */
function serve(routes: Partial<Record<string, () => Response | Promise<Response>>>): void {
  fetchMock.mockImplementation((input: string | URL | Request) =>
    Promise.resolve(routes[String(input)]?.() ?? new Response(null, { status: 404 })),
  );
}

beforeEach(() => {
  document.title = "Host page";
  container = document.createElement("div");
  document.body.append(container);
  fetchMock = vi.fn((input: string | URL | Request) =>
    Promise.resolve(String(input) === FILE.url ? bytesResponse(HDF5) : new Response(null, { status: 404 })),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  handle?.unmount();
  handle = null;
  container.remove();
  vi.unstubAllGlobals();
});

describe("describeSignature", () => {
  it.each([
    [HDF5, "HDF5 signature"],
    [[0, 0, 0, 0x20, ...[..."ftypisom"].map((c) => c.charCodeAt(0))], "MP4 signature"],
    [
      [..."RIFF"]
        .map((c) => c.charCodeAt(0))
        .concat(
          [0, 0, 0, 0],
          [..."AVI "].map((c) => c.charCodeAt(0)),
        ),
      "AVI signature",
    ],
    [[1, 2, 3], "unrecognized signature"],
  ])("names %j as %s", (bytes, expected) => {
    expect(describeSignature(new Uint8Array(bytes))).toBe(expected);
  });
});

describe("readHead", () => {
  it("asks for a byte range and returns only the bytes asked for", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(bytesResponse([...HDF5, 9, 9, 9], 200)));
    const head = await readHead("https://x.example/a", 4, fetchImpl);
    expect([...head]).toEqual(HDF5.slice(0, 4));
    expect(fetchImpl).toHaveBeenCalledWith("https://x.example/a", { headers: { Range: "bytes=0-3" } });
  });

  it("returns what there is when the file is shorter than asked", async () => {
    const head = await readHead("https://x.example/a", 12, () => Promise.resolve(bytesResponse([1, 2])));
    expect([...head]).toEqual([1, 2]);
  });

  it("throws on an error status", async () => {
    await expect(readHead("https://x.example/a", 4, () => Promise.resolve(bytesResponse([], 403)))).rejects.toThrow(
      "HTTP 403",
    );
  });
});

describe("mountStandIn", () => {
  it("mounts inside the given element, says it is a stand-in, and has a version to report", () => {
    mount();
    const root = container.querySelector(".sleap-app");
    expect(root?.parentElement).toBe(container);
    expect(root?.textContent).toContain("SLEAP component stand-in");
    expect(STAND_IN_VERSION).toMatch(/stand-in/);
  });

  it("opens a file by its declared type and reads its signature with a ranged request", async () => {
    const app = mount();
    await app.open({ ...FILE, ref: REF });
    expect(q(container, "file-name").textContent).toBe("labels.slp");
    expect(q(container, "file-type").textContent).toBe("slp");
    expect(q(container, "file-probe").textContent).toBe(
      "Read the first 12 bytes with a ranged request: HDF5 signature.",
    );
    expect(q(container, "video").hidden).toBe(false);
    expect(app.isDirty()).toBe(false);
  });

  it("reports a file it cannot read", async () => {
    const app = mount();
    await app.open({ ...FILE, url: "https://bucket.example/missing" });
    expect(q(container, "file-probe").textContent).toBe("Could not read the file: HTTP 404");
    expect(q(container, "file-probe").classList.contains("err")).toBe(true);
  });

  it("hides the video lookup for a package, which carries its own frames", async () => {
    const app = mount();
    await app.open({ ...FILE, fileType: "pkg.slp" });
    expect(q(container, "video").hidden).toBe(true);
  });

  describe("page effects", () => {
    it("sets the page title and guards unload by default, as the standalone app does", async () => {
      const app = mount();
      await app.open(FILE);
      expect(document.title).toBe("labels.slp - SLEAP");
      q(container, "edit").click();
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it("leaves the page alone when the host turns the effects off", async () => {
      const app = mount({ pageEffects: { title: false, beforeUnload: false } });
      await app.open(FILE);
      q(container, "edit").click();
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      expect(document.title).toBe("Host page");
      expect(event.defaultPrevented).toBe(false);
    });

    it("lets an unload through while nothing is edited", () => {
      mount();
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("saving", () => {
    it("refuses before anything is open, and without a host save", async () => {
      mount({ host: { save: vi.fn() } });
      q(container, "save").click();
      await flush();
      expect(q(container, "save-status").textContent).toBe("Open a project before saving.");
      handle?.unmount();

      const app = mount({ host: {} });
      await app.open(FILE);
      q(container, "save").click();
      await flush();
      expect(q(container, "save-status").textContent).toBe("This page does not offer saving.");
    });

    it("hands the bytes to host.save with the project ref, then saves over what that returns", async () => {
      const saved = { key: "ember:000123:derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.slp" };
      const save = vi.fn<NonNullable<SleapHost["save"]>>(() => Promise.resolve(saved));
      const app = mount({ host: { save } });
      await app.open({ ...FILE, ref: REF });
      q(container, "edit").click();
      expect(app.isDirty()).toBe(true);
      expect(q(container, "dirty").hidden).toBe(false);

      q(container, "save").click();
      await vi.waitFor(() => expect(q(container, "save-status").textContent).toBe("Saved 12 B."));
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ size: 12 }), "labels.slp", REF);
      expect(app.isDirty()).toBe(false);

      q(container, "save").click();
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      expect(save.mock.calls[1][2]).toBe(saved);
    });

    it("keeps the edits and says why when the save fails", async () => {
      const app = mount({ host: { save: () => Promise.reject(new Error("Permission denied")) } });
      await app.open({ ...FILE, ref: REF });
      q(container, "edit").click();
      q(container, "save").click();
      await vi.waitFor(() => expect(q(container, "save-status").textContent).toBe("Save failed: Permission denied"));
      expect(app.isDirty()).toBe(true);
    });

    it("reports a failure that is not an Error", async () => {
      const app = mount({ host: { save: () => Promise.reject("offline") } });
      await app.open(FILE);
      q(container, "save").click();
      await vi.waitFor(() => expect(q(container, "save-status").textContent).toBe("Save failed: offline"));
    });

    it("saves on Ctrl+S or Cmd+S inside the app, and ignores the shortcut outside it", async () => {
      const save = vi.fn(() => Promise.resolve(REF));
      const app = mount({ host: { save } });
      await app.open({ ...FILE, ref: REF });

      const outside = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
      document.body.dispatchEvent(outside);
      await flush();
      expect(save).not.toHaveBeenCalled();
      expect(outside.defaultPrevented).toBe(false);

      const inside = new KeyboardEvent("keydown", { key: "S", metaKey: true, bubbles: true, cancelable: true });
      q(container, "edit").dispatchEvent(inside);
      expect(inside.defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

      q(container, "edit").dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
      await flush();
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("refreshes an expired link once, saves what the fresh one serves, and keeps reading from it", async () => {
      const save = vi.fn<NonNullable<SleapHost["save"]>>(() => Promise.resolve(SAVED));
      const refreshUrl = vi.fn<NonNullable<SleapHost["refreshUrl"]>>((file) =>
        Promise.resolve({ ...file, url: FRESH_URL }),
      );
      const submitJob = vi.fn<NonNullable<SleapHost["submitJob"]>>(() => Promise.resolve({ jobId: "job-1" }));
      const app = mount({ host: { save, refreshUrl, submitJob } });
      await app.open({ ...FILE, ref: REF });
      serve({ [FILE.url]: expired, [FRESH_URL]: () => bytesResponse([1, 2, 3], 200) });
      q(container, "edit").click();

      q(container, "save").click();
      await vi.waitFor(() => expect(q(container, "save-status").textContent).toBe("Saved 3 B."));
      expect(refreshUrl).toHaveBeenCalledWith({ ...FILE, ref: REF });
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ size: 3 }), "labels.slp", REF);
      expect(app.isDirty()).toBe(false);

      q(container, "save").click();
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      expect(refreshUrl).toHaveBeenCalledTimes(1);
      q(container, "train").click();
      await vi.waitFor(() => expect(submitJob).toHaveBeenCalled());
      expect(submitJob).toHaveBeenCalledWith(expect.objectContaining({ labels_path: FRESH_URL }), SAVED);
    });

    it("runs a second press after the first, with the ref and the link the first one left", async () => {
      const first = deferred<HostRef>();
      const save = vi.fn<NonNullable<SleapHost["save"]>>().mockReturnValueOnce(first.promise).mockResolvedValue(SAVED);
      const refreshUrl = vi.fn<NonNullable<SleapHost["refreshUrl"]>>((file) =>
        Promise.resolve({ ...file, url: FRESH_URL }),
      );
      const app = mount({ host: { save, refreshUrl } });
      await app.open({ ...FILE, ref: REF });
      serve({ [FILE.url]: expired, [FRESH_URL]: () => bytesResponse([1, 2, 3], 200) });

      q(container, "save").click();
      q(container, "save").click();
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      await flush();
      expect(save).toHaveBeenCalledTimes(1);

      first.resolve(SAVED);
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      expect(save.mock.calls.map((c) => c[2])).toEqual([REF, SAVED]);
      expect(refreshUrl).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([FILE.url, FILE.url, FRESH_URL, FRESH_URL]);
    });

    // The fresh link is refused too, so a refresh never rescues a read in these cases.
    it.each([
      { what: "an expired link the host cannot refresh", canRefresh: false, status: 403, refreshes: 0 },
      { what: "a link still refused after one refresh", canRefresh: true, status: 403, refreshes: 1 },
      { what: "a server error, which a refresh would not fix", canRefresh: true, status: 500, refreshes: 0 },
    ])("never hands host.save the body of $what, and keeps the edits", async ({ canRefresh, status, refreshes }) => {
      const save = vi.fn<NonNullable<SleapHost["save"]>>(() => Promise.resolve(SAVED));
      const refreshUrl = vi.fn<NonNullable<SleapHost["refreshUrl"]>>((file) =>
        Promise.resolve({ ...file, url: FRESH_URL }),
      );
      const app = mount({ host: canRefresh ? { save, refreshUrl } : { save } });
      await app.open({ ...FILE, ref: REF });
      const errorBody = () => new Response("<Error/>", { status });
      serve({ [FILE.url]: errorBody, [FRESH_URL]: errorBody });
      q(container, "edit").click();

      q(container, "save").click();
      await vi.waitFor(() =>
        expect(q(container, "save-status").textContent).toBe(
          `Save failed: Could not read the project (HTTP ${status}).`,
        ),
      );
      expect(save).not.toHaveBeenCalled();
      expect(refreshUrl).toHaveBeenCalledTimes(refreshes);
      expect(app.isDirty()).toBe(true);
    });
  });

  describe("opening another project while work on the last one is in flight", () => {
    it.each([
      ["finishes", (pending: Deferred<HostRef>) => pending.resolve(SAVED)],
      ["fails", (pending: Deferred<HostRef>) => pending.reject(new Error("Permission denied"))],
    ])("leaves the new project's ref, edits and status alone when the earlier save %s", async (_outcome, settle) => {
      const pending = deferred<HostRef>();
      const save = vi
        .fn<NonNullable<SleapHost["save"]>>()
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue(OTHER_REF);
      const app = mount({ host: { save } });
      serve({ [FILE.url]: () => bytesResponse(HDF5), [OTHER.url]: () => bytesResponse([1, 2]) });
      await app.open({ ...FILE, ref: REF });
      q(container, "edit").click();
      q(container, "save").click();
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

      await app.open(OTHER);
      q(container, "edit").click();
      settle(pending);
      await flush();
      expect(app.isDirty()).toBe(true);
      expect(q(container, "save-status").textContent).toBe("");

      q(container, "save").click();
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      expect(save.mock.calls).toEqual([
        [expect.objectContaining({ size: 12 }), "labels.slp", REF],
        [expect.objectContaining({ size: 2 }), "other.slp", OTHER_REF],
      ]);
    });

    it("saves what it read under the earlier project's name and ref, and keeps its fresh link to itself", async () => {
      const refreshed = deferred<ResolvedFile>();
      const save = vi.fn<NonNullable<SleapHost["save"]>>(() => Promise.resolve(SAVED));
      const submitJob = vi.fn<NonNullable<SleapHost["submitJob"]>>(() => Promise.resolve({ jobId: "job-1" }));
      const app = mount({ host: { save, refreshUrl: () => refreshed.promise, submitJob } });
      await app.open({ ...FILE, ref: REF });
      serve({
        [FILE.url]: expired,
        [FRESH_URL]: () => bytesResponse(HDF5, 200),
        [OTHER.url]: () => bytesResponse([1, 2]),
      });

      q(container, "save").click();
      await app.open(OTHER);
      refreshed.resolve({ ...FILE, url: FRESH_URL });
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ size: 12 }), "labels.slp", REF);

      q(container, "train").click();
      await vi.waitFor(() => expect(submitJob).toHaveBeenCalled());
      expect(submitJob).toHaveBeenCalledWith(expect.objectContaining({ labels_path: OTHER.url }), OTHER_REF);
    });

    it.each([
      ["result", () => bytesResponse([1, 2, 3])],
      ["failure", () => new Response(null, { status: 500 })],
    ])("shows the open project's probe, not an earlier project's late %s", async (_kind, late) => {
      const probe = deferred<Response>();
      serve({ [FILE.url]: () => probe.promise, [OTHER.url]: () => bytesResponse(HDF5) });
      const app = mount();
      const first = app.open(FILE);
      await app.open(OTHER);
      probe.resolve(late());
      await first;
      expect(q(container, "file-probe").textContent).toBe(
        "Read the first 12 bytes with a ranged request: HDF5 signature.",
      );
    });
  });

  describe("finding videos", () => {
    it("asks the host to resolve a stored path, with the project ref", async () => {
      const resolveVideo = vi
        .fn<NonNullable<SleapHost["resolveVideo"]>>()
        .mockResolvedValueOnce({ url: "https://x.example/v", fileType: "mp4", name: "session1.mp4" })
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error("offline"))
        .mockRejectedValueOnce("down");
      const app = mount({ host: { resolveVideo } });
      await app.open({ ...FILE, ref: REF });
      const path = q<HTMLInputElement>(container, "video-path");
      path.value = "C:\\lab\\session1.mp4";

      const expectations = ["Found session1.mp4 (mp4).", "No match.", "Lookup failed: offline", "Lookup failed: down"];
      for (const expected of expectations) {
        q(container, "video-find").click();
        await vi.waitFor(() => expect(q(container, "video-result").textContent).toBe(expected));
      }
      expect(resolveVideo).toHaveBeenCalledWith("C:\\lab\\session1.mp4", REF);
    });

    it("says so when the host does not look videos up", async () => {
      const app = mount({ host: {} });
      await app.open(FILE);
      q(container, "video-find").click();
      expect(q(container, "video-result").textContent).toBe("This page does not look videos up.");
    });
  });

  describe("compute", () => {
    const backends = () => [...q<HTMLSelectElement>(container, "backend").options].map((o) => o.value);

    it.each([
      [{ builtIn: true }, { submitJob: vi.fn() }, ["local", "connect", "host"]],
      [undefined, {}, ["local", "connect"]],
      [{ builtIn: false }, { submitJob: vi.fn() }, ["host"]],
    ])("offers backends for compute %j and host %j: %j", (compute, host, expected) => {
      mount({ compute, host });
      expect(backends()).toEqual(expected);
    });

    function computeHost(overrides: Partial<SleapHost> = {}) {
      let emit: (event: JobEvent) => void = () => {};
      const unsubscribe = vi.fn();
      const host = {
        submitJob: vi.fn<NonNullable<SleapHost["submitJob"]>>(() => Promise.resolve({ jobId: "job-1" })),
        subscribeJob: vi.fn((_id: string, onEvent: (event: JobEvent) => void) => {
          emit = onEvent;
          return unsubscribe;
        }),
        cancelJob: vi.fn(() => Promise.resolve()),
        listModels: vi.fn<NonNullable<SleapHost["listModels"]>>(() =>
          Promise.resolve([
            { id: "hf:lab/mouse", name: "Mouse", heads: ["single_instance"], species: "mouse", files: [] },
          ]),
        ),
        ...overrides,
      };
      return { host, emit: (e: JobEvent) => emit(e), unsubscribe };
    }

    it("does nothing on Train or Find models before a project is open", () => {
      const { host } = computeHost();
      mount({ compute: { builtIn: false }, host });
      q(container, "train").click();
      q(container, "list-models").click();
      expect(host.submitJob).not.toHaveBeenCalled();
      expect(host.listModels).not.toHaveBeenCalled();
    });

    it("runs jobs only through the host's backend", async () => {
      const { host } = computeHost();
      const app = mount({ host });
      await app.open(FILE);
      q<HTMLSelectElement>(container, "backend").value = "local";
      q(container, "train").click();
      expect(q(container, "compute-status").textContent).toBe(
        "The stand-in runs jobs only through the page's own compute.",
      );
      expect(host.submitJob).not.toHaveBeenCalled();
    });

    it("submits a training job on the open project and follows its events", async () => {
      const { host, emit, unsubscribe } = computeHost();
      const app = mount({ compute: { builtIn: false }, host });
      await app.open({ ...FILE, ref: REF });
      q(container, "train").click();
      await vi.waitFor(() => expect(q(container, "job").hidden).toBe(false));
      expect(host.submitJob).toHaveBeenCalledWith(
        expect.objectContaining({ type: "train", labels_path: FILE.url, model_types: ["single_instance"] }),
        REF,
      );
      expect(q(container, "job-id").textContent).toBe("Job job-1");

      const events: JobEvent[] = [
        { topic: "job.status", seq: 1, data: { state: "running" } },
        { topic: "job.log", seq: 2, data: { line: "Loading labels" } },
        { topic: "job.log", seq: 3, data: { line: 42 } },
        { topic: "job.epoch", seq: 4, data: { epoch: 0, train_loss: 0.5, val_loss: { odd: true } } },
        { topic: "job.metric", seq: 5, data: { epoch: 0 } },
        { topic: "job.result", seq: 6, data: { model_id: "m1" } },
        { topic: "job.status", seq: 7, data: { state: "completed" } },
      ];
      events.forEach(emit);
      expect(q(container, "job-log").textContent).toBe(
        'Loading labels\n\nepoch 0: train loss 0.5, val loss {"odd":true}\nresult: {"model_id":"m1"}\n',
      );
      expect(q(container, "job-state").textContent).toBe("completed");
      expect(q(container, "job-state").classList.contains("ok")).toBe(true);
      expect(q(container, "job-cancel").hidden).toBe(true);

      app.unmount();
      handle = null;
      expect(unsubscribe).toHaveBeenCalled();
    });

    it("trains on unsaved edits by sending them inline, as the bytes a save would send", async () => {
      const { host } = computeHost();
      const app = mount({ compute: { builtIn: false }, host });
      await app.open({ ...FILE, ref: REF });
      q(container, "edit").click();
      q(container, "train").click();
      await vi.waitFor(() => expect(host.submitJob).toHaveBeenCalled());
      const [spec, ref] = host.submitJob.mock.calls[0];
      expect(spec).toEqual({
        type: "train",
        config_contents: [expect.stringContaining("single_instance")],
        model_types: ["single_instance"],
        labels_content: btoa(String.fromCharCode(...HDF5)),
        max_epochs: 3,
        run_name: "stand-in",
      });
      expect(ref).toBe(REF);
      expect(app.isDirty()).toBe(true);
    });

    it("renews an expired link once to read the edits it trains on, and keeps the fresh one", async () => {
      const { host } = computeHost();
      const refreshUrl = vi.fn<NonNullable<SleapHost["refreshUrl"]>>((file) =>
        Promise.resolve({ ...file, url: FRESH_URL }),
      );
      const app = mount({ host: { ...host, refreshUrl } });
      await app.open({ ...FILE, ref: REF });
      serve({ [FILE.url]: expired, [FRESH_URL]: () => bytesResponse([1, 2, 3], 200) });
      q(container, "edit").click();
      q(container, "train").click();
      await vi.waitFor(() => expect(host.submitJob).toHaveBeenCalledTimes(1));
      expect(host.submitJob.mock.calls[0][0]).toMatchObject({ labels_content: btoa("\x01\x02\x03") });

      q(container, "list-models").click();
      await vi.waitFor(() => expect(container.querySelectorAll('[data-role="predict"]').length).toBe(1));
      q(container, "predict").click();
      await vi.waitFor(() => expect(host.submitJob).toHaveBeenCalledTimes(2));
      expect(host.submitJob.mock.calls[1][0]).toMatchObject({ data_path: FRESH_URL });
      expect(refreshUrl).toHaveBeenCalledTimes(1);
    });

    it("says why it cannot train on edits it cannot read, and submits nothing", async () => {
      const { host } = computeHost();
      const app = mount({ host });
      await app.open({ ...FILE, ref: REF });
      serve({ [FILE.url]: () => new Response("<Error/>", { status: 500 }) });
      q(container, "edit").click();
      q(container, "train").click();
      await vi.waitFor(() =>
        expect(q(container, "compute-status").textContent).toBe(
          "Could not submit: Could not read the project (HTTP 500).",
        ),
      );
      expect(host.submitJob).not.toHaveBeenCalled();
    });

    it("says to save first when its edits are too large to send inline, and submits nothing", async () => {
      const { host } = computeHost();
      const app = mount({ host });
      await app.open({ ...FILE, ref: REF });
      // What Chromium's btoa gives once the base64 would be longer than its longest string.
      vi.stubGlobal("btoa", () => "");
      q(container, "edit").click();
      q(container, "train").click();
      await vi.waitFor(() =>
        expect(q(container, "compute-status").textContent).toBe(
          "Could not submit: These labels are too large to send inline (12 B): save the project, then train.",
        ),
      );
      expect(host.submitJob).not.toHaveBeenCalled();
    });

    it("trains on the saved project by its link once its edits are saved", async () => {
      const { host } = computeHost();
      const save = vi.fn<NonNullable<SleapHost["save"]>>(() => Promise.resolve(SAVED));
      const app = mount({ host: { ...host, save } });
      await app.open({ ...FILE, ref: REF });
      q(container, "edit").click();
      q(container, "save").click();
      await vi.waitFor(() => expect(app.isDirty()).toBe(false));
      q(container, "train").click();
      await vi.waitFor(() => expect(host.submitJob).toHaveBeenCalled());
      expect(host.submitJob.mock.calls[0][0]).toMatchObject({ labels_path: FILE.url });
      expect(host.submitJob.mock.calls[0][0]).not.toHaveProperty("labels_content");
      expect(host.submitJob.mock.calls[0][1]).toBe(SAVED);
    });

    it("shows a failure's detail, and a canceled job's, with Cancel gone", async () => {
      const { host, emit } = computeHost();
      const app = mount({ host });
      await app.open(FILE);
      q(container, "train").click();
      await vi.waitFor(() => expect(q(container, "job").hidden).toBe(false));
      emit({ topic: "job.status", seq: 1, data: { state: "failed", detail: "out of memory" } });
      expect(q(container, "job-state").classList.contains("err")).toBe(true);
      expect(q(container, "job-log").textContent).toBe("failed: out of memory\n");
      emit({ topic: "job.status", seq: 2, data: { state: "canceled", detail: undefined } });
      expect(q(container, "job-cancel").hidden).toBe(true);
    });

    it("cancels the followed job through the host", async () => {
      const { host, emit } = computeHost();
      const app = mount({ host });
      await app.open(FILE);
      q(container, "job-cancel").click();
      expect(host.cancelJob).not.toHaveBeenCalled();
      q(container, "train").click();
      await vi.waitFor(() => expect(q(container, "job").hidden).toBe(false));
      emit({ topic: "job.status", seq: 1, data: { state: "running" } });
      expect(q(container, "job-cancel").hidden).toBe(false);
      q(container, "job-cancel").click();
      expect(host.cancelJob).toHaveBeenCalledWith("job-1");
    });

    it("follows a submitted job even when the host cannot stream it", async () => {
      const { host } = computeHost({ subscribeJob: undefined });
      const app = mount({ host });
      await app.open(FILE);
      q(container, "train").click();
      await vi.waitFor(() => expect(q(container, "job-state").textContent).toBe("submitted"));
    });

    it("says why a submission failed", async () => {
      const { host } = computeHost({ submitJob: () => Promise.reject(new Error("proxy down")) });
      const app = mount({ host });
      await app.open(FILE);
      q(container, "train").click();
      await vi.waitFor(() => expect(q(container, "compute-status").textContent).toBe("Could not submit: proxy down"));
      const { host: other } = computeHost({ submitJob: () => Promise.reject("refused") });
      handle?.unmount();
      const second = mount({ host: other });
      await second.open(FILE);
      q(container, "train").click();
      await vi.waitFor(() => expect(q(container, "compute-status").textContent).toBe("Could not submit: refused"));
    });

    it("lists models and predicts with the chosen one on the open file", async () => {
      const { host } = computeHost();
      const app = mount({ host });
      await app.open({ ...FILE, ref: REF });
      q(container, "list-models").click();
      await vi.waitFor(() => expect(container.querySelectorAll('[data-role="predict"]').length).toBe(1));
      expect(q(container, "models").textContent).toContain("Mouse");
      expect(q(container, "models").textContent).toContain("single_instance · mouse");
      expect(host.listModels).toHaveBeenCalledWith({});

      q(container, "predict").click();
      await vi.waitFor(() => expect(host.submitJob).toHaveBeenCalled());
      expect(host.submitJob).toHaveBeenCalledWith(
        { type: "track", data_path: FILE.url, model_paths: ["hf:lab/mouse"] },
        REF,
      );

      q<HTMLSelectElement>(container, "backend").value = "local";
      q(container, "predict").click();
      expect(host.submitJob).toHaveBeenCalledTimes(1);
    });

    it("says where each listed model comes from, in the host's words", async () => {
      const sourceLabel = "from the model index (Hugging Face lab/mouse)";
      const listModels = () =>
        Promise.resolve([{ id: "index:mouse", name: "Mouse (1)", heads: [], license: "MIT", files: [], sourceLabel }]);
      const app = mount({ host: { listModels } });
      await app.open(FILE);
      q(container, "list-models").click();
      await vi.waitFor(() => expect(container.querySelectorAll('[data-role="predict"]').length).toBe(1));
      expect(q(container, "models").textContent).toContain("MIT · from the model index (Hugging Face lab/mouse)");
    });

    it("predicts on the project open when Predict is pressed, not the one the list was made for", async () => {
      const { host } = computeHost();
      const app = mount({ host });
      await app.open({ ...FILE, ref: REF });
      q(container, "list-models").click();
      await vi.waitFor(() => expect(container.querySelectorAll('[data-role="predict"]').length).toBe(1));

      await app.open(OTHER);
      q(container, "predict").click();
      await vi.waitFor(() => expect(host.submitJob).toHaveBeenCalled());
      expect(host.submitJob).toHaveBeenCalledWith(
        { type: "track", data_path: OTHER.url, model_paths: ["hf:lab/mouse"] },
        OTHER_REF,
      );
    });

    it.each([
      [() => Promise.resolve([]), "No models found."],
      [() => Promise.reject(new Error("hub down")), "Could not list models: hub down"],
      [() => Promise.reject("nope"), "Could not list models: nope"],
    ])("reports an empty or failed listing (%#)", async (listModels, expected) => {
      const app = mount({ host: { listModels } });
      await app.open(FILE);
      q(container, "list-models").click();
      await vi.waitFor(() => expect(q(container, "compute-status").textContent).toBe(expected));
    });

    it("does not list models when the host has no catalogue", async () => {
      const app = mount({ host: {} });
      await app.open(FILE);
      q(container, "list-models").click();
      expect(q(container, "compute-status").textContent).toBe("");
    });
  });

  it("unmounts cleanly, taking its unload guard with it", async () => {
    const app = mount();
    await app.open(FILE);
    q(container, "edit").click();
    app.unmount();
    handle = null;
    expect(container.querySelector(".sleap-app")).toBeNull();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("the stand-in laid out as the SLEAP web app", () => {
  it("opens on the start screen, with no project's panels", () => {
    mount({ host: { chooseProject: vi.fn() } });
    expect(q(container, "start").hidden).toBe(false);
    expect(q(container, "project").hidden).toBe(true);
    expect(q(container, "side").hidden).toBe(true);
    expect(q(container, "file-name").textContent).toBe("No project loaded");
    expect(q(container, "start-hint").textContent).toContain("EMBER archive");
  });

  it.each([
    ["start-new", null, "new"],
    ["start-open", null, "open"],
    ["menu-new", "menu-file", "new"],
    ["menu-open", "menu-file", "open"],
  ] as const)("hands %s to the host's picker as %s", (item, menu, intent) => {
    const chooseProject = vi.fn();
    mount({ host: { chooseProject } });
    if (menu) q(container, menu).click();
    q(container, item).click();
    expect(chooseProject).toHaveBeenCalledWith(intent);
  });

  it("says so when the host offers no picker", () => {
    mount();
    expect(q(container, "start-hint").textContent).toBe("This page offers no projects to open.");
    q(container, "start-open").click();
    expect(q(container, "save-status").textContent).toBe("This page offers no projects to open.");
  });

  it("opens one menu at a time, and closes it on a pick, a click elsewhere or Escape", () => {
    mount({ host: { chooseProject: vi.fn() } });
    const list = (menu: string) => q(container, menu).nextElementSibling as HTMLElement;
    q(container, "menu-file").click();
    expect(list("menu-file").hidden).toBe(false);
    expect(q(container, "menu-file").getAttribute("aria-expanded")).toBe("true");
    q(container, "menu-predict").click();
    expect(list("menu-file").hidden).toBe(true);
    expect(list("menu-predict").hidden).toBe(false);
    q(container, "menu-predict").click();
    expect(list("menu-predict").hidden).toBe(true);

    q(container, "menu-file").click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(list("menu-file").hidden).toBe(true);

    q(container, "menu-file").click();
    container
      .querySelector(".sleap-app")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(list("menu-file").hidden).toBe(true);

    q(container, "menu-file").click();
    q(container, "menu-open").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(list("menu-file").hidden).toBe(false);
    q(container, "menu-open").click();
    expect(list("menu-file").hidden).toBe(true);
  });

  it("leaves the start screen for an opened project, with its panels", async () => {
    const app = mount();
    await app.open(FILE);
    expect(q(container, "start").hidden).toBe(true);
    expect(q(container, "project").hidden).toBe(false);
    expect(q(container, "side").hidden).toBe(false);
    expect(q(container, "video-player").hidden).toBe(true);
  });

  it("focuses a panel's first control from the icon rail", async () => {
    const app = mount({ host: { submitJob: vi.fn() } });
    await app.open(FILE);
    const rail = [...container.querySelectorAll<HTMLButtonElement>(".sl-rail-button")];
    expect(rail.map((b) => b.title)).toEqual(["Videos", "Train and predict"]);
    rail[1].click();
    expect(document.activeElement).toBe(q(container, "backend"));
  });

  describe("a new project", () => {
    it("starts unsaved on the host's videos, showing the first", async () => {
      const app = mount();
      await app.create(STARTED);
      expect(q(container, "start").hidden).toBe(true);
      expect(q(container, "file-name").textContent).toBe("Untitled.slp");
      expect(q(container, "file-type").textContent).toBe("new project");
      expect(q(container, "file-probe").textContent).toBe(
        "New project on 2 videos. It is not saved yet: Save writes it.",
      );
      expect(app.isDirty()).toBe(true);
      expect(q(container, "dirty").hidden).toBe(false);
      expect(q(container, "video").hidden).toBe(true);
      const items = [...q(container, "video-list").querySelectorAll("button")];
      expect(items.map((b) => b.textContent)).toEqual(["sub-01/beh/top.mp4", "sub-01/beh/side.mp4"]);
      expect(items.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
      expect(q<HTMLVideoElement>(container, "video-player").hidden).toBe(false);
      expect(q<HTMLVideoElement>(container, "video-player").getAttribute("src")).toBe(STARTED.videos[0].url);

      items[1].click();
      expect(q<HTMLVideoElement>(container, "video-player").getAttribute("src")).toBe(STARTED.videos[1].url);
      expect(items.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    });

    it("saves a file of its own recording each video by its path, then saves over what that returned", async () => {
      const save = vi.fn<NonNullable<SleapHost["save"]>>(() => Promise.resolve(SAVED));
      const app = mount({ host: { save } });
      await app.create(STARTED);
      q(container, "save").click();
      await vi.waitFor(() => expect(q(container, "save-status").textContent).toMatch(/^Saved /));
      expect(vi.mocked(newProjectFile)).toHaveBeenCalledWith(["sub-01/beh/top.mp4", "sub-01/beh/side.mp4"]);
      const [blob, name, ref] = save.mock.calls[0];
      expect(JSON.parse(await new Response(blob).text())).toEqual(["sub-01/beh/top.mp4", "sub-01/beh/side.mp4"]);
      expect([name, ref]).toEqual(["Untitled.slp", STARTED_REF]);
      expect(app.isDirty()).toBe(false);

      q(container, "save").click();
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      expect(save.mock.calls[1][2]).toBe(SAVED);
    });

    it("trains on its file sent inline, since it has no link of its own", async () => {
      const submitJob = vi.fn<NonNullable<SleapHost["submitJob"]>>(() => Promise.resolve({ jobId: "job-1" }));
      const app = mount({ compute: { builtIn: false }, host: { submitJob } });
      await app.create(STARTED);
      q(container, "menu-predict").click();
      q(container, "menu-train").click();
      await vi.waitFor(() => expect(submitJob).toHaveBeenCalled());
      const [spec, ref] = submitJob.mock.calls[0];
      expect(spec).toMatchObject({ type: "train", labels_content: expect.any(String) });
      expect(spec).not.toHaveProperty("labels_path");
      expect(atob((spec as { labels_content: string }).labels_content)).toBe(
        JSON.stringify(["sub-01/beh/top.mp4", "sub-01/beh/side.mp4"]),
      );
      expect(ref).toBe(STARTED_REF);
    });

    it("predicts on the video it shows", async () => {
      const submitJob = vi.fn<NonNullable<SleapHost["submitJob"]>>(() => Promise.resolve({ jobId: "job-1" }));
      const listModels = () => Promise.resolve([{ id: "hf:lab/mouse", name: "Mouse", heads: [], files: [] }]);
      const app = mount({ compute: { builtIn: false }, host: { submitJob, listModels } });
      await app.create(STARTED);
      q(container, "video-list").querySelectorAll("button")[1].click();
      q(container, "menu-predict").click();
      q(container, "menu-models").click();
      await vi.waitFor(() => expect(container.querySelectorAll('[data-role="predict"]').length).toBe(1));
      q(container, "predict").click();
      await vi.waitFor(() => expect(submitJob).toHaveBeenCalled());
      expect(submitJob).toHaveBeenCalledWith(
        { type: "track", data_path: STARTED.videos[1].url, model_paths: ["hf:lab/mouse"] },
        STARTED_REF,
      );
    });

    it("shows no video and predicts on nothing when it has no videos", async () => {
      const submitJob = vi.fn<NonNullable<SleapHost["submitJob"]>>(() => Promise.resolve({ jobId: "job-1" }));
      const listModels = () => Promise.resolve([{ id: "hf:lab/mouse", name: "Mouse", heads: [], files: [] }]);
      const app = mount({ compute: { builtIn: false }, host: { submitJob, listModels } });
      await app.create({ ...STARTED, videos: [] });
      expect(q(container, "video-player").hidden).toBe(true);
      expect(q(container, "video-list").hidden).toBe(true);
      expect(q(container, "file-probe").textContent).toBe(
        "New project on 0 videos. It is not saved yet: Save writes it.",
      );
      q(container, "list-models").click();
      await vi.waitFor(() => expect(container.querySelectorAll('[data-role="predict"]').length).toBe(1));
      q(container, "predict").click();
      await flush();
      expect(submitJob).not.toHaveBeenCalled();
    });

    it("gives way to a project opened after it", async () => {
      const app = mount();
      await app.create(STARTED);
      await app.open(FILE);
      expect(q(container, "file-name").textContent).toBe("labels.slp");
      expect(q(container, "video-list").children).toHaveLength(0);
      expect(q(container, "video-player").hidden).toBe(true);
      expect(app.isDirty()).toBe(false);
    });
  });
});
