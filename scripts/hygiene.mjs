// Source budgets and test-import hygiene (ported from TGVIO repository_hygiene.py).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
// Existing debt may only shrink. New modules receive no exemption.
const FRONTEND_DEBT = { "main.ts": 1707, "large.ts": 680 };
const FRONTEND_LIMIT = 600;
const DIRECT_TS = /(?:from\s*|import\s*\()\s*["'][^"']+\.ts["']/;

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
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("hygiene ok");
