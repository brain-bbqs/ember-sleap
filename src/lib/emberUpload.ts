// The archive's upload sequence, copied from bbqs-uploader's `lib/upload-pipeline.ts` and
// `lib/s3-upload.ts` (brain-bbqs/bbqs-uploader@c8bd4e9) and narrowed to one Blob at a time. This
// app is the second one carrying it, which makes it a candidate for @brain-bbqs/ember-client.
import {
  apiFetch,
  ApiError,
  computeDandiEtag,
  planParts,
  type ArchiveConfig,
  type Asset,
  type CompletedPart,
  type FilePart,
  type UploadInitResponse,
} from "@brain-bbqs/ember-client";
import { runQueue } from "@brain-bbqs/utils";
import { findAssetByPath } from "./emberAssets";
import type { EtagHasher } from "./etagPool";

const PARALLEL_PARTS = 3;
const PART_ATTEMPTS = 3;

/** One S3 part PUT. XHR rather than fetch, for upload progress. */
export function putPart(url: string, blob: Blob, onProgress: (loaded: number) => void, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`S3 part upload failed with HTTP ${xhr.status}`));
        return;
      }
      const etag = (xhr.getResponseHeader("ETag") ?? "").replace(/"/g, "");
      if (etag) resolve(etag);
      else reject(new Error("S3 accepted the part but did not expose its ETag header (a bucket CORS setting)."));
    };
    xhr.onerror = () => reject(new Error("Network error during S3 part upload (possibly a CORS rejection)."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

export async function putPartWithRetry(
  url: string,
  blob: Blob,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PART_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error("Upload cancelled.");
    try {
      return await putPart(url, blob, onProgress, signal);
    } catch (e) {
      lastError = e;
      const message = e instanceof Error ? e.message : String(e);
      if (/cancelled|ETag header/.test(message)) throw e;
      onProgress(0);
      await wait(1500 * 2 ** attempt);
    }
  }
  throw lastError;
}

/**
 * Uploads `blob`'s bytes as an archive blob and returns its id. A 409 on initialize means the
 * archive already holds identical bytes, which are reused without sending anything.
 */
export async function uploadBlob(
  cfg: ArchiveConfig,
  blob: Blob,
  etag: string,
  parts: FilePart[],
  onProgress: (fraction: number) => void = () => {},
  signal?: AbortSignal,
): Promise<string> {
  let init: UploadInitResponse;
  try {
    init = (await apiFetch<UploadInitResponse>(cfg, "/uploads/initialize/", {
      method: "POST",
      json: {
        contentSize: blob.size,
        digest: { algorithm: "dandi:dandi-etag", value: etag },
        dandiset: cfg.dandisetId,
      },
    }))!;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 409)) throw e;
    // The 409's Location header names the blob but is not CORS-exposed; look it up by digest.
    const existing = (await apiFetch<{ blob_id: string }>(cfg, "/blobs/digest/", {
      method: "POST",
      json: { algorithm: "dandi:dandi-etag", value: etag },
    }))!;
    onProgress(1);
    return existing.blob_id;
  }

  if (init.parts.length !== parts.length) {
    throw new Error(`The archive planned ${init.parts.length} parts but this page computed ${parts.length}.`);
  }
  const sent = new Array<number>(init.parts.length).fill(0);
  const report = () => onProgress(Math.min(sent.reduce((a, b) => a + b, 0) / blob.size, 0.999));
  const completed = new Array<CompletedPart>(init.parts.length);
  await runQueue(init.parts, PARALLEL_PARTS, async (serverPart, i) => {
    const local = parts.at(serverPart.part_number - 1);
    if (local?.size !== serverPart.size) {
      throw new Error(`Part ${serverPart.part_number} differs in size between this page and the archive.`);
    }
    const slice = blob.slice(local.offset, local.offset + local.size);
    const partEtag = await putPartWithRetry(
      serverPart.upload_url,
      slice,
      (loaded) => {
        sent[i] = loaded;
        report();
      },
      signal,
    );
    sent[i] = local.size;
    report();
    completed[i] = { part_number: serverPart.part_number, size: serverPart.size, etag: partEtag };
  });

  const completion = (await apiFetch<{ complete_url: string; body: string }>(
    cfg,
    `/uploads/${init.upload_id}/complete/`,
    { method: "POST", json: { parts: completed } },
  ))!;
  const s3 = await fetch(completion.complete_url, { method: "POST", body: completion.body });
  const s3Text = await s3.text();
  if (!s3.ok || s3Text.includes("<Error>")) {
    throw new Error(`S3 rejected the CompleteMultipartUpload request: ${s3Text.slice(0, 300)}`);
  }
  const validated = (await apiFetch<{ blob_id: string }>(cfg, `/uploads/${init.upload_id}/validate/`, {
    method: "POST",
  }))!;
  onProgress(1);
  return validated.blob_id;
}

/** Points `path` in the draft at `blobId`, replacing the asset already there, if any. */
export async function createOrReplaceAsset(
  cfg: ArchiveConfig,
  path: string,
  blobId: string,
  existingAssetId: string | null,
): Promise<Asset> {
  const payload = { blob_id: blobId, metadata: { path } };
  const base = `/dandisets/${cfg.dandisetId}/versions/draft/assets/`;
  return (await apiFetch<Asset>(cfg, existingAssetId ? `${base}${existingAssetId}/` : base, {
    method: existingAssetId ? "PUT" : "POST",
    json: payload,
  }))!;
}

export type SaveStage = "hashing" | "uploading";

export interface PutAssetOptions {
  /** Each stage reports its own 0..1 fraction: hashing first, then uploading. */
  onProgress?: (stage: SaveStage, fraction: number) => void;
  /** The dandi-etag hash, `computeDandiEtag` on the main thread unless a worker pool is given. */
  hash?: EtagHasher;
  signal?: AbortSignal;
}

/** Hashes, uploads and places `blob` at `path` in the dandiset's draft: the whole save, end to end. */
export async function putAsset(
  cfg: ArchiveConfig,
  path: string,
  blob: Blob,
  { onProgress, hash = computeDandiEtag, signal }: PutAssetOptions = {},
): Promise<Asset> {
  const parts = planParts(blob.size);
  const etag = await hash(blob, parts, (fraction) => onProgress?.("hashing", fraction), signal);
  const blobId = await uploadBlob(cfg, blob, etag, parts, (fraction) => onProgress?.("uploading", fraction), signal);
  const existing = await findAssetByPath(cfg, path);
  return createOrReplaceAsset(cfg, path, blobId, existing?.asset_id ?? null);
}
