/**
 * @file Checks my conventions of the source style for readability
 *
 * Usage: node tests/check-style.ts
 *
 * @author Roberto Metere
 * @license CECILL-B
 */

import fs from "node:fs";
import path from "node:path";
import { root, list, checker } from "./engine.ts";

const { check, failures } = checker();
const MARKER = "// " + "-".repeat(64);

/**
 * Checks one script.
 *
 * @param {string} file The script, from the root.
 * @return {Array<string>} The problems, with their lines.
 */
function checkScript(file: string): string[] {
  const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
  const problems = [];
  const documented = i => i > 0 && /^\s*\*\/$/.test(lines[i - 1]);
  let inComment = false;
  let inClass = false;
  lines.forEach((line, i) => {
    const where = file + ":" + (i + 1) + ": ";
    const trimmed = line.trim();
    if (trimmed.startsWith("/*")) {
      inComment = true;
    }
    const comment = inComment || trimmed.startsWith("//");
    if (comment && /---|===|\*\*\*|___|~~~|###/.test(trimmed.replace(/^\/\*\*/, "")) && line !== MARKER) {
      problems.push(where + "separator in a comment");
    }
    if (!comment && line.includes(String.fromCharCode(96))) {
      problems.push(where + "template literal");
    }
    if (/^class \w+/.test(line)) {
      inClass = true;
    } else if (line === "}") {
      inClass = false;
    }
    if (/^class \w+/.test(line) || /^function \w+\(/.test(line)) {
      if (!documented(i)) {
        problems.push(where + "no JSDoc before " + trimmed);
      }
      let end = i + 1;
      while (end < lines.length && lines[end] !== "}") {
        end++;
      }
      if (lines[end + 1] !== MARKER) {
        problems.push(file + ":" + (end + 1) + ": no end marker after " + trimmed);
      }
    }
    if (inClass && (/^  (static |async |get |set )*[A-Za-z_][\w$]*\(.*\)(: .+)? \{$/.test(line) || /^  static [\w$]+(: [^=]+)?( =|;)/.test(line))) {
      if (!documented(i)) {
        problems.push(where + "no JSDoc before " + trimmed);
      }
    }
    if (line === MARKER && lines[i - 1] !== "}") {
      problems.push(where + "end marker not after a top-level class or function");
    }
    if (trimmed.endsWith("*/")) {
      inComment = false;
    }
  });
  return problems;
}
// ----------------------------------------------------------------

const relative = file => path.relative(root, file).split(path.sep).join("/");
const scripts = list(path.join(root, "src"), /\.c?ts$/).concat(list(path.join(root, "tests"), /\.ts$/)).map(relative);
const others = ["build.sh", "README.md", "AUTHORS", "example/index.html"]
  .concat(list(path.join(root, "wasm"), /\.(c|js|patch|txt)$/).map(relative));

scripts.forEach(file => {
  const problems = checkScript(file);
  check(problems.length === 0, file + (problems.length ? "\n  " + problems.join("\n  ") : ""));
});
// The names of the authors keep their accents in the texts that credit them
const credits = ["README.md", "AUTHORS"];
scripts.concat(others).forEach(file => {
  const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n")
    .map(line => (credits.includes(file) ? line.replace(/Cad\u00e9/g, "Cade") : line));
  const bad = lines.map((line, i) => (/[^\x00-\x7f]/.test(line) ? i + 1 : 0)).filter(Boolean);
  if (bad.length) {
    check(false, file + ": not ASCII at lines " + bad.join(", "));
  }
});
check(true, scripts.length + " scripts and " + others.length + " other files are ASCII");

process.exit(failures() ? 1 : 0);
