import { element } from "../components/dom";
import { sheetChoice, sheetNote } from "../components/sheet";
import type { ReadMode, ReadModeState } from "../types";

/** Smart-cache choices: presentation only, the caller applies and persists the pick. */
export type CacheMode = "auto" | "speed" | "data-saving" | "off";
const CACHE_CHOICES: readonly (readonly [CacheMode, string, string])[] = [
  ["auto", "智能（推荐）", "根据缓冲、卡顿和实测速率自动调整"],
  ["speed", "速度优先", "更多预取，切换视频更快"],
  ["data-saving", "省流量", "只加载正在播放的视频"],
  ["off", "关闭", "禁用后台视频预取"],
];

export function cacheModeChoices(current: CacheMode, pick: (mode: CacheMode) => void): HTMLButtonElement[] {
  return CACHE_CHOICES.map(([value, title, sub]) => sheetChoice(title, sub, current === value, () => pick(value)));
}

const READ_MODE_TEXT: Record<ReadMode, { title: string; sub: string; label: string }> = {
  webdav: { title: "网盘（稳定）", sub: "默认方式，经网盘挂载读取，兼容性最好", label: "网盘 · 稳定" },
  direct: { title: "115 直连（更快）", sub: "直接从 115 读取并复用连接，拖动和续播更快；出错时自动退回网盘", label: "115 直连 · 更快" },
};

let lastKnown: ReadModeState = { mode: "webdav", direct_available: false };

/** The label the settings list shows before the sheet has asked the server. */
export function readModeLabel(): string {
  return READ_MODE_TEXT[lastKnown.mode].label;
}

/**
 * The two read-mode choices. While a switch is in flight the chosen row shows a
 * spinner and both rows are disabled; a mode the server cannot offer stays visible
 * but disabled, with the reason.
 */
export function readModeChoices(
  state: ReadModeState, busy: ReadMode | null, pick: (mode: ReadMode) => void, status = "",
): HTMLElement[] {
  const rows: HTMLElement[] = (["webdav", "direct"] as const).map((mode) => {
    const text = READ_MODE_TEXT[mode];
    const unavailable = mode === "direct" && !state.direct_available;
    const sub = busy === mode ? "正在切换…" : unavailable ? "服务器未配置 115 直连" : text.sub;
    const row = sheetChoice(text.title, sub, state.mode === mode, () => pick(mode));
    row.dataset.readMode = mode;
    row.disabled = busy !== null || unavailable;
    if (busy === mode) {
      row.setAttribute("aria-busy", "true");
      row.querySelector(".sheet-choice-mark")?.replaceChildren(element("span", "sheet-spinner"));
    }
    return row;
  });
  rows.push(sheetNote("读取方式作用于服务器上的所有播放；切换后从下一段数据开始生效，正在播放的视频不会中断。"));
  // The result is said inside the sheet: a toast would sit underneath it.
  if (status) {
    const line = sheetNote(status);
    line.classList.add("sheet-status");
    line.setAttribute("role", "status");
    rows.unshift(line);
  }
  return rows;
}

export type ReadModeHost = {
  load(): Promise<ReadModeState>;
  save(mode: ReadMode): Promise<ReadModeState>;
  render(nodes: Node[]): void;
  notify(message: string): void;
};

/** Delay before a spinner appears: a switch that answers at once never flashes one. */
export const READ_MODE_SPINNER_DELAY_MS = 150;

/** Owns one read-mode sheet: loading, switching, and its single in-flight request. */
export function createReadModeSheet(host: ReadModeHost, delayMs = READ_MODE_SPINNER_DELAY_MS) {
  let state = lastKnown;
  let busy: ReadMode | null = null;
  let generation = 0;
  let status = "";
  const draw = (): void => host.render(readModeChoices(state, busy, (mode) => void pick(mode), status));
  const say = (message: string): void => {
    status = message;
    host.notify(message);
  };

  async function pick(mode: ReadMode): Promise<void> {
    if (busy !== null || mode === state.mode) return;
    const ticket = ++generation;
    status = "";
    const spinner = window.setTimeout(() => {
      if (ticket !== generation) return;
      busy = mode;
      draw();
    }, delayMs);
    try {
      state = lastKnown = await host.save(mode);
      say(`已切换为${READ_MODE_TEXT[state.mode].title}`);
    } catch {
      say("切换失败，已保持原来的读取方式");
    } finally {
      window.clearTimeout(spinner);
      if (ticket === generation) {
        busy = null;
        draw();
      }
    }
  }

  return {
    async open(): Promise<void> {
      const ticket = ++generation;
      draw();
      try {
        const fresh = await host.load();
        if (ticket !== generation) return;
        state = lastKnown = fresh;
        draw();
      } catch {
        if (ticket === generation) {
          say("暂时无法读取当前读取方式");
          draw();
        }
      }
    },
    pick,
    /** Leaving the sheet makes any late answer stale. */
    dispose(): void {
      generation += 1;
    },
  };
}
