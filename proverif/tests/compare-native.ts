/**
 * @file Compares ProVerif WASM vs native ProVerif built from the same sources.
 *
 * @author Roberto Metere
 * @license GPL-2.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { version, loadEngine, verify, unpackExamples, expectedFile } from "./engine.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const [native, pattern] = args.filter(arg => arg !== "--write");
if (!native) {
  console.log("Usage: node tests/compare-native.ts [--write] path/to/proverif [pattern]");
  process.exit(2);
}

/**
 * Runs the native ProVerif on one example, with its two output channels in
 * one, as the engine gives them, and newlines on its standard input, as the
 * engine answers.
 *
 * @param {string} folder The folder of the distribution.
 * @param {string} example The example, from the folder.
 * @return {Object} The output, the exit code and the duration.
 */
function runNative(folder: string, example: string) {
  const started = Date.now();
  let output;
  let exitCode = 0;
  
  try {
    output = execFileSync("/bin/sh", ["-c", "exec \"$0\" \"$1\" 2>&1", path.resolve(native), example], {
        cwd: folder
      , encoding: "utf8"
      , input: "\n".repeat(100)
      , maxBuffer: 256*1048576
      , timeout: 1800000
    });
  } catch (e: any) {
    output = e.stdout || "";
    exitCode = e.status;
  }
  
  return { output: output.split(example).join(path.basename(example)), exitCode: exitCode, ms: Date.now() - started };
}
// ----------------------------------------------------------------

async function main() {
  const loaded = loadEngine();
  const { folder, files } = unpackExamples();
  const index = { proverif: version, examples: {} };
  let same = 0;
  let nativeMs = 0;
  let engineMs = 0;
  const chosen = files.filter(file => !pattern || file.includes(pattern));
  for (const example of chosen) {
    const expected = runNative(folder, example);
    const run = await verify(loaded, fs.readFileSync(path.join(folder, example), "utf8"), path.basename(example), {});
    const ok = run.result.status === "done" && run.result.exitCode === expected.exitCode && run.output === expected.output;
    same += ok ? 1 : 0;
    nativeMs += expected.ms;
    engineMs += run.result.ms;
    console.log((ok ? "same " : "DIFF ") + example + ": exit " + run.result.exitCode + ", " + run.result.ms + " ms, native "
      + expected.ms + " ms");
    if (write) {
      fs.mkdirSync(path.dirname(expectedFile(example)), { recursive: true });
      fs.writeFileSync(expectedFile(example), expected.output);
      index.examples[example] = { exit: expected.exitCode, ms: expected.ms };
    }
  }
  if (write) {
    fs.writeFileSync(path.join(import.meta.dirname, "expected", "index.json"), JSON.stringify(index, null, 2) + "\n");
  }
  fs.rmSync(folder, { recursive: true, force: true });
  console.log(same + " of " + chosen.length + " examples give the same output; " + (engineMs/1000).toFixed(1) + " s here, "
    + (nativeMs/1000).toFixed(1) + " s native");
  process.exit(same === chosen.length ? 0 : 1);
}
// ----------------------------------------------------------------

main();
