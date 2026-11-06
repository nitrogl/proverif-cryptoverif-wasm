/**
 * @file Checks CryptoVerif as a module for Node and as a command.
 *
 * @see node/index.cjs
 * @see node/cli.cjs
 * 
 * The FDH signature scheme, an example of CryptoVerif, proves through both;
 * the command reads the libraries of -lib from disk, gives its standard input
 * to the interactive mode, and exits with the exit code of CryptoVerif.
 *
 * @author Roberto Metere
 * @license CECILL-B
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as cryptoverif from "../node/index.cjs";
import { root, unpackExamples, checker } from "./engine.ts";

const { check, failures } = checker();
const CLI = path.join(root, "node", "cli.cjs");

/**
 * Runs the command.
 *
 * @param {Array<string>} args Its arguments.
 * @param {string} input Its standard input.
 * @return {Object} {status, stdout, stderr}.
 */
function command(args: string[], input: string = "") {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", input: input });
}
// ----------------------------------------------------------------

/**
 * Runs the checks.
 */
async function main() {
  const examples = unpackExamples();
  const fdh = path.join(examples.folder, "examples", "obasic", "fdh.ocv");

  // The module
  let output = "";
  const result = await cryptoverif.run(fs.readFileSync(fdh, "utf8"), { fileName: "fdh.ocv", onOutput: (channel, text) => {
    output += text;
  } });
  check(result.status === "done" && result.exitCode === 0 && output.includes("All queries proved."),
    "the module proves FDH: " + result.status + ", exit " + result.exitCode + ", in " + result.ms + " ms");

  // The command
  const proved = command([fdh]);
  check(proved.status === 0 && proved.stdout.includes("All queries proved."), "the command proves FDH: exit " + proved.status);

  // A library on disk, named without its extension, which CryptoVerif adds
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cryptoverif-node-"));
  fs.writeFileSync(path.join(folder, "mylib.cvl"), "type key [fixed].\n");
  fs.writeFileSync(path.join(folder, "uses-lib.cv"), "channel c.\nprocess in(c, ()); new k: key; out(c, ())\n");
  const withLibrary = command(["-lib", path.join(folder, "mylib"), path.join(folder, "uses-lib.cv")]);
  check(withLibrary.status === 0 && withLibrary.stdout.includes("All queries proved."),
    "the command reads the library of -lib from disk: exit " + withLibrary.status);

  // The interactive mode reads the standard input of the command
  const interactive = path.join(folder, "interactive.cv");
  fs.writeFileSync(interactive, "channel c.\nproof {\ninteractive\n}\nprocess in(c, ()); out(c, ())\n");
  const commanded = command([interactive], "success\nquit\n");
  check(commanded.status === 0 && commanded.stdout.includes("RESULT Proved indistinguishability"),
    "the interactive mode takes its commands from the standard input: exit " + commanded.status);

  // An error: the exit code of CryptoVerif, and the model named by its path
  const wrong = path.join(folder, "wrong.cv");
  fs.writeFileSync(wrong, "channel c.\nprocess in(c, ()); out(c, x)\n");
  const failed = command([wrong]);
  const said = failed.stdout + failed.stderr;
  check(failed.status === 2 && said.includes(wrong), "an error: exit " + failed.status + ", with the path of the model");

  fs.rmSync(folder, { recursive: true, force: true });
  fs.rmSync(examples.folder, { recursive: true, force: true });
  process.exit(failures() ? 1 : 0);
}
// ----------------------------------------------------------------

main();
