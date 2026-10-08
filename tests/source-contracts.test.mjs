// Source-level ownership contracts, ported from TGVIO tests/test_player_web_source.py.
// Behaviour tests remain the primary guard; these pin wiring that has regressed before.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const count = (text, needle) => text.split(needle).length - 1;

test("folder action and favorites have separate owners", () => {
  const ui = read("ui.ts"), main = read("main.ts");
  const actions = read("components/media-actions.ts"), panel = read("components/player-panel.ts");
  assert.ok(ui.includes("buildPlayerPanel(root, handlers, netSpeed)"));
  assert.ok(panel.includes("buildMediaActions(handlers)"));
  assert.ok(actions.includes('"浏览所在文件夹"'));
  assert.ok(main.includes("onOpenGroup: openCurrentFolder"));
  assert.ok(main.includes('void enterContext("favorites")'));
  assert.ok(!main.includes("async function openFavorites"));
});

test("selected playback never inserts an entire group into home", () => {
  const main = read("main.ts");
  assert.ok(!main.includes("function openGroupList"));
  assert.ok(!main.includes("feedView.insertAfter"));
  assert.ok(main.includes("new LibraryPlayback"));
  assert.ok(main.includes("加载失败，点击重试"));
  // One shared owner hands playback back to whichever grid started it, and the
  // idle minute is re-armed there too: a grid on screen is not an exemption.
  assert.equal(count(main, "createCollectionPlayback(active => { page?.setPlaybackActive(active);"), 2);
  assert.ok(main.includes("if (wasPlaying) syncPage(false);"));
});

test("favorites browse uses the cover grid and an explicit player", () => {
  const main = read("main.ts"), favorites = read("favorites.ts");
  assert.ok(main.includes("new FavoritesPage("));
  assert.ok(main.includes("openFavorites();"));
  assert.ok(favorites.includes("buildCoverTile"));
  // Browsing favorites never builds a player; playback stays explicit.
  assert.ok(!favorites.includes('createElement("video")'));
  assert.ok(favorites.includes("播放已加载 ("));
});

test("context requests abort and deduplicate old pages", () => {
  const context = read("context-feed.ts");
  assert.ok(context.includes("this.controller.abort()"));
  assert.ok(context.includes("requestGeneration !== this.generation"));
  assert.ok(context.includes("if (!known.has(clip.id))"));
});

test("playback owners never lose or resurrect control", () => {
  const main = read("main.ts"), large = read("large.ts"), playback = read("library-playback.ts");
  // A late feed retry must respect the current library/large-player owner.
  assert.ok(main.includes("const feedOwnsPlayback = (): boolean => !libraryPage && !favoritesPage && !longVideosOpen && !largePlayer;"));
  assert.equal(count(main, "!feedOwnsPlayback()"), 2);
  // A destroyed player must not resurrect its source after an awaited delete.
  assert.ok(large.includes("if (this.destroyed) return;"));
  // Only the live playlist player may return to selection after a delete.
  assert.ok(playback.includes("if (this.closed || this.player !== player) return;"));
});

test("automatic playlist advances share one real idle deadline", () => {
  const idle = read("idle-privacy.ts"), large = read("large.ts"), playback = read("library-playback.ts");
  assert.ok(idle.includes("export class IdleActivityWindow"));
  assert.ok(idle.includes("resetActivityOnEnable"));
  assert.ok(large.includes("activityWindow: options.idleWindow"));
  assert.ok(large.includes("resetActivityOnEnable: options.idleResetOnEnable"));
  assert.ok(playback.includes("idleWindow: this.idleWindow"));
  assert.ok(playback.includes("idleResetOnEnable: false"));
  assert.equal(count(playback, "this.idleWindow.touch()"), 2);
  assert.ok(large.includes("this.idlePrivacy.activity()"));
});

test("download action is wired to the attachment stream", () => {
  const main = read("main.ts"), ui = read("ui.ts"), icons = read("icons.ts");
  const actions = read("components/media-actions.ts"), panel = read("components/player-panel.ts");
  assert.ok(ui.includes("buildPlayerPanel(root, handlers, netSpeed)"));
  assert.ok(panel.includes("buildMediaActions(handlers)"));
  assert.ok(actions.includes('"下载原片"'));
  assert.ok(ui.includes("onDownload: () => void;"));
  assert.ok(actions.includes('downloadBtn.addEventListener("click", handlers.onDownload)'));
  assert.ok(main.includes("onDownload: downloadCurrent"));
  assert.ok(main.includes("`${clip.streamUrl}${separator}download=1`"));
  assert.ok(icons.includes('| "download"'));
});

test("seeking towards the end asks the server to warm the tail", () => {
  const main = read("main.ts"), api = read("api.ts");
  assert.ok(main.includes("warmTail(clip.id);"));
  assert.ok(main.includes("time >= video.duration * 0.7"));
  assert.ok(api.includes("async prepareTail(mediaId: string)"));
  assert.ok(api.includes("/prepare?tail=1"));
});

test("one cover unit is shared by every browse surface", () => {
  const tile = read("components/cover-tile.ts"), image = read("components/cover-image.ts");
  assert.ok(image.includes('export type CoverState = "loading" | "ready" | "missing" | "failed";'));
  assert.ok(tile.includes("bindCoverImage("));
  // An unknown duration is never rendered as 0:00.
  assert.ok(tile.includes('return "时长未知";'));
  // Selection and retry are their own controls: a button must never nest another button.
  assert.ok(tile.includes('element("button", "cover-tile-select")'));
  // Browsing is one play target; the cover exposes no inline preview control.
  assert.ok(!tile.includes("cover-tile-preview"));
  assert.ok(!tile.includes("onPreview"));
  for (const module of ["library.ts", "favorites.ts", "long.ts"]) {
    assert.ok(read(module).includes("buildCoverTile"), `${module} must reuse the shared cover unit`);
  }
});

test("library grid starts no media and gates selection behind a mode", () => {
  const library = read("library.ts"), masonry = read("components/cover-masonry.ts");
  assert.ok(library.includes('this.list.classList.add("cover-grid")'));
  assert.ok(library.includes("setSelectMode"));
  assert.ok(library.includes("this.selectionBar.hidden = !this.selectMode;"));
  // Browsing never builds a video element at all.
  assert.equal(count(library, 'createElement("video")'), 0);
  // A mixed short/long grid keeps every cover at its own aspect ratio and
  // packs it through the measured masonry pass instead of grid rows.
  assert.ok(library.includes('variant: clip.category === "long" ? "wide" : "portrait"'));
  assert.ok(library.includes("bindCoverMasonry("));
  assert.ok(masonry.includes("export function masonryPlace("));
  assert.ok(masonry.includes("export function bindCoverMasonry("));
});
