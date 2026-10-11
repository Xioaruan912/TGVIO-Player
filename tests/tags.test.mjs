import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { installDom } from "./dom-stub.mjs";

const { flush } = installDom();
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const sheets = [];
const deps = {
  api: null, MOCK_MODE: false, element,
  openSheet: (_host, title, body) => sheets.push({ title, body }),
  sheetNote: text => element("p", "sheet-note", text),
  sheetChoice: (title, sub, selected, onPick) => { const row = element("button", "sheet-row-choice", title); row.selected = selected; row.sub = sub; row.addEventListener("click", onPick); return row; },
};
globalThis.__tagDeps = deps;
const source = ts.transpileModule(await readFile(new URL("../src/tags.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^import .* from .*;$/gm, "");
const { openTagSheet } = await import("data:text/javascript;base64," + Buffer.from(
  `const { ${Object.keys(deps).join(", ")} } = globalThis.__tagDeps;\n` + source).toString("base64"));

function fakeSource(tags, on) {
  const calls = [];
  let nextId = 10;
  return {
    calls,
    list: async () => tags.map(t => ({ ...t })),
    mediaTags: async () => [...on],
    create: async name => { calls.push(["create", name]); return { id: nextId++, name, count: 0 }; },
    set: async (_id, tagId, enable) => { calls.push(["set", tagId, enable]); if (enable) on.add(tagId); else on.delete(tagId); return [...on]; },
  };
}
const rows = () => sheets.at(-1).body.filter(node => node.className === "sheet-row-choice");

test("tags toggle on the video and show what the server kept", async () => {
  sheets.length = 0;
  const src = fakeSource([{ id: 1, name: "黑丝", count: 3 }, { id: 2, name: "短发", count: 0 }], new Set([1]));
  await openTagSheet({}, "m1", () => {}, src);
  assert.deepEqual(rows().map(r => [r.textContent, r.selected]), [["黑丝", true], ["短发", false]]);
  rows()[1].dispatch("click");
  await flush();
  assert.deepEqual(src.calls, [["set", 2, true]]);
  assert.deepEqual(rows().map(r => [r.selected, r.sub]), [[true, "3 个视频"], [true, "1 个视频"]]);
});

test("a new tag is made and put on the video in one go", async () => {
  sheets.length = 0;
  const src = fakeSource([], new Set());
  await openTagSheet({}, "m1", () => {}, src);
  const form = sheets.at(-1).body[0];
  const [input, add] = form.children;
  input.value = "  熟女 ";
  add.dispatch("click");
  await flush();
  assert.deepEqual(src.calls, [["create", "熟女"], ["set", 10, true]]);
  assert.deepEqual(rows().map(r => [r.textContent, r.selected]), [["熟女", true]]);
});

test("a failed save is reported and leaves the row as it was", async () => {
  sheets.length = 0;
  const notes = [];
  const src = fakeSource([{ id: 1, name: "a", count: 0 }], new Set());
  src.set = async () => { throw new Error("offline"); };
  await openTagSheet({}, "m1", message => notes.push(message), src);
  rows()[0].dispatch("click");
  await flush();
  assert.deepEqual(notes, ["标签没有保存成功"]);
  assert.equal(rows()[0].selected, false);
});
