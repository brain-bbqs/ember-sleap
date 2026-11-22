// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent, MountOptions, SleapAppHandle, SleapHost } from "../../src/lib/sleapContract";
import { describeSignature, mountStandIn, readHead, STAND_IN_VERSION } from "../../src/ui/sleapStandIn";

const HDF5 = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const FILE = { url: "https://bucket.example/blobs/abc", fileType: "slp" as const, name: "labels.slp" };
const REF = { key: "ember:000123:sub-01/labels.slp" };

function bytesResponse(bytes: number[], status = 206): Response {
  return new Response(new Uint8Array(bytes), { status });
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
