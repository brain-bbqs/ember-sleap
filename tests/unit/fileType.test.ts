import { describe, expect, it } from "vitest";
import { baseName, fileTypeOfPath, isProjectType } from "../../src/lib/fileType";
import type { FileType } from "../../src/lib/sleapContract";

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
