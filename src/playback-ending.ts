import { sheetRow } from "./components/sheet";

/**
 * What a short clip does when it ends in the feed: start again (the old
 * behaviour), move to the next clip, or play twice and then move on.
 * The pool asks `advanceAfterEnd` before restarting a clip; true means the feed
 * has moved on and the clip must not restart.
 */
export type EndedAction = "next" | "twice" | "loop";
const ACTIONS: EndedAction[] = ["next", "twice", "loop"];
const LABELS: Record<EndedAction, string> = {
  next: "播完自动下一条",
  twice: "循环 2 遍后下一条",
  loop: "一直循环",
};
const KEY = "tgvio.player.ended";

let advance: (() => void) | null = null;
const plays = new WeakMap<HTMLVideoElement, { id: string; ends: number }>();

export function endedAction(): EndedAction {
  try {
    const value = localStorage.getItem(KEY);
    return ACTIONS.includes(value as EndedAction) ? value as EndedAction : "next";
  } catch {
    return "next";
  }
}

export function setEndedAction(action: EndedAction): void {
  try { localStorage.setItem(KEY, action); } catch { /* this page only */ }
}

/** How the feed moves to its next clip; set once the feed exists. */
export function setFeedAdvance(next: (() => void) | null): void {
  advance = next;
}

export function advanceAfterEnd(video: HTMLVideoElement): boolean {
  const action = endedAction();
  if (action === "loop" || !advance) return false;
  const id = video.dataset.mediaId ?? "";
  const seen = plays.get(video);
  const record = seen && seen.id === id ? seen : { id, ends: 0 };
  record.ends += 1;
  plays.set(video, record);
  if (record.ends < (action === "twice" ? 2 : 1)) return false;
  plays.delete(video);
  advance();
  return true;
}

/** The settings row: each tap moves to the next choice. */
export function endedRow(rerender: () => void): HTMLElement {
  const current = endedAction();
  return sheetRow({
    title: "短片播完后",
    sub: LABELS[current],
    onPick: () => {
      setEndedAction(ACTIONS[(ACTIONS.indexOf(current) + 1) % ACTIONS.length]);
      rerender();
    },
  });
}
