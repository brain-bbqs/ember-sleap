// `npm run check-model-index`, run as Node runs it: a plain ESM script that loads the TypeScript
// parser through Vite's module runner, so it works on Node 20, which cannot import TypeScript.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(ROOT, "scripts/check-model-index.mjs");
const EXAMPLE = "docs/examples/models.json";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the script from `cwd`, as npm would after being started in `initCwd`. */
function check(args: string[], { cwd = ROOT, initCwd = ROOT } = {}): Promise<Run> {
  return new Promise((resolve) => {
    const env = { ...process.env, INIT_CWD: initCwd };
    execFile(process.execPath, [SCRIPT, ...args], { cwd, env }, (error, stdout, stderr) => {
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
}

const scratch = mkdtempSync(path.join(tmpdir(), "check-model-index-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function scratchFile(name: string, text: string): string {
  const file = path.join(mkdtempSync(path.join(scratch, "case-")), name);
  writeFileSync(file, text);
  return file;
}

describe("npm run check-model-index", { timeout: 30_000 }, () => {
  it("passes the example index, listing each model with its folders", async () => {
    const run = await check([EXAMPLE], { cwd: scratch });
    expect(run).toEqual({
      code: 0,
      stdout:
        "  index:fly-single-instance: Fly single instance (1.0.0), 1 model folder\n" +
        "  index:mouse-topdown: Mouse top-down (2.1.0), 2 model folders\n" +
        `${EXAMPLE}: 2 models, no problems.\n`,
      stderr: "",
    });
  });

  it("prints each problem in a broken copy and fails", async () => {
    const index = JSON.parse(readFileSync(path.join(ROOT, EXAMPLE), "utf8")) as {
      models: { files: { path: string; sha256?: string }[] }[];
    };
    const [fly, mouse] = index.models;
    fly.files[0].sha256 = "not a hash";
    mouse.files = mouse.files.filter((file) => file.path.startsWith("centroid/"));
    const file = scratchFile("models.json", JSON.stringify(index));

    const run = await check([file]);
    expect(run.code).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr.split("\n")).toEqual([
      'Entry "fly-single-instance": file sha256 must be 64 lowercase hex digits.',
      'Entry "mouse-topdown": a top-down model (centroid and centered_instance) needs two model folders, one per head, not 1.',
      `${file}: 2 problems.`,
      "",
    ]);
  });

  it.each([
    ["text that is not JSON", "{ models: [] }", /^Not JSON: /],
    ["JSON that is not an index", '{ "schema": "ember-sleap.models/v2", "models": [] }', /^Not a model index: /],
  ])("fails on %s", async (_label, text, problem) => {
    const run = await check([scratchFile("models.json", text)]);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(problem);
    expect(run.stderr).toMatch(/: 1 problem\.\n$/);
  });

  it("checks every file it is given, and fails when any of them has a problem", async () => {
    const broken = scratchFile("models.json", JSON.stringify({ schema: "ember-sleap.models/v1", models: ["x"] }));
    const run = await check([broken, EXAMPLE]);
    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(new RegExp(`\\n${EXAMPLE}: 2 models, no problems\\.\\n$`));
    expect(run.stderr).toBe(`Entry #0: id must be a non-empty string.\n${broken}: 1 problem.\n`);
  });

  it("fails on a file it cannot read", async () => {
    const run = await check(["no-such-models.json"]);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/^Could not read no-such-models\.json: ENOENT/);
  });

  it("says how to use it when given no file", async () => {
    expect(await check([])).toEqual({
      code: 2,
      stdout: "",
      stderr: "Usage: npm run check-model-index -- <models.json> [more.json ...]\n",
    });
  });
});
