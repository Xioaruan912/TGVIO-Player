import { actionButton, iconStack } from "./components/controls";
import { element } from "./components/dom";
import type { SheetHost } from "./components/sheet";
import { applyCoverPrivacy } from "./cover-privacy";
import { icon, type IconName } from "./icons";
import { deleteWithUndo, type DeletionResult, type DeletionTarget } from "./media-deletion";
import { openTagSheet } from "./tags";
import type { Clip } from "./types";

/**
 * 整理模式 for the short-video feed: three large buttons under the picture -
 * 删除 (with the usual undo, but without the confirmation dialog), 收藏 and
 * 下一个 - and a running count. A delete or a favourite moves on by itself, so a
 * pile of new clips can be sorted one thumb-press each. 标签 opens the current
 * clip's tags. The 更多 menu gains 整理模式 and 标签 entries.
 *
 * The feed keeps its own behaviour; this module only calls what the host hands it.
 */
export type OrganizeHost = {
  sheet: SheetHost;
  root: HTMLElement;
  actionRail: HTMLElement;
  panel: HTMLElement | undefined;
  favoriteButton: HTMLButtonElement;
  currentClip(): Clip | null;
  next(): void;
  /** Takes the clip out of every view now; returns how to put it back. */
  removeClip(clip: Clip): () => void;
  toggleFavorite(): void;
  notify(message: string): void;
  remove?: (target: DeletionTarget) => Promise<DeletionResult>;
};

const KEY = "tgvio.player.organize";
const ADVANCE_MS = 350;

function stored(): boolean {
  try { return localStorage.getItem(KEY) === "on"; } catch { return false; }
}

function store(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* this page only */ }
}

function bigButton(name: IconName, label: string, className: string): HTMLButtonElement {
  const button = element("button", "organize-btn " + className);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.append(icon(name, 26), element("span", "organize-btn-label", label));
  return button;
}

export function installOrganize(host: OrganizeHost): () => void {
  applyCoverPrivacy();
  const remove = host.remove ?? deleteWithUndo;
  const counts = { deleted: 0, favorited: 0 };
  let on = false;
  let timer = 0;

  const bar = element("div", "organize-bar");
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "整理模式");
  const status = element("p", "organize-status");
  const exit = element("button", "organize-exit", "退出整理");
  exit.type = "button";
  const head = element("div", "organize-head");
  head.append(status, exit);
  const deleteButton = bigButton("trash", "删除", "organize-delete");
  const tagButton = bigButton("tag", "标签", "organize-tag");
  const favoriteButton = bigButton("heart", "收藏", "organize-favorite");
  const nextButton = bigButton("play", "下一个", "organize-next");
  const row = element("div", "organize-row");
  row.append(deleteButton, tagButton, favoriteButton, nextButton);
  bar.append(head, row);
  bar.hidden = true;

  const showCounts = (): void => {
    status.textContent = `整理中 · 已删 ${counts.deleted} · 已收藏 ${counts.favorited}`;
  };
  const advance = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => host.next(), ADVANCE_MS);
  };
  const setMode = (next: boolean): void => {
    on = next;
    store(on);
    bar.hidden = !on;
    host.root.classList.toggle("organizing", on);
    modeEntry.setAttribute("aria-pressed", on ? "true" : "false");
    modeEntry.querySelector(".action-label")!.textContent = on ? "退出整理" : "整理模式";
    showCounts();
  };

  deleteButton.addEventListener("click", () => {
    const clip = host.currentClip();
    if (!clip) return;
    if (!clip.deletable) { host.notify("这个视频不能删除"); return; }
    counts.deleted += 1;
    showCounts();
    // The removal itself shows the next clip; an undo puts this one back and uncounts it.
    void remove({
      mediaId: clip.id,
      remove: () => {
        const restore = host.removeClip(clip);
        return () => { counts.deleted = Math.max(0, counts.deleted - 1); showCounts(); restore(); };
      },
    });
  });
  favoriteButton.addEventListener("click", () => {
    if (!host.currentClip()) return;
    if (!host.favoriteButton.classList.contains("selected")) {
      host.toggleFavorite();
      counts.favorited += 1;
      showCounts();
    }
    advance();
  });
  nextButton.addEventListener("click", () => host.next());
  const openTags = (): void => {
    const clip = host.currentClip();
    if (clip) void openTagSheet(host.sheet, clip.id, host.notify);
  };
  tagButton.addEventListener("click", openTags);
  exit.addEventListener("click", () => setMode(false));

  const modeEntry = actionButton(iconStack([["check", "icon-single"]], 30), "整理模式", "整理模式：删除、收藏、下一个");
  modeEntry.addEventListener("click", () => setMode(!on));
  const tagEntry = actionButton(iconStack([["tag", "icon-single"]], 30), "标签", "给当前视频打标签");
  tagEntry.addEventListener("click", openTags);
  host.actionRail.prepend(modeEntry, tagEntry);

  // Under the clip caption, above the progress bar.
  const info = host.panel?.firstElementChild;
  if (info) info.after(bar); else host.panel?.append(bar);
  setMode(stored());

  return () => {
    window.clearTimeout(timer);
    bar.remove();
    modeEntry.remove();
    tagEntry.remove();
    host.root.classList.remove("organizing");
  };
}
