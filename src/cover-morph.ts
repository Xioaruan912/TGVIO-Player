import { motionAllowed, supportsViewTransition } from "./motion";

/**
 * The cover grows into the player, and the player shrinks back into its cover.
 *
 * A View Transition with one shared name: the tapped cover's frame carries the
 * name in the old state, the player's stage carries it in the new state (see
 * cinema.css), and the browser morphs one into the other. Nothing here knows how a
 * page opens its player: the tap is held in the capture phase, then replayed inside
 * the transition so the page does exactly what it always does. Closing works the
 * same way on the player's back controls, morphing into the cover of the clip that
 * is playing now (a playlist may have moved on).
 *
 * Only covers on a browse page morph; covers in sheets (similar, duplicates) keep
 * their own behaviour. Without View Transitions or under reduced motion the taps
 * pass straight through.
 */
const NAME = "tgvio-morph";
const OPEN = ".browse-page .cover-tile:not(.is-select-mode) .cover-tile-play";
const CLOSE = ".large-player .large-back, .large-player .library-play-return";

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

let replaying = false;

function frameOf(mediaId: string | undefined): HTMLElement | null {
  if (!mediaId) return null;
  for (const tile of document.querySelectorAll<HTMLElement>(".browse-page .cover-tile")) {
    if (tile.dataset.mediaId === mediaId) return tile.querySelector<HTMLElement>(".cover-tile-media");
  }
  return null;
}

function morph(update: () => void, before: HTMLElement | null, after: () => HTMLElement | null): void {
  const doc = document as ViewTransitionDocument;
  if (before) before.style.setProperty("view-transition-name", NAME);
  document.documentElement.classList.add("is-morphing");
  const transition = doc.startViewTransition!(() => {
    if (before) before.style.removeProperty("view-transition-name");
    replaying = true;
    try { update(); } finally { replaying = false; }
    after()?.style.setProperty("view-transition-name", NAME);
  });
  void transition.finished.finally(() => {
    document.documentElement.classList.remove("is-morphing");
    after()?.style.removeProperty("view-transition-name");
  });
}

export function installCoverMorph(root: Document = document): () => void {
  if (!supportsViewTransition()) return () => undefined;
  const onClick = (event: Event): void => {
    if (replaying || !motionAllowed()) return;
    const target = event.target instanceof Element ? event.target : null;
    const open = target?.closest<HTMLElement>(OPEN);
    if (open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      morph(() => open.click(), open.querySelector<HTMLElement>(".cover-tile-media"), () => null);
      return;
    }
    const close = target?.closest<HTMLElement>(CLOSE);
    if (close) {
      const playing = document.querySelector<HTMLVideoElement>(".large-player .large-video")?.dataset.mediaId;
      const frame = frameOf(playing);
      if (!frame) return; // nothing to land on: close the ordinary way
      event.preventDefault();
      event.stopImmediatePropagation();
      morph(() => close.click(), null, () => frame);
    }
  };
  root.addEventListener("click", onClick, true);
  return () => root.removeEventListener("click", onClick, true);
}
