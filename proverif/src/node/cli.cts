#!/usr/bin/env node

/**
 * @file ProVerif for WebAssembly as a npx command:
 *
 *   - npx proverif-wasm nspk.pv
 *   - npx proverif-wasm -lib crypto model.pv
 *   - PROVERIF_WASM_MEMORY=512 npx proverif-wasm big.pv
 *
 * The libraries named by -lib are read from disk, with the extension .pvl
 * when it is left out. PROVERIF_WASM_MEMORY environment variable sets the
 * max memory in MB, 0 (the default) for the largest.
 * The output names the model by its path, and the command exits with
 * the exit code of ProVerif.
 *
 * @author Roberto Metere
 * @license GPL-2.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import * as proverif from "./index.cts";

/**
 * The extension of the libraries.
 *
 * @type {string}
 */
const LIBRARY_EXTENSION = ".pvl";

/**
 * Prints the usage, and exits.
 *
 * @param {number} code The exit code.
 */
function usage(code: number) {
  console.error("Usage: proverif-wasm [options of proverif] model.pv");
  console.error("ProVerif 2.05 compiled to WebAssembly. PROVERIF_WASM_MEMORY sets the memory limit in MB (0: 4 GB).");
  process.exit(code);
}
// ----------------------------------------------------------------

/**
 * @param {string} name A name of a file of the run.
 * @return {string} The name it has in /work, as the engine writes it.
 */
function workName(name: string): string {
  return String(name).replace(/[^A-Za-z0-9._-]/g, "_");
}
// ----------------------------------------------------------------

/**
 * Reads the library that -lib names, as ProVerif finds it.
 *
 * @param {string} name The name given to -lib.
 * @return {Object} The file of the run, {name, text}, and the name to give
 *   ProVerif instead.
 */
function readLibrary(name: string) {
  const file = fs.existsSync(name) || name.endsWith(LIBRARY_EXTENSION) ? name : name + LIBRARY_EXTENSION;
  
  if (!fs.existsSync(file)) {
    console.error("Cannot find the library " + name);
    process.exit(2);
  }
  
  const base = workName(path.basename(file));
  
  return { file: { name: base, text: fs.readFileSync(file, "utf8") }, arg: proverif.WORK_DIR + "/" + base };
}
// ----------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("--help")) {
  usage(argv.length === 0 ? 2 : 0);
}
const model = argv[argv.length - 1];
if (!fs.existsSync(model)) {
  console.error("Cannot find the model " + model);
  process.exit(2);
}
const args = [];
const files = [];
for (let i = 0; i < argv.length - 1; i++) {
  if (argv[i] === "-lib" && i + 1 < argv.length - 1) {
    const library = readLibrary(argv[++i]);
    files.push(library.file);
    args.push("-lib", library.arg);
  } else {
    args.push(argv[i]);
  }
}
const fileName = workName(path.basename(model));
const inWork = proverif.WORK_DIR + "/" + fileName;
const memory = Number(process.env.PROVERIF_WASM_MEMORY || 0);

proverif.run(fs.readFileSync(model, "utf8"), {
    fileName: fileName
  , args: args
  , files: files
  , maxMemory: memory > 0 ? memory*1024*1024 : 0
    // I name the model by its path on disk, as the native command does
  , onOutput: (channel, text) => (channel === "stderr" ? process.stderr : process.stdout).write(text.split(inWork).join(model))
}).then(result => {
  if (result.status !== "done") {
    console.error(result.message);
    process.exitCode = result.exitCode || 1;
  } else {
    process.exitCode = result.exitCode;
  }
});
