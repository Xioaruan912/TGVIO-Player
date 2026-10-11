import { api } from "./api";
import { element } from "./components/dom";
import { openSheet, closeSheet, sheetChoice, sheetNote, sheetSection, type SheetHost } from "./components/sheet";
import type { ContextPageLoader } from "./context-feed";
import { emptyFilters, type LibraryFilters } from "./library-filters";
import { tagApi } from "./tags";
import type { CollectionDto } from "./types";

/**
 * What the home feed plays: everything (the shuffled deck), the last days' new
 * clips, clips not yet watched, one tag, or one collection. Anything but
 * "everything" runs as a feed context, like 收藏's immersive play, and the
 * context's back button returns to everything.
 */
export type FeedSource =
  | { kind: "all" }
  | { kind: "new" }
  | { kind: "unwatched" }
  | { kind: "tag"; id: number; name: string }
  | { kind: "collection"; id: string; name: string };

export const NEW_DAYS = 3;
const BATCH = 20;

export type FeedSourceHost = {
  sheet: SheetHost;
  /** Play a context built from this loader; the host closes any open page first. */
  enter(loader: ContextPageLoader): void;
  /** Back to the shuffled deck. */
  leave(): void;
};

export type FeedSourceApi = {
  videos: typeof api.videos;
  collectionItems: typeof api.collectionItems;
  collections(): Promise<CollectionDto[]>;
  tags(): Promise<{ id: number; name: string }[]>;
};

const defaultApi: FeedSourceApi = {
  videos: (...args) => api.videos(...args),
  collectionItems: (...args) => api.collectionItems(...args),
  collections: () => api.collections(),
  tags: () => tagApi.list(),
};

let host: FeedSourceHost | null = null;
let current: FeedSource = { kind: "all" };
const listeners = new Set<(source: FeedSource) => void>();

export function setFeedSourceHost(next: FeedSourceHost | null): void { host = next; }
export function currentFeedSource(): FeedSource { return current; }

export function onFeedSourceChange(listener: (source: FeedSource) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(source: FeedSource): void {
  current = source;
  for (const listener of listeners) listener(source);
}

export function sourceLabel(source: FeedSource): string {
  switch (source.kind) {
    case "all": return "全部";
    case "new": return "新入库";
    case "unwatched": return "没看过";
    case "tag": return `#${source.name}`;
    case "collection": return source.name;
  }
}

/** Pages of one source. Wall queries page by offset; a random order keeps one seed. */
export function sourceLoader(source: FeedSource, client: FeedSourceApi = defaultApi,
  now: number = Date.now(), seed: number = Math.floor(Math.random() * 2_147_483_647)): ContextPageLoader {
  if (source.kind === "collection") {
    return async (cursor, signal) => client.collectionItems(source.id, BATCH, cursor, undefined, signal);
  }
  const shuffled: LibraryFilters = { ...emptyFilters(), sort: "random", seed };
  const filters: LibraryFilters =
    source.kind === "new" ? { ...emptyFilters(), dateFrom: Math.floor(now / 1000) - NEW_DAYS * 86_400, sort: "newest" }
      : source.kind === "unwatched" ? { ...shuffled, unwatched: true }
        : source.kind === "tag" ? { ...shuffled, tag: source.id }
          : shuffled;
  return async (cursor, signal) => {
    const offset = cursor === null ? 0 : Number(cursor);
    const page = await client.videos("short", BATCH, offset, false, "", signal, filters);
    return { items: page.items, hasMore: page.hasMore, nextCursor: page.hasMore ? String(offset + page.items.length) : null };
  };
}

/** Play a source in the feed; "all" returns to the shuffled deck. */
export function playFeedSource(source: FeedSource, client: FeedSourceApi = defaultApi): void {
  if (!host) return;
  if (source.kind === "all") host.leave();
  else host.enter(sourceLoader(source, client));
  announce(source);
}

/** The feed left its context some other way (its back button, another page). */
export function feedSourceEnded(): void {
  if (current.kind !== "all") announce({ kind: "all" });
}

export async function openFeedSourceSheet(client: FeedSourceApi = defaultApi): Promise<void> {
  const sheet = host?.sheet;
  if (!sheet) return;
  const pick = (source: FeedSource) => (): void => { closeSheet(sheet); playFeedSource(source, client); };
  const same = (source: FeedSource): boolean => JSON.stringify(source) === JSON.stringify(current);
  const fixed: Array<[FeedSource, string]> = [
    [{ kind: "all" }, "全部视频，随机"],
    [{ kind: "new" }, `最近 ${NEW_DAYS} 天新入库的短片，最新的在前`],
    [{ kind: "unwatched" }, "还没看完过的短片，随机"],
  ];
  const body: Node[] = fixed.map(([source, sub]) => sheetChoice(sourceLabel(source), sub, same(source), pick(source)));
  openSheet(sheet, "刷什么", [...body, sheetNote("正在读取标签与集合…")]);
  const [tags, collections] = await Promise.all([
    client.tags().catch(() => []),
    client.collections().catch(() => []),
  ]);
  body.push(sheetSection("标签"));
  if (!tags.length) body.push(sheetNote("还没有标签：在视频的「更多 → 标签」里添加"));
  for (const tag of tags) {
    const source: FeedSource = { kind: "tag", id: tag.id, name: tag.name };
    body.push(sheetChoice(sourceLabel(source), "只刷这个标签的短片", same(source), pick(source)));
  }
  body.push(sheetSection("集合"));
  const playable = collections.filter(item => item.kind !== "builtin");
  if (!playable.length) body.push(sheetNote("还没有集合"));
  for (const collection of playable) {
    const source: FeedSource = { kind: "collection", id: collection.collection_id, name: collection.name };
    body.push(sheetChoice(collection.name, `${collection.count} 个视频，按集合顺序`, same(source), pick(source)));
  }
  if (!sheet.sheet.hidden) openSheet(sheet, "刷什么", body);
}

/** The header chip that names the current source and opens the picker. */
export function feedSourceChip(): HTMLButtonElement {
  const chip = element("button", "feed-source-chip");
  chip.type = "button";
  const draw = (source: FeedSource): void => {
    chip.textContent = `${sourceLabel(source)} ▾`;
    chip.setAttribute("aria-label", `正在刷：${sourceLabel(source)}，点此切换`);
    chip.classList.toggle("is-filtered", source.kind !== "all");
  };
  draw(current);
  onFeedSourceChange(draw);
  chip.addEventListener("click", () => void openFeedSourceSheet());
  return chip;
}
