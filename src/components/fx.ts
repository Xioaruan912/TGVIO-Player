import { element } from "./dom";
import { icon } from "../icons";
import { motionAllowed } from "../motion";

/**
 * Decorative effects. Every element created here is aria-hidden, takes no pointer
 * input, removes itself, and is never created under prefers-reduced-motion. None
 * of them owns state: callers keep their own semantics (aria-pressed, labels) and
 * an effect that fails to run changes nothing.
 */

const DOT_COLORS = ["#ff6b81", "#e6c35c", "#e3c06a", "#f3d9a0", "#ffffff"];

function selfRemoving(node: HTMLElement, ms: number): HTMLElement {
  node.setAttribute("aria-hidden", "true");
  window.setTimeout(() => node.remove(), ms);
  return node;
}

/** Restart an element's `.is-entering` animation, e.g. a caption for a new clip. */
export function replayEntrance(target: HTMLElement): void {
  if (!motionAllowed()) return;
  target.classList.remove("is-entering");
  // Reading layout here is what lets the same class start the animation again.
  void target.offsetWidth;
  target.classList.add("is-entering");
}

/** A heart that pops and lifts away from the anchor, with a ring and a spray of dots. */
export function burstFrom(anchor: Element): void {
  if (!motionAllowed() || !anchor.isConnected) return;
  const box = anchor.getBoundingClientRect();
  if (!box.width && !box.height) return;
  const burst = selfRemoving(element("span", "fx-burst"), 800);
  burst.style.left = `${box.left + box.width / 2}px`;
  burst.style.top = `${box.top + box.height / 2}px`;
  const heart = element("span", "fx-burst-heart");
  heart.append(icon("heart-filled", 44));
  burst.append(element("span", "fx-burst-ring"), heart);
  const count = 12;
  for (let index = 0; index < count; index += 1) {
    const dot = element("span", "fx-burst-dot");
    dot.style.setProperty("--angle", `${(360 / count) * index + (index % 2 ? 8 : -8)}deg`);
    dot.style.setProperty("--dist", `${38 + (index % 3) * 12}px`);
    dot.style.setProperty("--dot-color", DOT_COLORS[index % DOT_COLORS.length]);
    burst.append(dot);
  }
  document.body.append(burst);
}

/** A soft ring spreading from a point of the given stage (coordinates are viewport px). */
export function rippleAt(stage: HTMLElement, clientX: number, clientY: number): void {
  if (!motionAllowed() || !stage.isConnected) return;
  const box = stage.getBoundingClientRect();
  const ripple = selfRemoving(element("span", "fx-ripple"), 700);
  ripple.style.left = `${clientX - box.left}px`;
  ripple.style.top = `${clientY - box.top}px`;
  stage.append(ripple);
}
