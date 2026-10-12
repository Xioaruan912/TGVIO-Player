import { element } from "./components/dom";
import { sheetToggle } from "./components/sheet";
import { feedSourceChip, feedSourceEnded, setFeedSourceHost } from "./feed-source";
import type { ContextPageLoader } from "./context-feed";
import type { GestureOptions } from "./gestures";
import { icon } from "./icons";
import { installOrganize, type OrganizeHost } from "./organize";
import { setFeedAdvance } from "./playback-ending";
import { installCoverMorph } from "./cover-morph";
import { installCountRoll } from "./count-roll";
import { motionAllowed } from "./motion";

export { advanceAfterEnd } from "./playback-ending";

/**
 * Everything the home feed gets from feature modules, wired in one place so the
 * application shell only hands over its handles:
 *  - 整理模式 (organize.ts), and its swipes: left deletes, right adds to a collection;
 *  - a double tap in the middle of the picture favourites the clip, with a heart;
 *  - the 刷什么 chip and the feed sources (feed-source.ts);
 *  - what a clip does when it ends (playback-ending.ts).
 */
export type FeedToolsHost = OrganizeHost & {
  /** The context back button; hidden means the feed is back on the shuffled deck. */
  contextBack: HTMLButtonElement;
  enterSource(loader: ContextPageLoader): void;
  leaveSource(): void;
};

type GestureTools = {
  like(clientX: number, clientY: number): void;
  swipeEnabled(): boolean;
  swipeMove(dx: number): void;
  swipe(direction: "left" | "right"): void;
};

const LIKE_KEY = "tgvio.player.centerLike";
const DECK_KEY = "tgvio.player.deck";
const FLY_MS = 280;
let tools: GestureTools | null = null;

export function centerLikeEnabled(): boolean {
  try { return localStorage.getItem(LIKE_KEY) !== "off"; } catch { return true; }
}

export function centerLikeRow(rerender: () => void): HTMLButtonElement {
  const enabled = centerLikeEnabled();
  return sheetToggle("双击中间收藏", enabled ? "双击画面中间收藏，并弹出加入集合" : "已关闭", enabled, () => {
    try { localStorage.setItem(LIKE_KEY, enabled ? "off" : "on"); } catch { /* this page only */ }
    rerender();
  });
}

export function deckEnabled(): boolean {
  try { return localStorage.getItem(DECK_KEY) !== "off"; } catch { return true; }
}

/** 刷片翻卡: the leaving clip sinks back and dims as the next one slides over it. */
export function deckRow(rerender: () => void): HTMLButtonElement {
  const enabled = deckEnabled();
  return sheetToggle("刷片翻卡效果", enabled ? "上下滑动时，旧视频缩小变暗，新视频盖上来" : "已关闭", enabled, () => {
    try { localStorage.setItem(DECK_KEY, enabled ? "off" : "on"); } catch { /* this page only */ }
    document.documentElement.classList.toggle("deck-off", enabled);
    rerender();
  });
}

/** The feed's gesture options plus the double-tap like and the organize swipes. */
export function extendFeedGestures<T extends GestureOptions>(options: T): T {
  return {
    ...options,
    onDoubleTapCenter: (x: number, y: number) => tools?.like(x, y),
    isCenterDoubleTapEnabled: () => tools !== null && centerLikeEnabled(),
    isSwipeEnabled: () => tools?.swipeEnabled() ?? false,
    onSwipeMove: (dx: number) => tools?.swipeMove(dx),
    onSwipe: (direction: "left" | "right") => tools?.swipe(direction),
  };
}

function heartAt(x: number, y: number): void {
  const heart = element("span", "like-burst");
  heart.setAttribute("aria-hidden", "true");
  heart.style.left = `${x}px`;
  heart.style.top = `${y}px`;
  heart.append(icon("heart-filled", 72));
  document.body.append(heart);
  window.setTimeout(() => heart.remove(), 900);
}

export function installFeedTools(host: FeedToolsHost): () => void {
  document.documentElement.classList.toggle("deck-off", !deckEnabled());
  // App-wide motion add-ons live here because this is the one install point the
  // shell calls: covers grow into the player, list counts roll up.
  const unmorph = installCoverMorph();
  const unroll = installCountRoll();
  const animateOut = (kind: "delete" | "collect"): Promise<void> => {
    if (!motionAllowed()) return Promise.resolve();
    const cls = kind === "delete" ? "fly-delete" : "fly-collect";
    host.root.classList.add(cls);
    if (kind === "collect") {
      const rect = host.root.getBoundingClientRect();
      heartAt(rect.left + rect.width / 2, rect.top + rect.height * 0.4);
      window.setTimeout(() => host.root.classList.remove(cls), 420);
      return Promise.resolve();
    }
    return new Promise(resolve => window.setTimeout(() => {
      resolve();
      // After the removal ran (queued first), so the next clip never shows flown away.
      queueMicrotask(() => host.root.classList.remove(cls));
    }, FLY_MS));
  };
  const organize = installOrganize({ ...host, animateOut });
  setFeedAdvance(host.next);
  setFeedSourceHost({ sheet: host.sheet, enter: host.enterSource, leave: host.leaveSource, notify: host.notify });
  const chip = feedSourceChip();
  // Beside the brand, in the header row the context back button shares.
  const brand = host.contextBack.parentElement?.querySelector(".topbar-brand") ?? host.contextBack;
  brand.after(chip);
  const watcher = new MutationObserver(() => { if (host.contextBack.hidden) feedSourceEnded(); });
  watcher.observe(host.contextBack, { attributes: true, attributeFilter: ["hidden"] });
  const locked = (): boolean => host.root.classList.contains("privacy-locked");
  tools = {
    like: (x, y) => {
      if (locked() || !host.currentClip()) return;
      heartAt(x, y);
      // A like only ever adds; a second double tap never takes the favourite away.
      if (!host.favoriteButton.classList.contains("selected")) host.toggleFavorite();
    },
    swipeEnabled: () => organize.isOn() && !locked(),
    swipeMove: dx => {
      host.root.style.setProperty("--swipe-x", `${dx}px`);
      host.root.style.setProperty("--swipe-r", `${(dx / 22).toFixed(2)}deg`);
      host.root.classList.toggle("swiping", dx !== 0);
      host.root.classList.toggle("swipe-delete", dx < -40);
      host.root.classList.toggle("swipe-collect", dx > 40);
    },
    swipe: direction => (direction === "left" ? organize.deleteCurrent() : organize.collectCurrent()),
  };
  return () => {
    tools = null;
    unmorph();
    unroll();
    watcher.disconnect();
    chip.remove();
    setFeedAdvance(null);
    setFeedSourceHost(null);
    organize.uninstall();
  };
}
