import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { installDom } from "./dom-stub.mjs";

const { flush } = installDom();

const source = ts.transpileModule(await readFile(new URL("../src/watched.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/^import .* from .*;$/gm, "");
globalThis.__watchedDeps = {
  api: null, MOCK_MODE: false,
  sheetRow: ({ title, sub, onPick }) => {
    const row = document.createElement("button");
    const subNode = document.createElement("small"); subNode.className = "sheet-row-sub"; subNode.textContent = sub;
    row.append(document.createElement("strong"), subNode);
    row.title = title; row.addEventListener("click", onPick);
    return row;
  },
};
const { installWatchedTracker, watchedForgetRow, forgetLabel } = await import("data:text/javascript;base64," + Buffer.from(
  "const { api, MOCK_MODE, sheetRow } = globalThis.__watchedDeps;\n" + source).toString("base64"));

function fakeRoot() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: (type, fn, capture) => { assert.equal(capture, true); listeners.set(type, fn); },
    removeEventListener: type => listeners.delete(type),
    fire(type, video) { listeners.get(type)?.({ type, target: video }); },
  };
}
const video = (id, currentTime, duration) => ({ dataset: id ? { mediaId: id } : {}, currentTime, duration });

test("a video is marked once, after most of it played", async () => {
  const marked = [], root = fakeRoot();
  const uninstall = installWatchedTracker({ mark: async id => { marked.push(id); } }, root);
  root.fire("timeupdate", video("a", 5, 10));
  root.fire("timeupdate", video("a", NaN, NaN));
  root.fire("timeupdate", video(null, 9, 10));
  assert.deepEqual(marked, []);
  root.fire("timeupdate", video("a", 8, 10));
  root.fire("timeupdate", video("a", 9, 10));
  root.fire("ended", video("b", 1, NaN));
  assert.deepEqual(marked, ["a", "b"]);
  uninstall();
  assert.equal(root.listeners.size, 0);
});

test("a failed mark is sent again next time", async () => {
  let fail = true;
  const marked = [], root = fakeRoot();
  installWatchedTracker({ mark: async id => { marked.push(id); if (fail) throw new Error("offline"); } }, root);
  root.fire("ended", video("a", 1, 1));
  await flush();
  fail = false;
  root.fire("ended", video("a", 1, 1));
  root.fire("ended", video("a", 1, 1));
  assert.deepEqual(marked, ["a", "a"]);
});

test("the settings row steps through the offered windows", async () => {
  let current = 15;
  const saved = [];
  const choices = [null, 7, 15, 30];
  const row = watchedForgetRow({
    settings: async () => ({ forget_after_days: current, choices }),
    setForgetAfterDays: async days => { saved.push(days); current = days; return { forget_after_days: days, choices }; },
  });
  await flush();
  const sub = () => row.querySelector(".sheet-row-sub").textContent;
  assert.equal(sub(), "半个月后重新算作没看过");
  row.dispatch("click");
  await flush();
  row.dispatch("click");
  await flush();
  assert.deepEqual(saved, [30, null]);
  assert.equal(sub(), forgetLabel(null));
  assert.equal(forgetLabel(60), "2 个月后重新算作没看过");
});
