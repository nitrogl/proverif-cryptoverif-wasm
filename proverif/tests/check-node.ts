/**
 * @file Checks ProVerif as a module for Node and as a command.
 *
 * @see node/index.cjs
 * @see node/cli.cjs
 * 
 * A model verifies through the module, and through the command, which reads
 * the libraries of -lib from disk, names the model by its path in the output,
 * and exits with the exit code of ProVerif.
 *
 * @author Roberto Metere
 * @license GPL-2.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as proverif from "../node/index.cjs";
import { root, checker } from "./engine.ts";

const { check, failures } = checker();
const CLI = path.join(root, "node", "cli.cjs");

/**
 * Runs the command.
 *
 * @param {Array<string>} args Its arguments.
 * @return {Object} {status, stdout, stderr}.
 */
function command(args: string[]) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8" });
}
// ----------------------------------------------------------------

/**
 * Runs the checks.
 */
async function main() {
  const model = "free c: channel.\ntype key.\nfun senc(bitstring, key): bitstring.\n"
    + "reduc forall m: bitstring, k: key; sdec(senc(m, k), k) = m.\nfree s: bitstring [private].\n"
    + "query attacker(s).\nprocess new k: key; out(c, senc(s, k))\n";

  // The module
  let output = "";
  const result = await proverif.run(model, { fileName: "secret.pv", onOutput: (channel, text) => {
    output += text;
  } });
  check(result.status === "done" && result.exitCode === 0 && output.includes("RESULT not attacker(s[]) is true."),
    "the module verifies a model: " + result.status + ", exit " + result.exitCode + ", in " + result.ms + " ms");

  // The command, with a library on disk, named without its extension
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "proverif-node-"));
  fs.writeFileSync(path.join(folder, "crypto.pvl"), "type key.\nfun senc(bitstring, key): bitstring.\n"
    + "reduc forall m: bitstring, k: key; sdec(senc(m, k), k) = m.\n");
  fs.writeFileSync(path.join(folder, "uses-lib.pv"), "free c: channel.\nfree s: bitstring [private].\nquery attacker(s).\n"
    + "process new k: key; out(c, senc(s, k))\n");
  const withLibrary = command(["-lib", path.join(folder, "crypto"), path.join(folder, "uses-lib.pv")]);
  check(withLibrary.status === 0 && withLibrary.stdout.includes("RESULT not attacker(s[]) is true."),
    "the command reads the library of -lib from disk: exit " + withLibrary.status);

  // An error: the exit code of ProVerif, and the model named by its path
  const wrong = path.join(folder, "wrong.pv");
  fs.writeFileSync(wrong, "free c: channel.\nprocess out(c, x)\n");
  const failed = command([wrong]);
  const said = failed.stdout + failed.stderr;
  check(failed.status === 2 && said.includes("File \"" + wrong + "\", line 2") && said.includes("x not declared"),
    "an error: exit " + failed.status + ", with the path of the model");

  // No model
  const usage = command([]);
  check(usage.status === 2 && usage.stderr.includes("Usage: proverif-wasm"), "without a model, the usage");

  fs.rmSync(folder, { recursive: true, force: true });
  process.exit(failures() ? 1 : 0);
}
// ----------------------------------------------------------------

main();
