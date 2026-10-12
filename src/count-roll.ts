import { motionAllowed } from "./motion";

/**
 * Counts that appear on a list (videos per date, members per collection) roll up
 * from zero to their value once, like a split-flap counter. Only the leading number
 * changes; the rest of the label (" 个视频") stays as rendered. Tabular figures keep
 * the width still while it rolls. Off under reduced motion.
 */
const SELECTOR = ".directory-count, .collection-row-count";
const DURATION = 700;
const NUMBER = /^(\d+)(.*)$/s;

export function rollFrame(value: number, elapsed: number, duration = DURATION): number {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return Math.round(value * (1 - Math.pow(1 - t, 3)));
}

function roll(element: HTMLElement, now: () => number, frame: (cb: (time: number) => void) => void): void {
  const match = NUMBER.exec(element.textContent ?? "");
  if (!match) return;
  const value = Number(match[1]);
  const rest = match[2];
  if (!Number.isFinite(value) || value < 2) return;
  const started = now();
  const step = (): void => {
    if (!element.isConnected) return;
    const shown = rollFrame(value, now() - started);
    element.textContent = `${shown}${rest}`;
    if (shown < value) frame(step);
  };
  element.textContent = `0${rest}`;
  frame(step);
}

export function installCountRoll(root: HTMLElement = document.body,
  now: () => number = () => performance.now(),
  frame: (cb: (time: number) => void) => void = cb => { window.requestAnimationFrame(cb); }): () => void {
  const observer = new MutationObserver(records => {
    if (!motionAllowed()) return;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const found = node.matches(SELECTOR) ? [node] : [...node.querySelectorAll<HTMLElement>(SELECTOR)];
        for (const element of found) roll(element, now, frame);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
