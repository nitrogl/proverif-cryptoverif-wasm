/**
 * @file Web worker that runs one CryptoVerif verification.
 * @see CryptoVerifRunner.ts
 *
 * The page creates a fresh worker for every run, sends it the compiled
 * module (a WebAssembly.Module can be posted to a worker), and terminates it
 * on timeout or cancellation.
 *
 *
 * Message from the page:
 *   { type: "run", module, source, fileName, args, files, input, maxMemory }
 *
 * Messages to the page:
 *   { type: "output", channel, text }, at most every 100 ms or 16 KB
 *   { type: "memory", bytes, limit }, when the heap grows
 *   { type: "result", result } with the object returned by CryptoVerifEngine.run
 *
 * @author Roberto Metere
 * @license CECILL-B
 */
"use strict";

importScripts("cryptoverif.js", "CryptoVerifEngine.js");

/**
 * Output waiting to be posted, in the order CryptoVerif wrote it: pieces
 * {channel, text}, where the text that follows on the same channel joins
 * the last piece.
 *
 * @type {Array<Object>}
 */
let pending: any[] = [];
let pendingLength = 0;
let lastPost = 0;

/**
 * Posts the pending output, if any, piece by piece in its order: a prompt
 * of the interactive mode on stdout stays before the error of the command
 * that follows it on stderr.
 */
function postOutput() {
  pending.forEach(piece => self.postMessage({ type: "output", channel: piece.channel, text: piece.text }));
  pending = [];
  pendingLength = 0;
  lastPost = Date.now();
}
// ----------------------------------------------------------------

self.onmessage = event => {
  const request = event.data || {};
  if (request.type !== "run") {
    return;
  }
  const engine = new CryptoVerifEngine({
      scope: self
    , module: request.module
    , maxMemory: request.maxMemory
    , onOutput: (channel, text) => {
        const last = pending[pending.length - 1];
        if (last && last.channel === channel) {
          last.text += text;
        } else {
          pending.push({ channel: channel, text: text });
        }
        pendingLength += text.length;
        if (pendingLength > 16384 || Date.now() - lastPost > 100) {
          postOutput();
        }
      }
    , onMemory: (bytes, limit) => self.postMessage({ type: "memory", bytes: bytes, limit: limit })
  });
  engine.run(request.source, request.fileName, request.args || [], request.files || [], request.input || "")
    .then(result => {
      postOutput();
      self.postMessage({ type: "result", result: result });
    });
};
