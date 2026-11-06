/**
 * @file CryptoVerif as a module for Node (version 18+).
 *
 * The engine of dist/ is made for web workers: this module loads it into a
 * context that looks like one, compiles cryptoverif.wasm once, and runs each
 * model in a new instance, as a page would in a browser.
 *
 * @author Roberto Metere
 * @license CECILL-B
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * The folder of the engine.
 *
 * @type {string}
 */
const DIST: string = path.join(__dirname, "..", "dist");

/**
 * The context where the engine is loaded, and the compiled module, once
 * loaded.
 *
 * @type {Object}
 */
let loaded: any = null;

/**
 * Loads the engine, once: cryptoverif.js and CryptoVerifEngine.js in a
 * context that looks like a web worker, and cryptoverif.wasm, compiled.
 *
 * @return {Object} {context, module}: the context, where CryptoVerifEngine
 *   and createCryptoVerif are defined, and the module.
 */
function load() {
  if (loaded === null) {
    const context = vm.createContext({
        console: console
      , WebAssembly: WebAssembly
      , TextDecoder: TextDecoder
      , TextEncoder: TextEncoder
      , atob: atob
      , setTimeout: setTimeout
      , clearTimeout: clearTimeout
      , location: { href: "file://" + DIST + "/" }
    });
    context.self = context;
    context.importScripts = () => {};
    
    vm.runInContext(fs.readFileSync(path.join(DIST, "cryptoverif.js"), "utf8"), context, { filename: "cryptoverif.js" });
    vm.runInContext(fs.readFileSync(path.join(DIST, "CryptoVerifEngine.js"), "utf8") + "\nthis.CryptoVerifEngine = CryptoVerifEngine;", context, { filename: "CryptoVerifEngine.js" });
    
    loaded = { context: context, module: new WebAssembly.Module(fs.readFileSync(path.join(DIST, "cryptoverif.wasm"))) };
  }
  return loaded;
}
// ----------------------------------------------------------------

/**
 * Proves a model with CryptoVerif.
 *
 * @param {string} source The model.
 * @param {Object} options The options of the run, all optional.
 * @param {string} options.fileName The name of the model ("model.cv"); its
 *   extension chooses the front end, .ocv for oracles and .cv for channels.
 * @param {Array<string>} options.args More command line options, before the
 *   name of the model.
 * @param {Array<Object>} options.files Other files of the run, as {name,
 *   text}, written in /work (WORK_DIR) next to the model.
 * @param {string} options.input What CryptoVerif reads on its standard
 *   input: the commands of the interactive mode, one per line.
 * @param {number} options.maxMemory The memory limit in bytes; 0 for the
 *   largest, 4 GB (1 GB when not given).
 * @param {function(string, string)} options.onOutput Receives the output as
 *   it comes, line by line, with its channel ("stdout" or "stderr").
 * @param {function(number, number)} options.onMemory Called each time the
 *   heap grows.
 * @return {Promise<Object>} The result: {status, exitCode, message, bytes,
 *   limit, ms}, as CryptoVerifEngine.run gives it.
 */
function run(source: string, options: { fileName?: string; args?: string[]; files?: any[]; input?: string; maxMemory?: number; onOutput?: ((arg0: string, arg1: string) => any); onMemory?: ((arg0: number, arg1: number) => any) } = {}) {
  const engine = load();
  const instance = new engine.context.CryptoVerifEngine({
      scope: engine.context
    , module: engine.module
    , maxMemory: typeof options.maxMemory === "number" ? options.maxMemory : engine.context.CryptoVerifEngine.DEFAULT_MEMORY
    , onOutput: options.onOutput || (() => {})
    , onMemory: options.onMemory || (() => {})
  });
  
  return instance.run(source, options.fileName || "model.cv", options.args || [], options.files || [], options.input || "");
}
// ----------------------------------------------------------------

const WORK_DIR = "/work";
const LIBRARY_DIR = "/cryptoverif";

export { run, load, WORK_DIR, LIBRARY_DIR };
