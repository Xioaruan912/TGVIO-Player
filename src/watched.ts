import { api, MOCK_MODE } from "./api";
import { sheetRow } from "./ui";

/** A video counts as watched once this share of it has played (or it ended). */
export const WATCHED_SHARE = 0.8;

type WatchSettings = { forget_after_days: number | null; choices: (number | null)[] };

export type WatchedSource = {
  mark(mediaId: string): Promise<unknown>;
  settings(): Promise<WatchSettings>;
  setForgetAfterDays(days: number | null): Promise<WatchSettings>;
};

const JSON_PUT = { method: "PUT", headers: { "Content-Type": "application/json" } };
const MOCK_SETTINGS: WatchSettings = { forget_after_days: 15, choices: [null, 7, 15, 30, 60, 90, 180] };

export const watchedApi: WatchedSource = {
  mark: id => MOCK_MODE ? Promise.resolve() : api.request(`/api/v1/media/${encodeURIComponent(id)}/watched`, { method: "PUT" }),
  settings: () => MOCK_MODE ? Promise.resolve(MOCK_SETTINGS) : api.request<WatchSettings>("/api/v1/settings/watched"),
  setForgetAfterDays: days => MOCK_MODE ? Promise.resolve({ ...MOCK_SETTINGS, forget_after_days: days })
    : api.request<WatchSettings>("/api/v1/settings/watched", { ...JSON_PUT, body: JSON.stringify({ forget_after_days: days }) }),
};

/**
 * Marks every player video (any <video> carrying data-media-id: the feed pool and
 * the long player) once it is mostly played. Media events do not bubble, so one
 * capturing listener on the document sees them all without touching the players.
 * Each video is sent once per page load; a failed send is tried again next time.
 */
export function installWatchedTracker(source: WatchedSource = watchedApi, root: Document = document): () => void {
  const sent = new Set<string>();
  const check = (event: Event): void => {
    const video = event.target as HTMLVideoElement | null;
    const id = video?.dataset?.mediaId;
    if (!video || !id || sent.has(id)) return;
    const duration = video.duration;
    const done = event.type === "ended"
      || (Number.isFinite(duration) && duration > 0 && video.currentTime >= duration * WATCHED_SHARE);
    if (!done) return;
    sent.add(id);
    void source.mark(id).catch(() => sent.delete(id));
  };
  root.addEventListener("timeupdate", check, true);
  root.addEventListener("ended", check, true);
  return () => {
    root.removeEventListener("timeupdate", check, true);
    root.removeEventListener("ended", check, true);
  };
}

export function forgetLabel(days: number | null): string {
  if (days === null) return "永不：看过的一直排在后面";
  const named: Record<number, string> = { 7: "1 周", 15: "半个月", 30: "1 个月", 60: "2 个月", 90: "3 个月", 180: "半年" };
  return `${named[days] ?? `${days} 天`}后重新算作没看过`;
}

let known: WatchSettings | null = null;

/**
 * The settings row for the forget window. Each tap moves to the next offered
 * choice; the row shows the server's value as soon as it answers.
 */
export function watchedForgetRow(source: WatchedSource = watchedApi): HTMLElement {
  let busy = false;
  const row = sheetRow({
    title: "看过的视频",
    sub: known ? forgetLabel(known.forget_after_days) : "正在读取…",
    onPick: () => {
      if (!known || busy) return;
      const { choices, forget_after_days: current } = known;
      const next = choices[(choices.indexOf(current) + 1) % choices.length] ?? null;
      busy = true;
      void source.setForgetAfterDays(next).then(show, () => setSub("保存失败，请重试")).finally(() => { busy = false; });
    },
  });
  const setSub = (text: string): void => {
    const sub = row.querySelector(".sheet-row-sub");
    if (sub) sub.textContent = text;
  };
  const show = (settings: WatchSettings): void => { known = settings; setSub(forgetLabel(settings.forget_after_days)); };
  void source.settings().then(show, () => { if (!known) setSub("暂时无法读取"); });
  return row;
}
