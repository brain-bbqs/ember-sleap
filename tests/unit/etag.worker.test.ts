// @vitest-environment jsdom
import { hashPart, type FilePart } from "@brain-bbqs/ember-client";
import { File as NodeFile } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HashWorkerRequest, HashWorkerResponse } from "../../src/lib/etagPool";

// In jsdom, `self` is the window, so the worker script wires itself onto window.onmessage and
// posts its responses through window.postMessage, both interceptable from the test.

let posted: HashWorkerResponse[];

function send(msg: HashWorkerRequest): void {
  window.onmessage!({ data: msg } as MessageEvent<HashWorkerRequest>);
}

async function reply(requestId: number, type: HashWorkerResponse["type"]): Promise<HashWorkerResponse> {
  await vi.waitFor(() => {
    expect(posted.some((m) => m.requestId === requestId && m.type === type)).toBe(true);
  });
  return posted.find((m) => m.requestId === requestId && m.type === type)!;
}

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  posted = [];
  vi.spyOn(window, "postMessage").mockImplementation((msg) => {
    posted.push(msg as HashWorkerResponse);
  });
  await import("../../src/workers/etag.worker");
});

// jsdom's Blob has no arrayBuffer(); Node's implements the whole interface hashPart needs.
const blob = new NodeFile([new Uint8Array(64).map((_, i) => i)], "labels.slp") as unknown as Blob;
const part: FilePart = { number: 1, offset: 0, size: 64 };

describe("etag.worker", () => {
  it("hashes a part, streaming progress before the digest", async () => {
    send({ type: "hash-part", requestId: 1, blob, part });

    const done = await reply(1, "done");
    expect(done).toEqual({ type: "done", requestId: 1, digest: await hashPart(blob, part) });
    expect(posted.filter((m) => m.type === "progress")).toEqual([{ type: "progress", requestId: 1, bytesDone: 64 }]);
  });

  it("acknowledges a cancel that arrives before the part is processed", async () => {
    send({ type: "cancel", requestId: 2 });
    send({ type: "hash-part", requestId: 2, blob, part });

    await reply(2, "cancelled");
    expect(posted.map((m) => m.type)).toEqual(["cancelled"]);
  });

  it("hashes a later request under a previously cancelled id normally", async () => {
    send({ type: "cancel", requestId: 3 });
    send({ type: "hash-part", requestId: 3, blob, part });
    await reply(3, "cancelled");

    // The cancel is consumed by the first request; the id is reusable afterwards.
    send({ type: "hash-part", requestId: 3, blob, part });
    await reply(3, "done");
  });

  it("reports an error message when hashing fails", async () => {
    // A part claiming more bytes than the blob has trips the short-read guard.
    send({ type: "hash-part", requestId: 4, blob, part: { number: 1, offset: 0, size: 128 } });

    const error = await reply(4, "error");
    expect((error as { message: string }).message).toMatch(/changed on disk/);
  });

  it("stringifies a non-Error failure value into the error message", async () => {
    // A blob whose slice rejects with a bare string, as some storage layers do.
    const broken = { slice: () => ({ arrayBuffer: () => Promise.reject("disk vanished") }) } as unknown as Blob;
    send({ type: "hash-part", requestId: 5, blob: broken, part });

    expect(await reply(5, "error")).toEqual({ type: "error", requestId: 5, message: "disk vanished" });
  });
});
