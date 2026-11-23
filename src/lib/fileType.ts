import type { FileType } from "./sleapContract";

// Longest suffix first, so "x.pkg.slp" is a package and not a plain ".slp".
const SUFFIXES: readonly [string, FileType][] = [
  [".pkg.slp", "pkg.slp"],
  [".slp", "slp"],
  [".mp4", "mp4"],
  [".avi", "avi"],
  [".h5", "h5"],
];

/**
 * The type an asset path declares by its name, or null for anything the SLEAP app does not open.
 * Archive and proxy URLs are extensionless, so this is read off the asset path, never the URL.
 */
export function fileTypeOfPath(path: string): FileType | null {
  const lower = path.toLowerCase();
  for (const [suffix, type] of SUFFIXES) {
    if (lower.endsWith(suffix)) return type;
  }
  return null;
}

/** Whether a file of this type is a labels project rather than a video. */
export function isProjectType(type: FileType): boolean {
  return type === "slp" || type === "pkg.slp";
}

/** The project type an asset path declares, or a thrown error naming the path when it is no SLEAP project. */
export function projectTypeOf(path: string): FileType {
  const type = fileTypeOfPath(path);
  if (type && isProjectType(type)) return type;
  throw new Error(`${path} is not a SLEAP project (.slp or .pkg.slp).`);
}

/** A relative path with no empty, `.` or `..` segment, so it cannot climb out of the folder it is read in. */
export function isSafeRelativePath(path: string): boolean {
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** The last segment of an asset path or a stored (possibly Windows) video path. */
export function baseName(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1];
}
