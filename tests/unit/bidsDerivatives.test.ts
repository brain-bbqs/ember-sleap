import { describe, expect, it } from "vitest";
import {
  BIDSIGNORE,
  BIDSIGNORE_PATH,
  BIDS_VERSION,
  DATASET_DESCRIPTION_PATH,
  DERIVATIVES_ROOT,
  datasetDescription,
  entitiesFromPath,
  isBidsLabel,
  isDerivativePath,
  isLabelsPath,
  labelsPathPrefix,
  labelsSavePath,
  numberedLabelsPath,
  poseFileName,
  posePath,
  suggestedEntities,
  type BidsEntities,
  type PoseDescLabel,
  type PoseEntities,
  type PoseExtension,
} from "../../src/lib/bidsDerivatives";

describe("isBidsLabel", () => {
  it.each([
    ["01", true],
    ["NONE", true],
    ["mouse3", true],
    ["", false],
    ["a-b", false],
    ["a_b", false],
    ["a b", false],
  ])("%j is a label: %s", (value, expected) => {
    expect(isBidsLabel(value)).toBe(expected);
  });
});

describe("entitiesFromPath", () => {
  it.each<[string, BidsEntities | null]>([
    ["sub-NONE/sub-NONE_sourcedata.slp", { sub: "NONE" }],
    ["sub-01/ses-02/beh/labels.slp", { sub: "01", ses: "02" }],
    ["rawdata/sub-01_ses-02_labels.slp", { sub: "01", ses: "02" }],
    ["sub-01_labels.pkg.slp", { sub: "01" }],
    ["sub-01.slp", { sub: "01" }],
    // A folder entity wins over the file name's own.
    ["sub-01/ses-a/sub-99_ses-b_labels.slp", { sub: "01", ses: "a" }],
    // A folder subject with the session only in the file name.
    ["sub-01/sub-01_ses-03_labels.slp", { sub: "01", ses: "03" }],
    // A folder session that is not a label, with a usable one in the file name.
    ["sub-01/ses-day-1/sub-01_ses-day1_labels.slp", { sub: "01", ses: "day1" }],
    // A folder that only starts like a session does not name one.
    ["sessions/sub-01_labels.slp", { sub: "01" }],
    // A folder that names its entities among others, as `dandi organize` names external files' folders.
    ["sub-01/sub-01_ses-day1_behavior+image/labels.slp", { sub: "01", ses: "day1" }],
    ["derivatives/sleap/sub-01/beh/sub-01_desc-predictions_pose.slp", { sub: "01" }],
    ["labels/train.pkg.slp", null],
    ["derivatives/sleap/models/mice-v1/train.pkg.slp", null],
    // Not a label: hyphens and underscores end it, so neither of these names a subject.
    ["sub-a-b/labels.slp", null],
    ["mysub-01_labels.slp", null],
    // A session that is named but not a label makes the page ask rather than drop it.
    ["sub-01/ses-day-1/labels.slp", null],
    ["sub-01/sub-01_ses-a-b_labels.slp", null],
    ["sub-YutaMouse20/sub-YutaMouse20_ses-YutaMouse20-140321_behavior.slp", null],
    ["sub-01/ses-/labels.slp", null],
  ])("%s", (path, expected) => {
    expect(entitiesFromPath(path)).toEqual(expected);
  });
});

describe("suggestedEntities", () => {
  it.each<[string, Partial<BidsEntities>]>([
    ["sub-01/ses-02/beh/labels.slp", { sub: "01", ses: "02" }],
    // Whatever BIDS would refuse in a label is dropped, so the suggestion is one the page can save to.
    ["sub-01/ses-day-1/labels.slp", { sub: "01", ses: "day1" }],
    ["sub-AgedB6-2268/session1.mp4", { sub: "AgedB62268" }],
    [
      "sub-YutaMouse20/sub-YutaMouse20_ses-YutaMouse20-140321_behavior.slp",
      { sub: "YutaMouse20", ses: "YutaMouse20140321" },
    ],
    ["sub-01.slp", { sub: "01" }],
    // A label with nothing usable in it is no suggestion at all.
    ["sub-01/ses-/labels.slp", { sub: "01" }],
    ["sub-_x/labels.slp", {}],
    ["raw/labels.slp", {}],
  ])("%s", (path, expected) => {
    expect(suggestedEntities(path)).toEqual(expected);
  });
});

