// Source budgets and test-import hygiene (ported from TGVIO repository_hygiene.py).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
// Existing debt may only shrink. New modules receive no exemption.
const FRONTEND_DEBT = { "main.ts": 1707, "large.ts": 680 };
const FRONTEND_LIMIT = 600;
const DIRECT_TS = /(?:from\s*|import\s*\()\s*["'][^"']+\.ts["']/;
// Exact byte lengths and SHA-256s of private storage locations (shared with TGVIO
// tests/test_player_public_source.py). Never put their plaintext into this repository.
const PRIVATE_FRAGMENTS = [
  [23, "1103138cd6f255aed2b5ebaedf70ab29b4fca781d52b0e87d600726968bc2dcc"],
  [20, "775f9acd8990bc9ecc2c820c4e371453c9713971d50bcae3c122fd5bee615664"],
  [9, "3c8fd7bde2ed8fd4da876902e4e468c49b09bbc0f126bb192b75ff62c067a7e9"],
  [27, "e73371ffa49234ed0a3b366df268e3fa1f55122616cc36b102ea07e477d82933"],
];
const SCANNED = ["src", "tests", "public", "docs", "scripts", "index.html", "README.md", "AGENTS.md"];

function embedsPrivateLocation(data) {
  for (const [length, digest] of PRIVATE_FRAGMENTS) {
    for (let start = 0; start + length <= data.length; start += 1) {
      if (createHash("sha256").update(data.subarray(start, start + length)).digest("hex") === digest) return true;
    }
  }
  return false;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const problems = [];
const src = join(root, "src");
for (const path of walk(src)) {
  if (!path.endsWith(".ts")) continue;
  const name = relative(src, path).split("\\").join("/");
  const lines = readFileSync(path, "utf8").split("\n").length - 1;
  const budget = FRONTEND_DEBT[name] ?? FRONTEND_LIMIT;
  if (lines > budget) problems.push(`src/${name}: ${lines} lines exceeds ${budget}`);
}
for (const entry of readdirSync(join(root, "tests"))) {
  if (!entry.endsWith(".test.mjs")) continue;
  if (DIRECT_TS.test(readFileSync(join(root, "tests", entry), "utf8"))) {
    problems.push(`tests/${entry}: Node tests must import compiled JS, not TypeScript`);
  }
}
for (const name of SCANNED) {
  const target = join(root, name);
  if (!existsSync(target)) continue;
  for (const path of statSync(target).isDirectory() ? walk(target) : [target]) {
    if (embedsPrivateLocation(readFileSync(path))) problems.push(`${relative(root, path)}: private storage location in public source`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("hygiene ok");
