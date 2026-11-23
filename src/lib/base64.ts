// Base64 for the labels a training job may carry inline (`labels_content`), which upstream sends as
// the base64 of an `.slp` file's bytes.
import { humanSize } from "@brain-bbqs/utils";

// Spreading a whole file into one String.fromCharCode call overflows the stack, so bytes go in chunks.
const CHUNK = 0x8000;

/**
 * The base64 of `bytes`; throws when it would be longer than the browser's longest string, which
 * caps inline labels at about 384 MiB in Chromium.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  try {
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    text = btoa(binary);
  } catch {
    // Past the longest string the concatenation throws; just short of it, Chromium's btoa returns "".
  }
  if (text.length !== 4 * Math.ceil(bytes.length / 3)) {
    throw new Error(
      `These labels are too large to send inline (${humanSize(bytes.length)}): save the project, then train.`,
    );
  }
  return text;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** The bytes `text` encodes; throws when it is not base64. */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
