import { api, MOCK_MODE } from "./api";
import { element } from "./components/dom";
import { openSheet, sheetChoice, sheetNote, type SheetHost } from "./components/sheet";

/** The viewer's own labels. A video carries any number; the wall filters by one. */
export type TagItem = { id: number; name: string; count: number };

export type TagSource = {
  list(): Promise<TagItem[]>;
  create(name: string): Promise<TagItem>;
  mediaTags(mediaId: string): Promise<number[]>;
  set(mediaId: string, tagId: number, on: boolean): Promise<number[]>;
};

const JSON_HEADERS = { "Content-Type": "application/json" };
const media = (id: string): string => `/api/v1/media/${encodeURIComponent(id)}/tags`;

export const tagApi: TagSource = {
  list: async () => MOCK_MODE ? [] : (await api.request<{ items: TagItem[] }>("/api/v1/tags")).items,
  create: name => api.request<TagItem>("/api/v1/tags", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name }) }),
  mediaTags: async id => MOCK_MODE ? [] : (await api.request<{ ids: number[] }>(media(id))).ids,
  set: async (id, tagId, on) =>
    (await api.request<{ ids: number[] }>(`${media(id)}/${tagId}`, { method: on ? "PUT" : "DELETE" })).ids,
};

export const MAX_TAG_NAME = 20;

/**
 * One video's tags: every tag as a row that toggles, and a field that makes a new
 * tag and puts it on the video at once. Each toggle is saved immediately; the sheet
 * shows what the server answered, so a failed save never looks applied.
 */
export async function openTagSheet(host: SheetHost, mediaId: string, notify: (message: string) => void,
  source: TagSource = tagApi): Promise<void> {
  openSheet(host, "标签", [sheetNote("正在读取标签…")]);
  let tags: TagItem[];
  let selected: Set<number>;
  try {
    [tags, selected] = await Promise.all([source.list(), source.mediaTags(mediaId).then(ids => new Set(ids))]);
  } catch {
    openSheet(host, "标签", [sheetNote("标签读取失败，请稍后重试")]);
    return;
  }
  let busy = false;
  const save = async (work: () => Promise<number[]>, failure: string): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const before = selected;
      selected = new Set(await work());
      tags = tags.map(tag => ({ ...tag, count: Math.max(0,
        tag.count + Number(selected.has(tag.id)) - Number(before.has(tag.id))) }));
    } catch {
      notify(failure);
    } finally {
      busy = false;
    }
    render();
  };
  const input = element("input", "tag-input");
  input.type = "text";
  input.maxLength = MAX_TAG_NAME;
  input.placeholder = "新标签名称";
  input.setAttribute("aria-label", "新标签名称");
  const add = element("button", "library-button tag-add", "添加");
  add.type = "button";
  const create = (): void => {
    const name = input.value.trim();
    if (!name) return;
    void save(async () => {
      const tag = await source.create(name);
      if (!tags.some(item => item.id === tag.id)) tags = [...tags, { ...tag, count: 0 }];
      input.value = "";
      return source.set(mediaId, tag.id, true);
    }, "标签没有保存成功");
  };
  add.addEventListener("click", create);
  input.addEventListener("keydown", event => { if ((event as KeyboardEvent).key === "Enter") create(); });
  const form = element("div", "tag-form");
  form.append(input, add);

  function render(): void {
    const body: Node[] = [form];
    if (!tags.length) body.push(sheetNote("还没有标签。输入名称添加第一个，例如「黑丝」「短发」。"));
    for (const tag of tags) {
      const on = selected.has(tag.id);
      body.push(sheetChoice(tag.name, `${tag.count} 个视频`, on,
        () => void save(() => source.set(mediaId, tag.id, !on), "标签没有保存成功")));
    }
    openSheet(host, "标签", body);
  }
  render();
}
