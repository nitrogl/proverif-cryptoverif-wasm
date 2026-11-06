/**
 * @file Checks ProVerif under Node
 * 
 * Built files are listed in dist/SHA256SUMS.
 * Test is succesful if every example of the typed pi calculus in the ProVerif
 * distribution gives the output and the exit code of native ProVerif.
 * A run stops cleanly at its memory limit, or has none; errors, -parse-only
 * and -lib work as on the command line; and the worker answers as
 * ProVerifRunner expects.
 *
 * Usagecan include an optional pattern, which keeps only the examples whose
 * path contains it; "none" skips them all, for the other checks alone.
 *
 * @author Roberto Metere
 * @license GPL-2.0-or-later
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dist, workerContext, loadEngine, verify, unpackExamples, expectedFile, checker } from "./engine.ts";

const { check, failures } = checker();
const pattern = process.argv[2] || "";

/**
 * Writes a model too large for a small memory: many names and one tuple of
 * all of them.
 *
 * @param {number} count The number of names.
 * @return {string} The model.
 */
function largeModel(count: number): string {
  const names = [];
  for (let i = 0; i < count; i++) {
    names.push("n" + i);
  }
  
  return "free c: channel.\n"
    + names.map(name => "free " + name + ": bitstring.\n").join("")
    + "process\n  out(c, (" + names.join(", ") + "))\n";
}
// ----------------------------------------------------------------

/**
 * @return {string} A small model, whose secret the attacker gets.
 */
function model0(): string {
  return "free c: channel.\nfree s: bitstring [private].\nquery attacker(s).\nprocess out(c, s)\n";
}
// ----------------------------------------------------------------

/**
 * Runs the worker in a context of its own, as a page would, and collects
 * its messages until the result.
 *
 * @param {WebAssembly.Module} module The compiled engine.
 * @param {Object} request The message for the worker, without its type.
 * @return {Promise<Array<Object>>} The messages of the worker.
 */
function runWorker(module: WebAssembly.Module, request: any): Promise<any[]> {
  return new Promise(resolve => {
    const messages = [];
    const context = workerContext({
        postMessage: message => {
          messages.push(message);
          if (message.type === "result") {
            resolve(messages);
          }
        }
    });
    context.importScripts("proverif-worker.js");
    context.onmessage({ data: {...request, type: "run", module: module} });
  });
}
// ----------------------------------------------------------------

/*
 * (async () => { ... })(); immediately invokes the asynchronous function.
 * I wanted to try that, in "check-node.js" the invocation is explicit.
 * 
 * TODO: perhaps simplify this one, I won't remember it in 1 week time
 */
