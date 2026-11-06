/**
 * @file Loads CryptoVerif under Node in a context that looks like a web worker.
 *
 * @author Roberto Metere
 * @license CECILL-B
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const root = path.join(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const version = fs.readFileSync(path.join(dist, "VERSION"), "utf8").trim();

/**
 * Creates a context that looks like a web worker, whose importScripts runs
 * the scripts of dist/ in it.
 *
 * @param {Object} globals More globals for the context.
 * @return {Object} The context.
 */
function workerContext(globals: any) {
  const context = vm.createContext({
      console: console
    , WebAssembly: WebAssembly
    , TextEncoder: TextEncoder
    , TextDecoder: TextDecoder
    , atob: atob
    , setTimeout: setTimeout
    , clearTimeout: clearTimeout
    , location: { href: "http://localhost/dist/cryptoverif-worker.js" }
    , ...globals
  });
  context.self = context;
  context.importScripts = (...names) => {
    names.forEach(name => vm.runInContext(fs.readFileSync(path.join(dist, name), "utf8"), context, { filename: name }));
  };
  return context;
}
// ----------------------------------------------------------------

/**
 * Loads the engine into a context that looks like a web worker.
 *
 * @return {Object} The context, where createCryptoVerif and CryptoVerifEngine
 *   are defined, and the compiled module.
 */
function loadEngine() {
  const context = workerContext({});
  context.importScripts("cryptoverif.js");
  vm.runInContext(fs.readFileSync(path.join(dist, "CryptoVerifEngine.js"), "utf8") + "\nthis.CryptoVerifEngine = CryptoVerifEngine;", context,
    { filename: "CryptoVerifEngine.js" });
  const module = new WebAssembly.Module(fs.readFileSync(path.join(dist, "cryptoverif.wasm")));
  return { context: context, module: module };
}
// ----------------------------------------------------------------

/**
 * Runs CryptoVerif once.
 *
 * @param {Object} loaded The engine, from loadEngine.
 * @param {string} source The model.
 * @param {string} fileName Its file name.
 * @param {Object} options maxMemory (bytes, 1 GB when absent), args, files
 *   and input, as for CryptoVerifEngine.run.
 * @return {Promise<Object>} The result of the run, and its output with the
 *   path of the model in the engine replaced by the file name.
 */
function verify(loaded: any, source: string, fileName: string, options: any) {
  const defaults = {
      maxMemory: 1073741824
    , args: []
    , files: []
    , input: ""
  };
  options = {...defaults, ...options};
  let output = "";
  const engine = new loaded.context.CryptoVerifEngine({
      scope: loaded.context
    , module: loaded.module
    , maxMemory: options.maxMemory
    , onOutput: (channel, text) => {
        output += text;
      }
  });
  return engine.run(source, fileName, options.args, options.files, options.input).then(result => ({
      result: result
    , output: output.split(loaded.context.CryptoVerifEngine.WORK_DIR + "/" + loaded.context.CryptoVerifEngine.safeName(fileName)).join(fileName)
  }));
}
// ----------------------------------------------------------------

/**
 * Lists the files of a folder, recursively.
 *
 * @param {string} folder The folder.
 * @param {RegExp} pattern The names to keep.
 * @return {Array<string>} The files, with the folder.
 */
function list(folder: string, pattern: RegExp): string[] {
  const result = [];
  fs.readdirSync(folder, { withFileTypes: true }).forEach(entry => {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      result.push(...list(file, pattern));
    } else if (pattern.test(entry.name)) {
      result.push(file);
    }
  });
  return result;
}
// ----------------------------------------------------------------

/**
 * Unpacks the CryptoVerif distribution of ../upstream/ into a temporary folder.
 *
 * @return {Object} The folder, and the examples for the channel and the
 *   oracle front ends (.cv and .ocv files) in it, as paths from the folder,
 *   sorted.
 */
function unpackExamples() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cryptoverif-examples-"));
  execFileSync("tar", ["xzf", path.join(root, "..", "upstream", "cryptoverif" + version + ".tar.gz"), "-C", folder, "--strip-components=1"]);
  const files = list(path.join(folder, "examples"), /\.o?cv$/).map(file => path.relative(folder, file).split(path.sep).join("/")).sort();
  return { folder: folder, files: files };
}
// ----------------------------------------------------------------

/**
 * Gives where the expected output of an example is kept.
 *
 * @param {string} example The example, as a path in the distribution.
 * @return {string} Its file in tests/expected.
 */
function expectedFile(example: string): string {
  return path.join(import.meta.dirname, "expected", example.replace(/^examples\//, "") + ".out");
}
// ----------------------------------------------------------------

/**
 * Counts the checks, and prints each one.
 *
 * @return {Object} check(ok, label), and failures() for the exit code.
 */
function checker() {
  let failures = 0;
  return {
      check: (ok, label) => {
        console.log((ok ? "PASS " : "FAIL ") + label);
        if (!ok) {
          failures++;
        }
      }
    , failures: () => failures
  };
}
// ----------------------------------------------------------------

export {
    root
  , dist
  , version
  , workerContext
  , loadEngine
  , verify
  , list
  , unpackExamples
  , expectedFile
  , checker
};
