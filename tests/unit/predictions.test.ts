import { describe, expect, it } from "vitest";
import { MAX_PATH_LENGTH, MAX_PREDICTIONS, predictionsPathProblem, readPredictions } from "../../src/lib/predictions";

const FOLDER = "derivatives/sleap/sub-01/ses-02/beh";
const SLP = `${FOLDER}/sub-01_ses-02_desc-predictionsCamTop_pose.slp`;
const PKG = `${FOLDER}/sub-01_ses-02_desc-predictionsCamSide_pose.pkg.slp`;
/** A path under derivatives/sleap/ exactly `length` characters long. */
const pathOf = (length: number) => `${FOLDER}/${"a".repeat(length - FOLDER.length - 5)}.slp`;

describe("predictionsPathProblem", () => {
  it.each([SLP, PKG, `${FOLDER}/UPPER.SLP`, pathOf(MAX_PATH_LENGTH)])("opens %s", (path) => {
    expect(predictionsPathProblem(path)).toBe(null);
  });

  it.each([
    ["sub-01/ses-02/beh/cam-top.slp", "is not under derivatives/sleap/"],
    ["derivatives/other/x.slp", "is not under derivatives/sleap/"],
    ["derivatives/sleapy/x.slp", "is not under derivatives/sleap/"],
    [`/${SLP}`, "has an empty, '.' or '..' segment"],
    ["derivatives/sleap/../../sub-01/x.slp", "has an empty, '.' or '..' segment"],
    ["derivatives/sleap/./x.slp", "has an empty, '.' or '..' segment"],
    ["derivatives/sleap//x.slp", "has an empty, '.' or '..' segment"],
    ["", "has an empty, '.' or '..' segment"],
    [`${FOLDER}/sub-01_desc-predictions_pose.nwb`, "is not a .slp or .pkg.slp file"],
    [`${FOLDER}/video.mp4`, "is not a .slp or .pkg.slp file"],
    ["derivatives/sleap/models/m1/best.ckpt", "is not a .slp or .pkg.slp file"],
    [pathOf(MAX_PATH_LENGTH + 1), "is longer than 1024 characters"],
  ])("refuses %j: it %s", (path, problem) => {
    expect(predictionsPathProblem(path)).toBe(problem);
  });
});

describe("readPredictions", () => {
  it("names each predictions file in the job's own dandiset, in order", () => {
    expect(readPredictions({ predictions: [SLP, PKG] }, "000123")).toEqual({
      files: [
        { dandisetId: "000123", path: SLP },
        { dandisetId: "000123", path: PKG },
      ],
      ignored: [],
    });
  });

  it("names a file the result repeats once", () => {
    expect(readPredictions({ predictions: [SLP, SLP] }, "000123").files).toEqual([{ dandisetId: "000123", path: SLP }]);
  });

  it("reads nothing, and minds nothing, from a result naming no predictions", () => {
    expect(readPredictions({ model_id: "m1" }, "000123")).toEqual({ files: [], ignored: [] });
  });

  it.each<[unknown, string]>([
    [null, "the result is null, not an object"],
    [[SLP], "the result is a list, not an object"],
    [SLP, `the result is "${SLP}", not an object`],
    [undefined, "the result is undefined, not an object"],
  ])("ignores a result that is %j, saying so", (result, why) => {
    expect(readPredictions(result, "000123")).toEqual({ files: [], ignored: [why] });
  });

  it("reads only the first entries of a long list, naming how many more it left out", () => {
    const paths = Array.from({ length: MAX_PREDICTIONS + 5 }, (_, i) => `${FOLDER}/p${i}.slp`);
    const { files, ignored } = readPredictions({ predictions: paths }, "000123");
    expect(files.map((f) => f.path)).toEqual(paths.slice(0, MAX_PREDICTIONS));
    expect(ignored).toEqual(["5 more after the first 100"]);
  });

  it("quotes only the start of a long string it leaves out", () => {
    const long = `derivatives/sleap/${"x".repeat(2000)}`;
    expect(readPredictions({ predictions: [long] }, "000123").ignored).toEqual([
      `"${long.slice(0, 120)}…" is longer than 1024 characters`,
    ]);
  });

  it.each<[unknown, string]>([
    ["derivatives/sleap/x.slp", 'predictions is "derivatives/sleap/x.slp", not a list'],
    [{ path: SLP }, "predictions is an object, not a list"],
    [null, "predictions is null, not a list"],
  ])("ignores predictions given as %j, saying so", (predictions, why) => {
    expect(readPredictions({ predictions }, "000123")).toEqual({ files: [], ignored: [why] });
  });

  it("keeps the files it can open and says why it left out each of the rest", () => {
    const result = {
      predictions: [
        7,
        null,
        { dandisetId: "000999", path: SLP },
        [SLP],
        "../derivatives/sleap/x.slp",
        "sub-01/elsewhere.slp",
        `${FOLDER}/notes.txt`,
        SLP,
      ],
    };
    expect(readPredictions(result, "000123")).toEqual({
      files: [{ dandisetId: "000123", path: SLP }],
      ignored: [
        "7 is not a path",
        "null is not a path",
        "an object is not a path",
        "a list is not a path",
        `"../derivatives/sleap/x.slp" has an empty, '.' or '..' segment`,
        '"sub-01/elsewhere.slp" is not under derivatives/sleap/',
        `"${FOLDER}/notes.txt" is not a .slp or .pkg.slp file`,
      ],
    });
  });
});
