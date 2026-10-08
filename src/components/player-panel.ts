import { buildActionMenu } from "./action-menu";
import { icon } from "../icons";
import type { ShellHandlers } from "../ui";
import { element } from "./dom";
import { buildTimeline } from "./timeline";
import { buildMediaActions } from "./media-actions";
import { replayEntrance } from "./fx";

/**
 * Presentation only: playback state and callbacks belong to the controller.
 *
 * The panel is the clip strip along the bottom of the picture (title, meta, cache
 * readout, progress). The transport is a vertical action rail floating above the
 * strip's right edge; it stays inside the panel element so every control keeps one
 * owner, and it is positioned out of the strip's box so the strip stays compact.
 */
export function buildPlayerPanel(root: HTMLElement, handlers: ShellHandlers, cache: HTMLElement) {
  const panel = element("section", "player-panel");
  panel.setAttribute("aria-label", "播放控制");
  const actions = buildMediaActions(handlers);
  const info = element("div", "clip-info");
  const title = element("h1", "clip-title", "视频");
  const meta = element("p", "clip-meta", "");
  cache.classList.add("panel-cache");
  info.append(title, meta, cache);
  // A new clip slides its caption in. Only the text changes, so the observer never
  // touches the video nodes or the controls.
  new MutationObserver(() => replayEntrance(info)).observe(title, { childList: true, characterData: true, subtree: true });
  const timeline = buildTimeline();
  const transport = element("div", "transport-row");
  transport.setAttribute("role", "group");
  transport.setAttribute("aria-label", "视频操作");
  const playBtn = element("button", "transport-play");
  playBtn.type = "button";
  const playIcon = icon("play", 24); playIcon.classList.add("icon-play");
  const pauseIcon = icon("pause", 24); pauseIcon.classList.add("icon-pause");
  const label = element("span", "transport-label", "播放");
  playBtn.append(playIcon, pauseIcon, label);
  const sync = () => {
    const locked = root.classList.contains("privacy-locked") || root.dataset.playbackState === "privacy-locked";
    const playing = !locked && root.dataset.playbackState === "playing";
    playIcon.style.display = playing ? "none" : "";
    pauseIcon.style.display = playing ? "" : "none";
    label.textContent = locked ? "解锁并播放" : playing ? "暂停" : "播放";
    playBtn.setAttribute("aria-label", label.textContent);
  };
  playBtn.addEventListener("click", () => {
    if (root.classList.contains("privacy-locked") || ["privacy-locked", "autoplay-blocked"].includes(root.dataset.playbackState ?? "")) handlers.onPlayGesture();
    else handlers.onTogglePlayback();
  });
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["class", "data-playback-state"] });
  sync();
  const more = buildActionMenu(actions.actionRail);
  transport.append(playBtn, actions.favoriteBtn, actions.soundBtn, actions.privacyLockBtn, more);
  panel.append(info, timeline.row, transport);
  return { panel, title, meta, playBtn, ...timeline, ...actions };
}
