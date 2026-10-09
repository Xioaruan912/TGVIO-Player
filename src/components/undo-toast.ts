import { element } from "./dom";

/**
 * One short notice above every surface (feed, browse pages and the long player),
 * optionally with a single action such as 撤销. It lives on <body> because a browse
 * page or the long player can cover the shell's own toast. A new notice replaces the
 * previous one; a closed notice leaves the document, so its button can never keep a
 * tab stop or a hit area.
 */
export interface UndoToastOptions {
  message: string;
  seconds: number;
  actionLabel?: string;
  onAction?: () => void;
}

let closeCurrent: (() => void) | null = null;

export function showUndoToast(options: UndoToastOptions): () => void {
  closeCurrent?.();
  const root = element("div", "undo-toast");
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.append(element("span", "undo-toast-text", options.message));
  let timer = 0;
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    window.clearTimeout(timer);
    root.remove();
    if (closeCurrent === close) closeCurrent = null;
  };
  if (options.actionLabel && options.onAction) {
    const action = element("button", "undo-toast-action", options.actionLabel);
    action.type = "button";
    const onAction = options.onAction;
    action.addEventListener("click", () => { close(); onAction(); });
    // The bar only shows how long the action stays available; it carries no state.
    const countdown = element("span", "undo-toast-countdown");
    countdown.style.animationDuration = `${options.seconds}s`;
    root.append(action, countdown);
  }
  document.body.append(root);
  timer = window.setTimeout(close, Math.max(0, options.seconds) * 1000);
  closeCurrent = close;
  return close;
}
