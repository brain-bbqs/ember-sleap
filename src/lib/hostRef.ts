import type { HostRef } from "./sleapContract";

/** Where a project lives on EMBER: a dandiset's draft and an asset path inside it. */
export interface EmberLocation {
  dandisetId: string;
  path: string;
}

const PREFIX = "ember:";

/** The opaque key the app holds for a project; it hands the key back on save. */
export function toHostRef({ dandisetId, path }: EmberLocation): HostRef {
  return { key: `${PREFIX}${dandisetId}:${path}` };
}

/** Reads a key this page made, or null for anything else (a ref the app made up, or none). */
export function fromHostRef(ref: HostRef | undefined): EmberLocation | null {
  if (!ref?.key.startsWith(PREFIX)) return null;
  const rest = ref.key.slice(PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { dandisetId: rest.slice(0, sep), path: rest.slice(sep + 1) };
}
