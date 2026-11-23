import { describe, expect, it } from "vitest";
import { baseName, fileTypeOfPath, isProjectType, isSafeRelativePath, projectTypeOf } from "../../src/lib/fileType";
import type { FileType } from "../../src/lib/sleapContract";

describe("projectTypeOf", () => {
  it.each<[string, FileType]>([
    ["sub-01/labels.slp", "slp"],
    ["sub-01/train.PKG.SLP", "pkg.slp"],
  ])("%s is a %s project", (path, expected) => {
    expect(projectTypeOf(path)).toBe(expected);
  });

  it.each(["videos/session1.mp4", "dataset_description.json"])("refuses %s, naming it", (path) => {
    expect(() => projectTypeOf(path)).toThrow(new Error(`${path} is not a SLEAP project (.slp or .pkg.slp).`));
  });
});

describe("isSafeRelativePath", () => {
  it.each<[string, boolean]>([
    ["derivatives/sleap/sub-01/beh/x.slp", true],
    ["x.slp", true],
    ["..x/y..", true],
    ["", false],
    ["/abs/x.slp", false],
    ["a//b", false],
    ["a/b/", false],
    ["./a", false],
    ["a/../b", false],
    ["..", false],
  ])("%j is safe: %s", (path, expected) => {
    expect(isSafeRelativePath(path)).toBe(expected);
  });
});

describe("fileTypeOfPath", () => {
  it.each<[string, FileType | null]>([
    ["sub-01/train.pkg.slp", "pkg.slp"],
    ["sub-01/labels.slp", "slp"],
    ["sub-01/LABELS.SLP", "slp"],
    ["videos/session1.mp4", "mp4"],
    ["videos/session1.AVI", "avi"],
    ["sub-01/analysis.h5", "h5"],
    ["sub-01/labels.slp.movement.nc", null],
    ["dataset_description.json", null],
    ["", null],
  ])("%s is %s", (path, expected) => {
    expect(fileTypeOfPath(path)).toBe(expected);
  });
});

describe("isProjectType", () => {
  it.each<[FileType, boolean]>([
    ["slp", true],
    ["pkg.slp", true],
    ["mp4", false],
    ["avi", false],
    ["h5", false],
  ])("%s is a project: %s", (type, expected) => {
    expect(isProjectType(type)).toBe(expected);
  });
});

describe("baseName", () => {
  it.each([
    ["sub-01/beh/video.mp4", "video.mp4"],
    ["C:\\lab\\videos\\session1.mp4", "session1.mp4"],
    ["/home/lab/videos/session1.mp4", "session1.mp4"],
    ["video.mp4", "video.mp4"],
  ])("%s ends in %s", (path, expected) => {
    expect(baseName(path)).toBe(expected);
  });
});
