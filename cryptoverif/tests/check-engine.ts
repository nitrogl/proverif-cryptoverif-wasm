/**
 * @file Checks CryptoVerif under Node
 * 
 * Built files are listed in dist/SHA256SUMS.
 * Test is succesful if every example for the channel and the oracle front
 * ends in the CryptoVerif distribution (but those that native CryptoVerif
 * does not finish quickly) gives the output and the exit code of native
 * CryptoVerif.
 * A run stops cleanly at its memory limit, or has none; errors, -lib and the
 * interactive mode work as on the command line; and the worker answers as
 * CryptoVerifRunner expects.
 *
 * Usagecan include an optional pattern, which keeps only the examples whose
 * path contains it; "none" skips them all, for the other checks alone.
 *
 * @author Roberto Metere
 * @license CECILL-B
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dist, workerContext, loadEngine, verify, unpackExamples, expectedFile, checker } from "./engine.ts";

const { check, failures } = checker();
const pattern = process.argv[2] || "";

/**
 * Writes a model that needs much memory: a tuple of many copies of a name.
 *
 * @param {number} count The size of the tuple.
 * @return {string} The model, for the channel front end.
 */
function largeModel(count: number): string {
  return "type T [fixed].\nchannel c.\nprocess in(c, ()); new n: T; out(c, (" + new Array(count).fill("n").join(", ") + "))\n";
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
    context.importScripts("cryptoverif-worker.js");
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

  // The examples, as native CryptoVerif verifies them
  const loaded = loadEngine();
  const index = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "expected", "index.json"), "utf8"));
  const { folder, files } = unpackExamples();
  const missing = files.filter(file => !index.examples[file]);
  const slow = files.filter(file => index.examples[file] && index.examples[file].slow);
  check(missing.length === 0, files.length + " examples in the distribution, all with an expected output, but " + slow.length
    + " that native CryptoVerif does not finish in " + index.limit + " s" + (missing.length ? "; none for " + missing.join(", ") : ""));
  let engineMs = 0;
  let nativeMs = 0;
  const chosen = files.filter(file => index.examples[file] && !index.examples[file].slow && file.includes(pattern) && pattern !== "none");
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
    console.log(chosen.length + " examples in " + (engineMs/1000).toFixed(1) + " s; native CryptoVerif took "
      + (nativeMs/1000).toFixed(1) + " s when their outputs were saved");
  }

  // A model that fits in its limit, then the same kind of model, larger,
  // that does not, and the same with no limit
  const fits = await verify(loaded, largeModel(5000), "large.cv", { maxMemory: 64*1048576 });
  check(fits.result.status === "done" && fits.result.exitCode === 0,
    "a tuple of 5000 in 64 MB: " + fits.result.status + ", heap " + Math.round(fits.result.bytes/1048576) + " MB");
  const tooLarge = await verify(loaded, largeModel(60000), "large.cv", { maxMemory: 40*1048576 });
  check(tooLarge.result.status === "memory" && tooLarge.result.bytes <= 40*1048576,
    "a tuple of 60000 in 40 MB: " + tooLarge.result.status + ", heap " + Math.round(tooLarge.result.bytes/1048576) + " MB");
  const unbounded = await verify(loaded, largeModel(60000), "large.cv", { maxMemory: 0 });
  check(unbounded.result.status === "done" && unbounded.result.limit === loaded.context.CryptoVerifEngine.MAX_MEMORY,
    "a tuple of 60000 with no limit: " + unbounded.result.status + ", heap " + Math.round(unbounded.result.bytes/1048576) + " MB of at most 4 GB");

  // An error in the model is reported as CryptoVerif reports it
  const wrong = await verify(loaded, "channel c.\nprocess in(c, x)\n", "wrong.cv", {});
  check(wrong.result.exitCode === 2 && /File "wrong.cv", line 2, characters 15-16:\nError: type needed for this variable/.test(wrong.output),
    "an error in the model: " + wrong.output.trim().split("\n").join(" | "));

  // The last line, printed when CryptoVerif returns from its main module,
  // needs std_exit to be flushed; the oracle front end comes from .ocv
  const tiny = await verify(loaded, "type key [fixed].\nprocess O() := k <-R key; return()\n", "tiny.ocv", {});
  check(tiny.result.exitCode === 0 && /All queries proved\.\n$/.test(tiny.output), "the output is complete when CryptoVerif ends without exit");

  // A library given with -lib, in place of the default one
  const withLibrary = await verify(loaded, "channel c.\nprocess in(c, ()); new k: key; out(c, ())\n", "lib.cv",
    { args: ["-lib", "/work/mylib"], files: [{ name: "mylib.cvl", text: "type key [fixed].\n" }] });
  check(withLibrary.result.exitCode === 0 && /All queries proved\./.test(withLibrary.output), "a library with -lib: exit " + withLibrary.result.exitCode);

  // The interactive mode reads its commands from the input of the run, and
  // stops at the end of it
  const interactive = "channel c.\nproof {\ninteractive\n}\nprocess in(c, ()); out(c, ())\n";
  const commanded = await verify(loaded, interactive, "interactive.cv", { input: "success\nquit\n" });
  const ended = await verify(loaded, interactive, "interactive.cv", {});
  check(commanded.result.exitCode === 0 && /RESULT Proved indistinguishability/.test(commanded.output) && /End of file\./.test(ended.output),
    "the interactive mode: commands from the input, then the end of the file");
  // An error of a command comes after the prompt, as on a terminal
  const misspelt = await verify(loaded, interactive, "interactive.cv", { input: "foo\nquit\n" });
  check(/Please enter a command: Character 0 - character 3:\nError: Syntax error\nPlease enter a command: /.test(misspelt.output),
    "the interactive mode: the errors of the commands, in order");

  // The worker, as CryptoVerifRunner uses it
  const messages = await runWorker(loaded.module, { source: largeModel(20000), fileName: "large.cv", args: [], files: [], maxMemory: 0 });
  const result = messages[messages.length - 1].result;
  const grew = messages.filter(message => message.type === "memory");
  const text = messages.filter(message => message.type === "output").map(message => message.text).join("");
  check(result.status === "done" && result.exitCode === 0 && grew.length > 0 && grew.every(message => message.limit === result.limit)
    && /All queries proved\./.test(text),
    "the worker: " + messages.length + " messages, " + grew.length + " of memory, " + text.length + " characters of output, then the result");
  const session = await runWorker(loaded.module, { source: interactive, fileName: "interactive.cv", args: [], files: [], input: "foo\nquit\n", maxMemory: 0 });
  const answered = session.filter(message => message.type === "output").map(message => message.text).join("");
  check(/Please enter a command: Character 0 - character 3:\nError: Syntax error\nPlease enter a command: /.test(answered),
    "the worker keeps the order of stdout and stderr: the error of a command after its prompt");

  process.exit(failures() ? 1 : 0);
})();