describe("pose file names and paths", () => {
  it.each<[PoseEntities, PoseDescLabel, PoseExtension, string]>([
    [{ sub: "01" }, "labels", "slp", "derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.slp"],
    // The kept entities follow BIDS order whatever order they are given in.
    [
      { recording: "a", run: "2", acq: "top", task: "reach", ses: "02", sub: "01" },
      "labelsCam",
      "slp",
      "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_task-reach_acq-top_run-2_recording-a_desc-labelsCam_pose.slp",
    ],
    [
      { sub: "01", ses: "02" },
      "predictions",
      "nwb",
      "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_desc-predictions_pose.nwb",
    ],
    [
      { sub: "01", ses: "02" },
      "labels",
      "pkg.slp",
      "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_desc-labels_pose.pkg.slp",
    ],
  ])("%j %s %s", (entities, desc, ext, expected) => {
    expect(posePath(entities, desc, ext)).toBe(expected);
    expect(posePath(entities, desc, ext).endsWith(`/${poseFileName(entities, desc, ext)}`)).toBe(true);
  });
});

describe("isDerivativePath", () => {
  it.each([
    ["derivatives/sleap/sub-01/beh/x.slp", true],
    ["derivatives/sleapy/x.slp", false],
    ["derivatives/other/x.slp", false],
    ["sub-01/x.slp", false],
  ])("%s: %s", (path, expected) => {
    expect(isDerivativePath(path)).toBe(expected);
  });
});

describe("isLabelsPath", () => {
  it.each([
    ["derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.slp", true],
    ["derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_acq-top_desc-labelsCamTop_pose.pkg.slp", true],
    ["derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.SLP", true],
    ["derivatives/sleap/sub-01/beh/sub-01_desc-predictions_pose.slp", false],
    ["derivatives/sleap/sub-01/beh/sub-01_desc-labels-x_pose.slp", false],
    ["derivatives/sleap/sub-01/beh/sub-01_desc-labels_pose.nwb", false],
    ["derivatives/sleap/sub-01/beh/sub-01_desc-trainingsetCamTop20261122153000_pose.pkg.slp", false],
    ["derivatives/sleap/models/mice-v1/train.pkg.slp", false],
    ["sub-01/beh/sub-01_desc-labels_pose.slp", false],
  ])("%s: %s", (path, expected) => {
    expect(isLabelsPath(path)).toBe(expected);
  });
});

