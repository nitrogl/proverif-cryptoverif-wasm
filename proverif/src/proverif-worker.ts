/**
 * @file Web worker that runs one ProVerif verification.
 * @see ProVerifRunner.ts
 *
 * The page creates a fresh worker for every run, sends it the compiled
 * module (a WebAssembly.Module can be posted to a worker), and terminates it
 * on timeout or cancellation.
 * 
 *
 * Message from the page:
 *   { type: "run", module, source, fileName, args, files, maxMemory }
 *
 * Messages to the page:
 *   { type: "output", channel, text }, at most every 100 ms or 16 KB
 *   { type: "memory", bytes, limit }, when the heap grows
 *   { type: "result", result } with the object returned by ProVerifEngine.run
 *
 * @author Roberto Metere
 * @license GPL-2.0-or-later
 */
"use strict";

importScripts("proverif.js", "ProVerifEngine.js");

/**
 * Output waiting to be posted, by channel.
 *
 * @type {Object<string, string>}
 */
const pending: Record<string, string> = { stdout: "", stderr: "" };
let lastPost = 0;

/**
 * Posts the pending output, if any.
 */
function postOutput() {
  ["stdout", "stderr"].forEach(channel => {
    if (pending[channel] !== "") {
      self.postMessage({ type: "output", channel: channel, text: pending[channel] });
      pending[channel] = "";
    }
  });
  lastPost = Date.now();
}
// ----------------------------------------------------------------

self.onmessage = event => {
  const request = event.data || {};
  if (request.type !== "run") {
    return;
  }
  const engine = new ProVerifEngine({
      scope: self
    , module: request.module
    , maxMemory: request.maxMemory
    , onOutput: (channel, text) => {
        pending[channel] += text;
        if (pending[channel].length > 16384 || Date.now() - lastPost > 100) {
          postOutput();
        }
      }
    , onMemory: (bytes, limit) => self.postMessage({ type: "memory", bytes: bytes, limit: limit })
  });
  engine.run(request.source, request.fileName, request.args || [], request.files || [])
    .then(result => {
      postOutput();
      self.postMessage({ type: "result", result: result });
    });
};
