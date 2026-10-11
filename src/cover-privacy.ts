import { element } from "./components/dom";
import { sheetToggle } from "./components/sheet";
import { icon } from "./icons";

/**
 * Covers are blurred by default on every browse surface (library, favourites, long
 * videos, duplicate and similar sheets), so a grid can be opened in public. The eye
 * button in a page header shows that page's covers until the page closes; a new
 * page starts blurred again. The setting turns the blur off for good.
 *
 * One class on <html> drives it, so no tile has to know: `.covers-private`.
 */
const KEY = "tgvio.player.coverBlur";
let revealed = false;

export function coverBlurEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function applyCoverPrivacy(root: HTMLElement = document.documentElement): void {
  root.classList.toggle("covers-private", coverBlurEnabled() && !revealed);
}

export function setCoverBlur(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, enabled ? "on" : "off");
  } catch {
    // Private mode without storage: the choice lasts for this page only.
  }
  revealed = false;
  applyCoverPrivacy();
}

/** The header eye button of one browse page; building it starts the page blurred. */
export function coverRevealButton(): HTMLButtonElement {
  revealed = false;
  applyCoverPrivacy();
  const button = element("button", "library-button cover-reveal");
  button.type = "button";
  const draw = (): void => {
    const shown = revealed || !coverBlurEnabled();
    button.replaceChildren(icon(shown ? "eye-off" : "eye", 20));
    button.setAttribute("aria-label", shown ? "模糊封面" : "显示封面");
    button.setAttribute("aria-pressed", shown ? "true" : "false");
  };
  button.addEventListener("click", () => {
    if (!coverBlurEnabled()) return;
    revealed = !revealed;
    applyCoverPrivacy();
    draw();
  });
  button.hidden = !coverBlurEnabled();
  draw();
  return button;
}

/** Leaving a page forgets its reveal. */
export function forgetCoverReveal(): void {
  revealed = false;
  applyCoverPrivacy();
}

export function coverBlurRow(rerender: () => void): HTMLButtonElement {
  const enabled = coverBlurEnabled();
  return sheetToggle(
    "封面模糊",
    enabled ? "片库与收藏的封面默认模糊，点页面右上角的眼睛临时显示" : "已关闭，封面直接显示",
    enabled,
    () => { setCoverBlur(!coverBlurEnabled()); rerender(); },
  );
}
