import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = ts.transpileModule(await readFile(new URL("../src/count-roll.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^import .* from .*;$/gm, "");
globalThis.__rollDeps = { motionAllowed: () => true };
const { rollFrame } = await import("data:text/javascript;base64," + Buffer.from(
  "const { motionAllowed } = globalThis.__rollDeps;\n" + source).toString("base64"));

test("a count rolls from zero, eases out, and lands exactly on its value", () => {
  assert.equal(rollFrame(97, 0), 0);
  assert.ok(rollFrame(97, 350) > 97 / 2, "ease-out: past half way at half time");
  assert.equal(rollFrame(97, 700), 97);
  assert.equal(rollFrame(97, 5000), 97, "never overshoots");
});