describe("labelsSavePath", () => {
  const entities: BidsEntities = { sub: "01", ses: "02" };
  const at = (name: string) => `derivatives/sleap/sub-01/ses-02/beh/${name}`;

  it.each([
    // The rest of a source's name tells its labels apart from another source's.
    ["sub-01/ses-02/beh/cam-top.slp", "cam-top.slp", at("sub-01_ses-02_desc-labelsCamTop_pose.slp")],
    ["sub-01/ses-02/beh/cam-side.slp", "cam-side.slp", at("sub-01_ses-02_desc-labelsCamSide_pose.slp")],
    ["sub-01/ses-02/sub-01_ses-02_sourcedata.slp", "x.slp", at("sub-01_ses-02_desc-labelsSourcedata_pose.slp")],
    ["sub-01/ses-02/fly_1.v2.slp", "x.slp", at("sub-01_ses-02_desc-labelsFly1V2_pose.slp")],
    // Behavior's own entities are kept, in BIDS order; a generic trailing "pose" or "labels" is not.
    [
      "sub-01/ses-02/beh/sub-01_ses-02_task-reach_acq-top_pose.slp",
      "x.slp",
      at("sub-01_ses-02_task-reach_acq-top_desc-labels_pose.slp"),
    ],
    [
      "sub-01/ses-02/sub-01_ses-02_run-1_recording-a_task-b_labels.slp",
      "x.slp",
      at("sub-01_ses-02_task-b_run-1_recording-a_desc-labels_pose.slp"),
    ],
    ["sub-01/labels.slp", "labels.slp", at("sub-01_ses-02_desc-labels_pose.slp")],
    // An entity that is not usable as one stays in the desc, so it still tells sources apart.
    [
      "sub-01/sub-01_task-a-b_run-x_acq-top_acq-side.slp",
      "x.slp",
      at("sub-01_ses-02_acq-top_desc-labelsTaskABRunXAcqSide_pose.slp"),
    ],
    ["sub-01/sub-01_labels_pose_v2.slp", "x.slp", at("sub-01_ses-02_desc-labelsLabelsPoseV2_pose.slp")],
    // Folders below the subject and session are part of the word, datatype folders aside.
    ["sub-01/ses-02/camA/labels.slp", "x.slp", at("sub-01_ses-02_desc-labelsCamA_pose.slp")],
    ["sub-01/ses-02/beh/top-view/day_1.slp", "x.slp", at("sub-01_ses-02_desc-labelsTopViewDay1_pose.slp")],
    // A source's own desc gives way to the labels file's, keeping what it adds after labels or predictions.
    [
      "derivatives/sleap/sub-01/beh/sub-01_desc-predictions_pose.slp",
      "x.slp",
      at("sub-01_ses-02_desc-labels_pose.slp"),
    ],
    [
      "derivatives/sleap/sub-01/beh/sub-01_acq-top_desc-predictionsCamTop_pose.slp",
      "x.slp",
      at("sub-01_ses-02_acq-top_desc-labelsCamTop_pose.slp"),
    ],
    ["sub-01/sub-01_desc-top_cam.slp", "x.slp", at("sub-01_ses-02_desc-labelsTopCam_pose.slp")],
    ["sub-01/sub-01_desc-a-b_desc-c.slp", "x.slp", at("sub-01_ses-02_desc-labelsABDescC_pose.slp")],
    [
      "derivatives/sleap/models/mice-v1/train.pkg.slp",
      "train.pkg.slp",
      at("sub-01_ses-02_desc-labelsTrain_pose.pkg.slp"),
    ],
    // A package keeps being a package even when the app names the save differently, and vice versa.
    ["sub-01/train.pkg.slp", "train.slp", at("sub-01_ses-02_desc-labelsTrain_pose.pkg.slp")],
    ["sub-01/labels.slp", "export.PKG.SLP", at("sub-01_ses-02_desc-labels_pose.pkg.slp")],
  ])("%s saved as %s goes to %s", (source, name, expected) => {
    expect(labelsSavePath(source, name, entities)).toBe(expected);
  });

  it("places a source with no session in its subject's folder", () => {
    expect(labelsSavePath("sub-NONE/sub-NONE_sourcedata.slp", "x.slp", { sub: "NONE" })).toBe(
      "derivatives/sleap/sub-NONE/beh/sub-NONE_desc-labelsSourcedata_pose.slp",
    );
  });

  it.each([
    ["two cameras of one session", "sub-01/ses-02/cam1.slp", "sub-01/ses-02/cam2.slp"],
    ["two tasks", "sub-01_ses-02_task-a_run-1_beh.slp", "sub-01_ses-02_task-b_run-2_beh.slp"],
    ["two acquisitions", "sub-01_ses-02_acq-top_run-1.pkg.slp", "sub-01_ses-02_acq-side_run-1.pkg.slp"],
    ["two camera folders", "sub-01/ses-02/camA/labels.slp", "sub-01/ses-02/camB/labels.slp"],
    ["two descs", "sub-01_ses-02_desc-top_cam.slp", "sub-01_ses-02_desc-side_cam.slp"],
  ])("gives %s their own labels files", (_, first, second) => {
    expect(labelsSavePath(first, "x.slp", entities)).not.toBe(labelsSavePath(second, "x.slp", entities));
  });

  it.each([
    "derivatives/sleap/sub-09/beh/sub-09_desc-labels_pose.slp",
    "derivatives/sleap/sub-09/beh/sub-09_acq-top_desc-labelsCamTop_pose.pkg.slp",
  ])("saves the labels file %s back over itself", (source) => {
    expect(labelsSavePath(source, "whatever.pkg.slp", entities)).toBe(source);
  });

  it("names a labels file that its next save goes back over", () => {
    const first = labelsSavePath("sub-01/ses-02/beh/cam-top.slp", "cam-top.slp", entities);
    expect(isLabelsPath(first)).toBe(true);
    expect(labelsSavePath(first, "cam-top.slp", entities)).toBe(first);
  });
});

