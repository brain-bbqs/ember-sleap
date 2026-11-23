// `npm run check-model-index -- <models.json> [...]`: checks model index files the way the page reads
// them, before one is published to the index dandiset (docs/MODEL_INDEX.md). Node 20 cannot import
// TypeScript, so the parser is loaded through Vite's module runner: the same code the page runs.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Checks one file, printing what it lists and every problem; true when it has none. */
async function checkFile(file, checkModelIndex) {
  // npm runs a script from the package root, so a relative path is read from where it was typed.
  const target = path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
  let text;
  try {
    text = await readFile(target, "utf8");
  } catch (e) {
    console.error(`Could not read ${file}: ${e.message}`);
    return false;
  }
  const { models, problems } = checkModelIndex(text);
  for (const card of models) {
    const folders = new Set(card.files.map((f) => f.folder)).size;
    console.log(`  ${card.id}: ${card.name}, ${plural(folders, "model folder")}`);
  }
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(`${file}: ${plural(problems.length, "problem")}.`);
    return false;
  }
  console.log(`${file}: ${plural(models.length, "model")}, no problems.`);
  return true;
}

async function main(files) {
  if (files.length === 0) {
    console.error("Usage: npm run check-model-index -- <models.json> [more.json ...]");
    return 2;
  }
  const parser = fileURLToPath(new URL("../src/lib/modelIndex.ts", import.meta.url));
  const { module } = await runnerImport(parser);
  let clean = true;
  for (const file of files) clean = (await checkFile(file, module.checkModelIndex)) && clean;
  return clean ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
