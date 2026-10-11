import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { installDom } from "./dom-stub.mjs";

const { flush } = installDom();
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };

async function load(file, deps) {
  const source = ts.transpileModule(await readFile(new URL("../src/" + file, import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/^import .* from .*;$/gm, "").replace(/^export \{.*\} from .*;$/gm, "");
  const key = "__dep_" + file.replace(/\W/g, "_");
  globalThis[key] = deps;
  return import("data:text/javascript;base64," + Buffer.from(
    `const { ${Object.keys(deps).join(", ")} } = globalThis.${key};\n` + source).toString("base64"));
}
const element = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const sheetRow = ({ title, sub, onPick }) => { const r = element("button", "sheet-row", title); r.sub = sub; r.addEventListener("click", onPick); return r; };

const ending = await load("playback-ending.ts", { sheetRow });

test("a clip that ends moves on, plays twice first, or loops, as chosen", () => {
  store.clear();
  const moves = [];
  ending.setFeedAdvance(() => moves.push(1));
  const video = element("video"); video.dataset.mediaId = "a";
  assert.equal(ending.endedAction(), "next", "moving on is the default");
  assert.equal(ending.advanceAfterEnd(video), true);
  ending.setEndedAction("twice");
  assert.equal(ending.advanceAfterEnd(video), false, "the first end replays");
  assert.equal(ending.advanceAfterEnd(video), true, "the second end moves on");
  ending.setEndedAction("loop");
  assert.equal(ending.advanceAfterEnd(video), false);
  assert.equal(moves.length, 2);
  ending.setFeedAdvance(null);
  ending.setEndedAction("next");
  assert.equal(ending.advanceAfterEnd(video), false, "nothing to move to before the feed exists");
});

test("the twice count restarts for a new clip in the same element", () => {
  store.clear(); ending.setEndedAction("twice");
  const moves = [];
  ending.setFeedAdvance(() => moves.push(1));
  const video = element("video");
  video.dataset.mediaId = "a"; ending.advanceAfterEnd(video);
  video.dataset.mediaId = "b";
  assert.equal(ending.advanceAfterEnd(video), false, "b has ended only once");
  ending.setFeedAdvance(null);
});

const sheets = [];
const deps = {
  api: null, tagApi: null, element, emptyFilters: () => ({ sort: "newest", seed: null, dateFrom: null, unwatched: null, tag: null }),
  openSheet: (_h, title, body) => sheets.push({ title, body }), closeSheet: () => sheets.push({ title: "closed" }),
  sheetChoice: (title, sub, selected, onPick) => { const r = element("button", "sheet-row-choice", title); r.selected = selected; r.addEventListener("click", onPick); return r; },
  sheetNote: text => element("p", "sheet-note", text), sheetSection: text => element("h2", "sheet-section", text),
};
const source = await load("feed-source.ts", deps);

function fakeClient() {
  const calls = [];
  return {
    calls,
    videos: async (category, limit, offset, _c, _s, _signal, filters) => {
      calls.push({ category, offset, filters });
      return { items: Array.from({ length: offset === 0 ? limit : 3 }, (_, i) => ({ id: `v${offset + i}` })), hasMore: offset === 0, total: null };
    },
    collectionItems: async (id, limit, cursor) => { calls.push({ id, cursor }); return { items: [{ id: "c1" }], hasMore: false, nextCursor: null }; },
    collections: async () => [{ collection_id: "b", name: "收藏", kind: "builtin", count: 9 }, { collection_id: "x", name: "射了", kind: "manual", count: 3 }],
    tags: async () => [{ id: 4, name: "黑丝" }],
  };
}

test("each source asks the wall for its own short clips, page by page", async () => {
  const client = fakeClient();
  const now = 1_800_000_000_000;
  const fresh = source.sourceLoader({ kind: "new" }, client, now, 7);
  const first = await fresh(null, undefined);
  assert.equal(first.nextCursor, "20");
  await fresh(first.nextCursor, undefined);
  assert.deepEqual(client.calls.map(c => [c.category, c.offset]), [["short", 0], ["short", 20]]);
  assert.equal(client.calls[0].filters.dateFrom, 1_800_000_000 - 3 * 86_400);
  assert.equal(client.calls[0].filters.sort, "newest");
  await source.sourceLoader({ kind: "tag", id: 4, name: "黑丝" }, client, now, 7)(null, undefined);
  assert.deepEqual([client.calls.at(-1).filters.tag, client.calls.at(-1).filters.sort, client.calls.at(-1).filters.seed], [4, "random", 7]);
  await source.sourceLoader({ kind: "unwatched" }, client, now, 7)(null, undefined);
  assert.equal(client.calls.at(-1).filters.unwatched, true);
  const members = await source.sourceLoader({ kind: "collection", id: "x", name: "射了" }, client)(null, undefined);
  assert.deepEqual(members.items, [{ id: "c1" }]);
});

test("picking a source enters a context; 全部 leaves it; the chip follows", async () => {
  const events = [];
  const sheet = { sheet: { hidden: false } };
  source.setFeedSourceHost({ sheet, enter: () => events.push("enter"), leave: () => events.push("leave") });
  const chip = source.feedSourceChip();
  assert.equal(chip.textContent, "全部 ▾");
  const client = fakeClient();
  await source.openFeedSourceSheet(client);
  const rows = sheets.at(-1).body.filter(n => n.className === "sheet-row-choice").map(r => r.textContent);
  assert.deepEqual(rows, ["全部", "新入库", "没看过", "#黑丝", "射了"], "fixed sources, tags, then collections (not the builtin)");
  sheets.at(-1).body.find(n => n.textContent === "#黑丝").dispatch("click");
  assert.deepEqual(events, ["enter"]);
  assert.equal(chip.textContent, "#黑丝 ▾");
  source.feedSourceEnded();
  assert.equal(chip.textContent, "全部 ▾", "the context's back button returns the chip to 全部");
  source.playFeedSource({ kind: "collection", id: "x", name: "射了" }, client);
  source.playFeedSource({ kind: "all" }, client);
  assert.deepEqual(events, ["enter", "enter", "leave"]);
  source.setFeedSourceHost(null);
});

globalThis.MutationObserver ??= class { observe() {} disconnect() {} };
test("a middle double tap only ever adds a favourite, and swipes act only in 整理模式", async () => {
  let organizing = false;
  const actions = [];
  const feedTools = await load("feed-tools.ts", {
    element, icon: () => element("i"), sheetToggle: () => element("button"),
    feedSourceChip: () => element("button", "feed-source-chip"), feedSourceEnded: () => {}, setFeedSourceHost: () => {},
    setFeedAdvance: () => {},
    installOrganize: () => ({ isOn: () => organizing, deleteCurrent: () => actions.push("delete"), collectCurrent: () => actions.push("collect"), uninstall: () => {} }),
  });
  const topbar = element("header");
  const contextBack = element("button", "context-back");
  topbar.append(contextBack, element("div", "topbar-brand"));
  const root = element("main");
  const favoriteButton = element("button");
  let toggles = 0;
  feedTools.installFeedTools({
    root, favoriteButton, contextBack, sheet: {}, actionRail: element("div"), panel: element("section"),
    currentClip: () => ({ id: "a" }), next: () => {}, removeClip: () => () => {}, notify: () => {},
    toggleFavorite: () => { toggles += 1; favoriteButton.classList.toggle("selected"); },
    enterSource: () => {}, leaveSource: () => {},
  });
  const gestures = feedTools.extendFeedGestures({});
  gestures.onDoubleTapCenter(10, 10);
  gestures.onDoubleTapCenter(10, 10);
  assert.equal(toggles, 1, "a second like does not unfavourite");
  root.classList.add("privacy-locked");
  favoriteButton.classList.remove("selected");
  gestures.onDoubleTapCenter(10, 10);
  assert.equal(toggles, 1, "a locked picture takes no like");
  root.classList.remove("privacy-locked");
  assert.equal(gestures.isSwipeEnabled(), false, "outside 整理模式 a drag still seeks");
  organizing = true;
  assert.equal(gestures.isSwipeEnabled(), true);
  gestures.onSwipe("left"); gestures.onSwipe("right");
  assert.deepEqual(actions, ["delete", "collect"]);
  gestures.onSwipeMove(-60);
  assert.ok(root.classList.contains("swipe-delete"));
  gestures.onSwipeMove(0);
  assert.ok(!root.classList.contains("swiping"));
  assert.equal(topbar.children[2].className, "feed-source-chip", "the chip sits beside the brand");
});
