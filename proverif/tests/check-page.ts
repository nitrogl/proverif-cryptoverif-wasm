/**
 * @file Drives example/index.html in a headless Chromium (Playwright).
 * It also checks the memory limit and the timeout of the runner.
 *
* @author Roberto Metere
 * @license GPL-2.0-or-later
 */

import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { root, checker } from "./engine.ts";

const { check, failures } = checker();
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };

/**
 * Serves the repository on a free port of localhost.
 *
 * @return {Promise<http.Server>} The server, listening.
 */
function serve(): Promise<http.Server> {
  const server = http.createServer((request, response) => {
    const file = path.join(root, decodeURIComponent(request.url.split("?")[0]).replace(/\/$/, "/index.html"));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
  });
  
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}
// ----------------------------------------------------------------

/**
 * Writes a model that needs much memory and time: many names and one tuple
 * of all of them.
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
 * Verifies the model of the page with its button, and reads the outcome.
 *
 * @param {Object} page The page.
 * @return {Promise<Object>} The status line and the results listed.
 */
async function verifyExample(page: any) {
  await page.waitForFunction(() => /^Ready/.test(document.getElementById("status").textContent), null, { timeout: 60000 });
  const ready = await page.textContent("#status");
  await page.click("#verify");
  await page.waitForFunction(() => !/^(Verifying|Ready)/.test(document.getElementById("status").textContent), null, { timeout: 60000 });
  return {
      ready: ready
    , status: await page.textContent("#status")
    , results: await page.$$eval("#results li", items => items.map(item => item.className + ": " + item.textContent))
  };
}
// ----------------------------------------------------------------

async function main() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch (e) {
    console.log("SKIP Playwright is not installed (npm install playwright)");
    return;
  }
  const server = await serve();
  const browser = await playwright.chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const expected = ["true: not attacker(s1[]) is true.", "false: not attacker(s2[]) is false."];

  await page.goto("http://127.0.0.1:" + (server.address() as AddressInfo).port + "/example/");
  const served = await verifyExample(page);
  check(served.ready === "Ready (worker)." && /^Done, exit code 0/.test(served.status) && served.results.join("|") === expected.join("|"),
    "served from localhost: " + served.status + " " + served.results.join(", "));

  const limit = await page.evaluate(model => new ProVerifRunner().run(model, { maxMemory: 40*1048576 }), largeModel(40000));
  check(limit.status === "memory" && limit.limit === 40*1048576, "a run stops at its memory limit: " + limit.status + ", " + limit.message);

  const timeout = await page.evaluate(model => new ProVerifRunner().run(model, { maxMemory: 0, timeoutSeconds: 1 }), largeModel(200000));
  check(timeout.status === "timeout" && timeout.ms < 3000, "a run stops at its timeout: " + timeout.status + " after " + timeout.ms + " ms");

  const local = await browser.newPage();
  local.on("pageerror", error => errors.push(error.message));
  await local.goto("file://" + path.join(root, "example", "index.html"));
  const opened = await verifyExample(local);
  check(opened.ready === "Ready (page)." && /^Done, exit code 0/.test(opened.status) && opened.results.join("|") === expected.join("|"),
    "opened from disk: " + opened.status + " " + opened.results.join(", "));

  check(errors.length === 0, "no errors in the pages" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  server.close();
  process.exit(failures() ? 1 : 0);
}
// ----------------------------------------------------------------

main();
