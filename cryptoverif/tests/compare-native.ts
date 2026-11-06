/**
 * @file Compares CryptoVerif WASM vs native CryptoVerif built from the same sources.
 *
 * @author Roberto Metere
 * @license CECILL-B
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { version, loadEngine, verify, unpackExamples, expectedFile } from "./engine.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const at = args.indexOf("--limit");
const limit = at >= 0 ? Number(args.splice(at, 2)[1]) : 10;
const [native, pattern] = args.filter(arg => arg !== "--write");
if (!native || !(limit > 0)) {
  console.log("Usage: node tests/compare-native.ts [--write] [--limit s] path/to/cryptoverif [pattern]");
  process.exit(2);
}

/**
 * Runs the native CryptoVerif on one example, with its two output channels in
 * one, as the engine gives them, and an empty standard input, as the engine
 * gives it when a run has no commands.
 *
 * @param {string} folder The folder of the distribution.
 * @param {string} example The example, from the folder.
 * @return {Object} The output, the exit code and the duration, or slow
 *   when the native CryptoVerif did not finish within the limit.
 */
function runNative(folder: string, example: string) {
  const started = Date.now();
  let output;
  let exitCode = 0;
  
  try {
    output = execFileSync("/bin/sh", ["-c", "exec \"$0\" \"$1\" 2>&1", path.resolve(native), example], {
        cwd: folder
      , encoding: "utf8"
      , input: ""
      , maxBuffer: 256*1048576
      , timeout: limit*1000
    });
  } catch (e: any) {
    if (e.signal) {
      return { slow: true, ms: Date.now() - started };
    }
    output = e.stdout || "";
    exitCode = e.status;
  }
  
  return { output: output.split(example).join(path.basename(example)), exitCode: exitCode, ms: Date.now() - started };
}
// ----------------------------------------------------------------

async function main() {
  const loaded = loadEngine();
  const { folder, files } = unpackExamples();
  const index = { cryptoverif: version, limit: limit, examples: {} };
  let same = 0;
  let nativeMs = 0;
  let engineMs = 0;
  const chosen = files.filter(file => !pattern || file.includes(pattern));
  for (const example of chosen) {
    const expected = runNative(folder, example);
    if (expected.slow) {
      console.log("slow " + example + ": native over " + limit + " s, left out");
      index.examples[example] = { slow: true };
      continue;
    }
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
  const compared = chosen.filter(example => !index.examples[example] || !index.examples[example].slow).length;
  console.log(same + " of " + compared + " examples give the same output; " + (engineMs/1000).toFixed(1) + " s here, "
    + (nativeMs/1000).toFixed(1) + " s native");
  process.exit(same === compared ? 0 : 1);
}
// ----------------------------------------------------------------

main();
