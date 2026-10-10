import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { installDom } from "./dom-stub.mjs";

const { flush } = installDom();

async function transpile(source) {
  return ts.transpileModule(await readFile(new URL("../src/" + source, import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/^import .* from .*;$/gm, "").replace(/^export .* from .*;$/gm, "");
}
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const { CollectionsController } = await import("data:text/javascript;base64," + Buffer.from(
  await transpile("collections.ts")).toString("base64"));

// A favourites queue that only remembers its observers.
const observers = new Set();
const favoriteMutations = { subscribe: (change, result) => { const o = { change, result }; observers.add(o); return () => observers.delete(o); } };
const settle = (id, favorite) => { for (const o of observers) o.result(id, favorite === null ? null : { favorite, syncStatus: "pending" }); };

const sheets = [];
const sheet = {
  openSheet: (_host, title, body) => sheets.push({ title, body }),
  closeSheet: () => sheets.push({ title: "closed", body: [] }),
  sheetNote: text => element("p", "sheet-note", text),
  sheetChoice: (title, sub, _selected, onPick) => { const row = element("button", "sheet-row-choice", title); row.addEventListener("click", onPick); return row; },
};
globalThis.__favDeps = {
  api: null, CollectionsController, favoriteMutations, element, ...sheet,
  buildNameSheet: options => { const form = element("div", "collection-name-form"); form.submit = name => options.onSubmit(name, element("p")); return form; },
};
const { installFavoriteCollections } = await import("data:text/javascript;base64," + Buffer.from(
  "const { api, CollectionsController, favoriteMutations, element, openSheet, closeSheet, sheetNote, sheetChoice, buildNameSheet } = globalThis.__favDeps;\n"
  + await transpile("favorite-collections.ts")).toString("base64"));

function fakeSource() {
  const rows = [
    { collection_id: "builtin", name: "收藏", kind: "builtin", count: 9 },
    { collection_id: "c1", name: "视频", kind: "manual", count: 2 },
    { collection_id: "c2", name: "最近", kind: "smart", count: 5 },
  ];
  const added = [];
  return {
    added,
    collections: async () => rows.slice(),
    createCollection: async (name, kind) => { const row = { collection_id: "c" + (rows.length + 1), name, kind, count: 0 }; rows.push(row); return row; },
    addCollectionItem: async (collectionId, mediaId) => { added.push([collectionId, mediaId]); },
  };
}
const buttons = body => body.flatMap(node => [node, ...(node.children ?? [])]).filter(node => node.tagName === "button");

test("a favourite offers the manual collections and adds to the picked one", async () => {
  sheets.length = 0;
  const source = fakeSource(), notes = [];
  const uninstall = installFavoriteCollections({}, message => notes.push(message), new CollectionsController(source));
  settle("m1", true);
  await flush();
  const picker = sheets.at(-1);
  assert.equal(picker.title, "加入集合");
  const names = buttons(picker.body).map(node => node.textContent);
  assert.deepEqual(names, ["视频", "不加入", "新建集合"], "only manual collections are offered");
  buttons(picker.body)[0].dispatch("click");
  await flush();
  assert.deepEqual(source.added, [["c1", "m1"]]);
  assert.equal(sheets.at(-1).title, "closed");
  assert.deepEqual(notes, ["已加入「视频」"]);
  uninstall();
});

test("a new collection can be made and filled from the same sheet", async () => {
  sheets.length = 0;
  const source = fakeSource(), notes = [];
  const uninstall = installFavoriteCollections({}, message => notes.push(message), new CollectionsController(source));
  settle("m2", true);
  await flush();
  buttons(sheets.at(-1).body).find(node => node.textContent === "新建集合").dispatch("click");
  assert.equal(sheets.at(-1).title, "新建集合");
  sheets.at(-1).body[0].submit("旅行");
  await flush();
  assert.deepEqual(source.added, [["c4", "m2"]]);
  assert.deepEqual(notes, ["已加入「旅行」"]);
  uninstall();
});

test("unfavouriting or a failed favourite never asks", async () => {
  sheets.length = 0;
  const uninstall = installFavoriteCollections({}, () => {}, new CollectionsController(fakeSource()));
  settle("m3", false);
  settle("m3", null);
  await flush();
  assert.equal(sheets.length, 0);
  uninstall();
  settle("m4", true);
  await flush();
  assert.equal(sheets.length, 0, "an uninstalled offer no longer listens");
});