(async () => {
  // The built files, as build.sh listed them
  const sums = fs.readFileSync(path.join(dist, "SHA256SUMS"), "utf8").trim().split("\n");
  const changed = sums.filter(line => {
    const [sum, name] = line.split(/\s+/);
    return crypto.createHash("sha256").update(fs.readFileSync(path.join(dist, name))).digest("hex") !== sum;
  });
  check(changed.length === 0, "the built files match dist/SHA256SUMS" + (changed.length ? ": not " + changed.join(", ") : ""));

  // The examples, as native ProVerif verifies them
  const loaded = loadEngine();
  const index = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "expected", "index.json"), "utf8"));
  const { folder, files } = unpackExamples();
  const missing = files.filter(file => !index.examples[file]);
  check(missing.length === 0, files.length + " examples in the distribution, all with an expected output"
    + (missing.length ? ": not " + missing.join(", ") : ""));
  let engineMs = 0;
  let nativeMs = 0;
  const chosen = files.filter(file => index.examples[file] && file.includes(pattern) && pattern !== "none");
  for (const example of chosen) {
    const expected = index.examples[example];
    const run = await verify(loaded, fs.readFileSync(path.join(folder, example), "utf8"), path.basename(example), {});
    engineMs += run.result.ms;
    nativeMs += expected.ms;
    check(run.result.status === "done" && run.result.exitCode === expected.exit && run.output === fs.readFileSync(expectedFile(example), "utf8"),
      example + ": exit " + run.result.exitCode + ", " + run.result.ms + " ms (native " + expected.ms + " ms)");
  }
  fs.rmSync(folder, { recursive: true, force: true });
  if (chosen.length > 0) {
    console.log(chosen.length + " examples in " + (engineMs/1000).toFixed(1) + " s; native ProVerif took "
      + (nativeMs/1000).toFixed(1) + " s when their outputs were saved");
  }

  // A model that fits in its limit, then the same kind of model, larger,
  // that does not, and the same with no limit
  const fits = await verify(loaded, largeModel(10000), "large.pv", { maxMemory: 64*1048576 });
  check(fits.result.status === "done" && fits.result.exitCode === 0,
    "10000 names in 64 MB: " + fits.result.status + ", heap " + Math.round(fits.result.bytes/1048576) + " MB");
  const tooLarge = await verify(loaded, largeModel(40000), "large.pv", { maxMemory: 40*1048576 });
  check(tooLarge.result.status === "memory" && tooLarge.result.bytes <= 40*1048576,
    "40000 names in 40 MB: " + tooLarge.result.status + ", heap " + Math.round(tooLarge.result.bytes/1048576) + " MB");
  const unbounded = await verify(loaded, largeModel(40000), "large.pv", { maxMemory: 0 });
  check(unbounded.result.status === "done" && unbounded.result.limit === loaded.context.ProVerifEngine.MAX_MEMORY,
    "40000 names with no limit: " + unbounded.result.status + ", heap " + Math.round(unbounded.result.bytes/1048576) + " MB of at most 4 GB");

  // An error in the model is reported as ProVerif reports it
  const wrong = await verify(loaded, "free c: channel.\nprocess out(c, x)\n", "wrong.pv", {});
  check(wrong.result.exitCode === 2 && /File "wrong.pv", line 2, character 16:\nError: Variable, function, name, or predicate x not declared\./.test(wrong.output),
    "an error in the model: " + wrong.output.trim().split("\n").join(" | "));

  // The parse only mode, which checks a model without verifying it
  const parsed = await verify(loaded, largeModel(10), "small.pv", { args: ["-parse-only"] });
  check(parsed.result.status === "done" && parsed.result.exitCode === 0 && parsed.output === "",
    "-parse-only: exit " + parsed.result.exitCode + ", " + parsed.result.ms + " ms");

  // What ProVerif prints after its analysis, when it ends without calling
  // exit: the statistics of -gc need std_exit to flush the output
  const gc = await verify(loaded, model0(), "gc.pv", { args: ["-gc"] });
  check(gc.result.exitCode === 0 && /^top_heap_words: \d+$/m.test(gc.output) && /heap_chunks: \d+\n$/.test(gc.output),
    "the output is complete when ProVerif ends without exit (-gc)");

  // A library given with -lib, as a file of the run
  const library = "type key.\nfun senc(bitstring, key): bitstring.\nreduc forall m: bitstring, k: key; sdec(senc(m, k), k) = m.\n";
  const model = "free c: channel.\nfree s: bitstring [private].\nquery attacker(s).\nprocess new k: key; out(c, senc(s, k))\n";
  const withLibrary = await verify(loaded, model, "lib.pv", { args: ["-lib", "/work/crypto.pvl"], files: [{ name: "crypto.pvl", text: library }] });
  check(withLibrary.result.exitCode === 0 && /RESULT not attacker\(s\[\]\) is true\./.test(withLibrary.output),
    "a library with -lib: " + (withLibrary.output.match(/RESULT .*/) || ["no result"])[0]);

  // The worker, as ProVerifRunner uses it
  const messages = await runWorker(loaded.module, { source: largeModel(20000), fileName: "large.pv", args: [], files: [], maxMemory: 0 });
  const result = messages[messages.length - 1].result;
  const grew = messages.filter(message => message.type === "memory");
  const text = messages.filter(message => message.type === "output").map(message => message.text).join("");
  check(result.status === "done" && result.exitCode === 0 && grew.length > 0 && grew.every(message => message.limit === result.limit) && /n19999/.test(text),
    "the worker: " + messages.length + " messages, " + grew.length + " of memory, " + text.length + " characters of output, then the result");

  process.exit(failures() ? 1 : 0);
})();
