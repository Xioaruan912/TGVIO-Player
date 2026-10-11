import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { installDom } from "./dom-stub.mjs";

const { flush } = installDom();
globalThis.window ??= globalThis;
const timers = [];
globalThis.window.setTimeout = fn => { timers.push(fn); return timers.length; };

const source = ts.transpileModule(await readFile(new URL("../src/duplicates.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/^import .* from .*;$/gm, "");
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
globalThis.__dupDeps = {
  api: null, clipFromMedia: m => m, MOCK_MODE: false, element, deleteWithUndo: null,
  buildCoverTile: ({ media, subtitle }) => ({ root: element("article", "cover-tile", subtitle + "#" + media.id) }),
  openSheet: () => undefined, sheetNote: text => element("p", "sheet-note", text),
  sheetRow: ({ title }) => element("button", "sheet-row", title),
};
const { buildDuplicateGroup, describeCopy } = await import("data:text/javascript;base64," + Buffer.from(
  "const { api, clipFromMedia, MOCK_MODE, element, deleteWithUndo, buildCoverTile, openSheet, sheetNote, sheetRow } = globalThis.__dupDeps;\n"
  + source).toString("base64"));

const clip = (id, sizeBytes) => ({ id, sizeBytes, duration: 75, width: 720, height: 1280, category: "short", coverUrl: null, favorite: false, streamUrl: "/s/" + id });
const find = (node, predicate) => [node, ...node.children.flatMap(child => find(child, predicate))].filter(predicate);
const copies = card => find(card, n => n.className === "duplicate-copy");
const button = (node, text) => find(node, n => n.tagName === "button" && n.textContent === text)[0];

function fakeSource() {
  const removed = [], dismissed = [], restores = [];
  return {
    removed, dismissed, restores,
    load: async () => ({ groups: [], total: 0 }),
    dismiss: async ids => { dismissed.push(ids); },
    remove: async (item, hide) => { removed.push(item.id); restores.push(hide()); return "queued"; },
  };
}

test("a copy is described by resolution, size and length", () => {
  assert.equal(describeCopy(clip("a", 50 * 1024 ** 2)), "720p · 50 MB · 1:15");
  assert.equal(describeCopy({ ...clip("b", 3 * 1024 ** 3), width: null }), "3.00 GB · 1:15");
});

test("keeping one copy deletes the others and settles the group", async () => {
  timers.length = 0;
  const src = fakeSource(), settled = [];
  const card = buildDuplicateGroup([clip("a", 300), clip("b", 200), clip("c", 100)], src, c => settled.push(c));
  button(copies(card)[1], "保留这个").dispatch("click");
  await flush();
  assert.deepEqual(src.removed, ["a", "c"]);
  assert.deepEqual(copies(card).map(c => !!c.hidden), [true, false, true]);
  timers.forEach(fn => fn());
  assert.deepEqual(settled, [card]);
});

test("an undone delete brings the copy back and keeps the group", async () => {
  timers.length = 0;
  const src = fakeSource(), settled = [];
  const card = buildDuplicateGroup([clip("a", 300), clip("b", 200)], src, c => settled.push(c));
  button(copies(card)[0], "保留这个").dispatch("click");
  src.restores[0]();
  timers.forEach(fn => fn());
  assert.equal(copies(card)[1].hidden, false);
  assert.deepEqual(settled, []);
});

test("not a duplicate is remembered for the whole group", async () => {
  const src = fakeSource(), settled = [];
  const card = buildDuplicateGroup([clip("a", 300), clip("b", 200)], src, c => settled.push(c));
  button(card, "不是重复").dispatch("click");
  await flush();
  assert.deepEqual(src.dismissed, [["a", "b"]]);
  assert.deepEqual(settled, [card]);
});
