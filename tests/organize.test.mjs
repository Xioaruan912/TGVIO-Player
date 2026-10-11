import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { installDom } from "./dom-stub.mjs";

const { flush } = installDom();
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
document.documentElement ??= document.createElement("html");
const timers = [];
window.setTimeout = fn => { timers.push(fn); return timers.length; };
window.clearTimeout = () => {};

async function load(file, deps) {
  const source = ts.transpileModule(await readFile(new URL("../src/" + file, import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/^import .* from .*;$/gm, "");
  const key = "__dep_" + file.replace(/\W/g, "_");
  globalThis[key] = deps;
  return import("data:text/javascript;base64," + Buffer.from(
    `const { ${Object.keys(deps).join(", ")} } = globalThis.${key};\n` + source).toString("base64"));
}
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const icon = name => element("i", "icon-" + name);
const sheetToggle = (title, sub, value, onChange) => { const row = element("button", "sheet-row-toggle", title); row.sub = sub; row.addEventListener("click", onChange); return row; };

const privacy = await load("cover-privacy.ts", { element, icon, sheetToggle });
const actionButton = (stack, label) => { const b = element("button", "action-btn"); b.append(element("small", "action-label", label)); return b; };
const iconStack = () => element("span", "icon-stack");
const opened = [];
const offered = [];
const { installOrganize } = await load("organize.ts", {
  actionButton, iconStack, element, icon, applyCoverPrivacy: privacy.applyCoverPrivacy,
  deleteWithUndo: null, openTagSheet: (host, id) => { opened.push(id); },
  offerCollections: id => { offered.push(id); return true; },
});

const find = (node, predicate) => [node, ...node.children.flatMap(child => find(child, predicate))].filter(predicate);
const byText = (node, text) => find(node, n => n.tagName === "button" && n.textContent.includes(text))[0];

test("covers start blurred, an eye shows one page, and the setting turns it off", () => {
  store.clear();
  const html = document.documentElement;
  privacy.applyCoverPrivacy();
  assert.ok(html.classList.contains("covers-private"), "blurred by default");
  const eye = privacy.coverRevealButton();
  eye.dispatch("click");
  assert.ok(!html.classList.contains("covers-private"), "the eye shows this page's covers");
  privacy.coverRevealButton();
  assert.ok(html.classList.contains("covers-private"), "a new page starts blurred again");
  privacy.setCoverBlur(false);
  assert.ok(!html.classList.contains("covers-private"));
  assert.equal(privacy.coverRevealButton().hidden, true, "no eye when nothing is blurred");
  privacy.setCoverBlur(true);
});

function makeHost(clips) {
  const root = element("main");
  const panel = element("section", "player-panel");
  panel.append(element("div", "clip-info"), element("div", "timeline"));
  const favoriteButton = element("button");
  const host = {
    sheet: {}, root, actionRail: element("div", "action-rail"), panel, favoriteButton,
    index: 0, removed: [], notes: [], deletes: [],
    currentClip: () => clips[host.index] ?? null,
    next: () => { host.index += 1; },
    removeClip: clip => { host.removed.push(clip.id); return () => host.removed.splice(host.removed.indexOf(clip.id), 1); },
    toggleFavorite: () => favoriteButton.classList.toggle("selected"),
    notify: message => host.notes.push(message),
    remove: async target => { host.deletes.push(target); target.restore = target.remove(); return "queued"; },
  };
  return host;
}
const clip = (id, deletable = true) => ({ id, deletable });

test("organize mode deletes, favourites and moves on, with honest counts", async () => {
  store.clear(); timers.length = 0;
  const host = makeHost([clip("a"), clip("b"), clip("c", false)]);
  const tools = installOrganize(host);
  const bar = find(host.panel, n => n.className === "organize-bar")[0];
  assert.equal(bar.hidden, true, "off until chosen");
  byText(host.actionRail, "整理模式").dispatch("click");
  assert.equal(bar.hidden, false);
  assert.ok(host.root.classList.contains("organizing"));
  assert.equal(store.get("tgvio.player.organize"), "on", "the mode is remembered");

  byText(bar, "删除").dispatch("click");
  await flush();
  assert.deepEqual(host.removed, ["a"], "no confirmation, the clip leaves at once");
  assert.match(find(bar, n => n.className === "organize-status")[0].textContent, /已删 1/);
  host.deletes[0].restore();
  assert.match(find(bar, n => n.className === "organize-status")[0].textContent, /已删 0/, "an undo uncounts it");

  host.index = 1;
  byText(bar, "加入集合").dispatch("click");
  assert.ok(host.favoriteButton.classList.contains("selected"), "加入集合 favourites the clip");
  timers.splice(0).forEach(fn => fn());
  assert.equal(host.index, 1, "it waits for the 加入集合 sheet");
  host.root.dispatch("playersheetclose");
  timers.splice(0).forEach(fn => fn());
  assert.equal(host.index, 2, "closing that sheet moves on");
  assert.match(find(bar, n => n.className === "organize-status")[0].textContent, /已收藏 1/);

  byText(bar, "删除").dispatch("click");
  assert.deepEqual(host.notes, ["这个视频不能删除"]);
  byText(bar, "标签").dispatch("click");
  assert.deepEqual(opened, ["c"]);
  byText(bar, "退出整理").dispatch("click");
  assert.equal(bar.hidden, true);
  assert.equal(tools.isOn(), false);
  tools.uninstall();
  assert.equal(find(host.panel, n => n.className === "organize-bar").length, 0);
});

test("an existing favourite is asked about collections straight away, never unfavourited", () => {
  store.clear(); timers.length = 0; offered.length = 0;
  const host = makeHost([clip("a"), clip("b")]);
  host.favoriteButton.classList.add("selected");
  installOrganize(host);
  byText(host.actionRail, "整理模式").dispatch("click");
  byText(find(host.panel, n => n.className === "organize-bar")[0], "加入集合").dispatch("click");
  assert.ok(host.favoriteButton.classList.contains("selected"));
  assert.deepEqual(offered, ["a"]);
});