describe("predictions and training packages as sources", () => {
  it.each([
    // Proofread predictions save to the labels file their source's own save went to.
    [
      "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_desc-predictionsCamTop_pose.slp",
      "x.slp",
      "derivatives/sleap/sub-01/ses-02/beh/sub-01_ses-02_desc-labelsCamTop_pose.slp",
    ],
    // A training package's labels take its source's word, and stay a package.
    [
      "derivatives/sleap/sub-01/beh/sub-01_desc-trainingsetCamTop20261122153007_pose.pkg.slp",
      "snapshot.pkg.slp",
      "derivatives/sleap/sub-01/beh/sub-01_desc-labelsCamTop_pose.pkg.slp",
    ],
  ])("saves %s under its source's word", (source, name, expected) => {
    expect(labelsSavePath(source, name, entitiesFromPath(source)!)).toBe(expected);
  });

  it("keeps a desc that only starts like a training set's as a word", () => {
    expect(labelsSavePath("sub-01/sub-01_desc-trainingsetA_cam.slp", "x.slp", { sub: "01" })).toBe(
      "derivatives/sleap/sub-01/beh/sub-01_desc-labelsTrainingsetACam_pose.slp",
    );
  });
});

describe("numbered labels paths", () => {
  const target = "derivatives/sleap/sub-01/beh/sub-01_desc-labelsCamTop_pose.pkg.slp";

  it("numbers the desc word, so the alternative is still a labels file", () => {
    expect(numberedLabelsPath(target, 2)).toBe("derivatives/sleap/sub-01/beh/sub-01_desc-labelsCamTop2_pose.pkg.slp");
    expect(isLabelsPath(numberedLabelsPath(target, 2))).toBe(true);
  });

  it("shares a prefix with every alternative", () => {
    expect(labelsPathPrefix(target)).toBe("derivatives/sleap/sub-01/beh/sub-01_desc-labelsCamTop");
    expect(numberedLabelsPath(target, 12).startsWith(labelsPathPrefix(target))).toBe(true);
  });
});

describe("the derivative dataset's files", () => {
  it("places them at the derivative dataset's root", () => {
    expect(DERIVATIVES_ROOT).toBe("derivatives/sleap");
    expect(DATASET_DESCRIPTION_PATH).toBe("derivatives/sleap/dataset_description.json");
    expect(BIDSIGNORE_PATH).toBe("derivatives/sleap/.bidsignore");
  });

  it("ignores what BIDS validators do not know", () => {
    expect(BIDSIGNORE.split("\n").filter(Boolean)).toEqual(["*.slp", "*.ckpt", "models/"]);
  });

  it("describes a derivative generated by both apps from this dandiset", () => {
    const description = datasetDescription({
      dandisetId: "000398",
      webUrl: "https://dandi.emberarchive.org",
      appVersion: "0.1.0",
      sleapVersion: "0.0.0-stand-in",
    });
    expect(description).toEqual({
      Name: "SLEAP pose estimation for dandiset 000398",
      BIDSVersion: BIDS_VERSION,
      DatasetType: "derivative",
      GeneratedBy: [
        { Name: "ember-sleap", Version: "0.1.0", CodeURL: "https://github.com/brain-bbqs/ember-sleap" },
        { Name: "sleap-app", Version: "0.0.0-stand-in", CodeURL: "https://github.com/talmolab/sleap-app" },
      ],
      SourceDatasets: [{ URL: "https://dandi.emberarchive.org/dandiset/000398/draft" }],
    });
  });
});
