import { loadSlp } from "@talmolab/sleap-io.js";
import { describe, expect, it } from "vitest";
import { newProjectFile } from "../../src/lib/newProjectFile";

const HDF5 = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const VIDEOS = ["sub-01/ses-01/behavior/sub-01_ses-01_cam-top.mp4", "sub-02/behavior/side.avi"];

describe("newProjectFile", () => {
  it("writes an .slp that records each video by its path, with no skeleton or labels yet", async () => {
    const file = await newProjectFile(VIDEOS);
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(Array.from(bytes.slice(0, HDF5.length))).toEqual(HDF5);

    const labels = await loadSlp(bytes, { openVideos: false });
    expect(labels.videos.map((v) => v.filename)).toEqual(VIDEOS);
    expect(labels.skeletons).toEqual([]);
    expect(labels.labeledFrames).toEqual([]);
  });
});
