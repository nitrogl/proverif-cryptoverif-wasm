#!/usr/bin/env node

/**
 * @file CryptoVerif for WebAssembly as a npx command:
 *
 *   - npx cryptoverif-wasm fdh.ocv
 *   - npx cryptoverif-wasm -lib mylib model.cv
 *   - npx cryptoverif-wasm model.ocv < commands.txt
 *   - CRYPTOVERIF_WASM_MEMORY=512 npx cryptoverif-wasm big.cv
 *
 * The libraries named by -lib are read from disk, with the extension of the
 * front end (.cvl for channels, .ocvl for oracles) when it is left out;
 * without -lib, CryptoVerif uses its default libraries, which the module
 * holds. When the standard input is not a terminal, it is what CryptoVerif
 * reads: the commands of its interactive mode. CRYPTOVERIF_WASM_MEMORY
 * environment variable sets the max memory in MB, 0 (the default) for the
 * largest.
 * The output names the model by its path, and the command exits with
 * the exit code of CryptoVerif.
 *
 * @author Roberto Metere
 * @license CECILL-B
 */

import fs from "node:fs";
import path from "node:path";
import * as cryptoverif from "./index.cts";

/**
 * Prints the usage, and exits.
 *
 * @param {number} code The exit code.
 */
function usage(code: number) {
  console.error("Usage: cryptoverif-wasm [options of cryptoverif] model.cv|model.ocv");
  console.error("CryptoVerif 2.13 compiled to WebAssembly. CRYPTOVERIF_WASM_MEMORY sets the memory limit in MB (0: 4 GB).");
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
 * Reads the library that -lib names, as CryptoVerif finds it.
 *
 * @param {string} name The name given to -lib.
 * @param {string} extension The extension of the libraries of the front
 *   end, ".cvl" or ".ocvl".
 * @return {Object} The file of the run, {name, text}, and the name to give
 *   CryptoVerif instead, without the extension, which it adds.
 */
function readLibrary(name: string, extension: string) {
  const file = name.endsWith(extension) ? name : name + extension;
  
  if (!fs.existsSync(file)) {
    console.error("Cannot find the library " + file);
    process.exit(2);
  }
  
  const base = workName(path.basename(file));
  
  return { file: { name: base, text: fs.readFileSync(file, "utf8") }, arg: cryptoverif.WORK_DIR + "/" + base.slice(0, -extension.length) };
}
// ----------------------------------------------------------------

/**
 * Reads the standard input, when it is not a terminal.
 *
 * @return {string} What it holds, or nothing.
 */
function readInput(): string {
  if (process.stdin.isTTY) {
    return "";
  }
  try {
    return fs.readFileSync(0, "utf8");
  } catch (e) {
    return "";
  }
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
const extension = model.endsWith(".ocv") ? ".ocvl" : ".cvl";
const args = [];
const files = [];
for (let i = 0; i < argv.length - 1; i++) {
  if (argv[i] === "-lib" && i + 1 < argv.length - 1) {
    const library = readLibrary(argv[++i], extension);
    files.push(library.file);
    args.push("-lib", library.arg);
  } else {
    args.push(argv[i]);
  }
}
const fileName = workName(path.basename(model));
const inWork = cryptoverif.WORK_DIR + "/" + fileName;
const memory = Number(process.env.CRYPTOVERIF_WASM_MEMORY || 0);

cryptoverif.run(fs.readFileSync(model, "utf8"), {
    fileName: fileName
  , args: args
  , files: files
  , input: readInput()
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
