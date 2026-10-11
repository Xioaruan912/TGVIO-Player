/**
 * The duplicate review: videos whose covers and lengths are nearly identical,
 * one card per group. The viewer keeps one copy (the others go through the usual
 * delete with undo) or says the group is not a duplicate, which the server
 * remembers. Tapping a cover previews that copy inside its card.
 */
import { api, clipFromMedia, MOCK_MODE } from "./api";
import { element } from "./components/dom";
import { buildCoverTile } from "./components/cover-tile";
import { openSheet, sheetNote, sheetRow, type SheetHost } from "./components/sheet";
import { deleteWithUndo, type DeletionResult } from "./media-deletion";
import type { Clip, MediaDto } from "./types";

type DuplicatesPayload = { groups: { items: MediaDto[] }[]; total: number };
export type DuplicateGroups = { groups: Clip[][]; total: number };

export type DuplicateSource = {
  load(): Promise<DuplicateGroups>;
  dismiss(mediaIds: string[]): Promise<unknown>;
  remove(clip: Clip, hide: () => () => void): Promise<DeletionResult>;
};

export const duplicateApi: DuplicateSource = {
  load: async () => {
    if (MOCK_MODE) return { groups: [], total: 0 };
    const payload = await api.request<DuplicatesPayload>("/api/v1/duplicates");
    return { groups: payload.groups.map(group => group.items.map(clipFromMedia)), total: payload.total };
  },
  dismiss: mediaIds => MOCK_MODE ? Promise.resolve() : api.request("/api/v1/duplicates/dismiss", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media_ids: mediaIds }),
  }),
  remove: (clip, hide) => deleteWithUndo({ mediaId: clip.id, remove: hide }),
};

export function describeCopy(clip: Clip): string {
  const size = clip.sizeBytes >= 1024 ** 3 ? `${(clip.sizeBytes / 1024 ** 3).toFixed(2)} GB`
    : `${Math.max(1, Math.round(clip.sizeBytes / 1024 ** 2))} MB`;
  const minutes = Math.floor(clip.duration / 60), seconds = String(clip.duration % 60).padStart(2, "0");
  const height = clip.height && clip.width ? `${Math.min(clip.width, clip.height)}p · ` : "";
  return `${height}${size} · ${minutes}:${seconds}`;
}

/** One group's card; `done` runs once the group is settled (kept or dismissed). */
export function buildDuplicateGroup(group: Clip[], source: DuplicateSource, done: (card: HTMLElement) => void): HTMLElement {
  const card = element("section", "duplicate-group");
  const tiles = element("div", "duplicate-tiles");
  const preview = element("video", "duplicate-preview");
  preview.controls = true; preview.playsInline = true; preview.hidden = true;
  const status = element("p", "duplicate-status");
  const rows = new Map<string, HTMLElement>();
  const keepOne = (kept: Clip): void => {
    const others = group.filter(clip => clip.id !== kept.id);
    preview.pause(); preview.hidden = true;
    status.textContent = `已保留 ${describeCopy(kept)}，删除其余 ${others.length} 个`;
    for (const clip of others) {
      const row = rows.get(clip.id);
      void source.remove(clip, () => {
        if (row) row.hidden = true;
        return () => { if (row) row.hidden = false; status.textContent = "撤销后已恢复，可以重新选择"; };
      });
    }
    // Settled once the undo window passed with every other copy still gone.
    window.setTimeout(() => { if (others.every(clip => rows.get(clip.id)?.hidden)) done(card); }, 7000);
  };
  for (const clip of group) {
    const copy = element("div", "duplicate-copy");
    rows.set(clip.id, copy);
    copy.append(buildCoverTile({
      media: { id: clip.id, duration: clip.duration, category: clip.category, coverUrl: clip.coverUrl, favorite: clip.favorite },
      variant: clip.category === "long" ? "wide" : "portrait",
      subtitle: describeCopy(clip),
      onPlay: () => { preview.hidden = false; preview.src = clip.streamUrl; void preview.play().catch(() => undefined); },
    }).root);
    const keep = element("button", "library-button duplicate-keep", "保留这个");
    keep.type = "button";
    keep.addEventListener("click", () => keepOne(clip));
    copy.append(keep);
    tiles.append(copy);
  }
  const notDuplicate = element("button", "library-button duplicate-dismiss", "不是重复");
  notDuplicate.type = "button";
  notDuplicate.addEventListener("click", () => {
    notDuplicate.disabled = true;
    void source.dismiss(group.map(clip => clip.id)).then(
      () => done(card),
      () => { notDuplicate.disabled = false; status.textContent = "没有保存成功，请重试"; },
    );
  });
  card.append(tiles, preview, notDuplicate, status);
  return card;
}

/** Fills the open sheet with the review; `back` returns to the settings. */
export async function openDuplicateReview(host: SheetHost, back: () => void, source: DuplicateSource = duplicateApi): Promise<void> {
  const backRow = sheetRow({ title: "返回设置", onPick: back });
  openSheet(host, "疑似重复", [backRow, sheetNote("正在比对封面和时长…")]);
  let page: DuplicateGroups;
  try {
    page = await source.load();
  } catch {
    openSheet(host, "疑似重复", [backRow, sheetNote("读取失败，请稍后重试")]);
    return;
  }
  const empty = sheetNote("没有疑似重复的视频");
  const body: Node[] = [backRow, sheetNote("封面几乎相同、时长相差不到 3% 的视频；大的排在前面。点封面可预览。")];
  if (page.total > page.groups.length) body.push(sheetNote(`共 ${page.total} 组，这里先列出 ${page.groups.length} 组`));
  const list = element("div", "duplicate-list");
  const settle = (card: HTMLElement): void => {
    card.remove();
    if (!list.querySelector(".duplicate-group")) list.append(empty);
  };
  for (const group of page.groups) list.append(buildDuplicateGroup(group, source, settle));
  if (!page.groups.length) list.append(empty);
  body.push(list);
  openSheet(host, "疑似重复", body);
}
