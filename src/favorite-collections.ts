import { api } from "./api";
import { CollectionsController } from "./collections";
import { favoriteMutations } from "./favorite-service";
import { buildNameSheet } from "./components/collection-sheets";
import { element } from "./components/dom";
import { closeSheet, openSheet, sheetChoice, sheetNote, type SheetHost } from "./components/sheet";
import type { CollectionDto } from "./types";

/**
 * After a video is favourited from a player, offer to also put it in a collection.
 *
 * The bottom sheet lists the hand-picked (manual) collections, makes a new one on the
 * spot, or is dismissed. Each collection keeps its members in its own storage folder,
 * so the choice is where the copy will live. Unfavouriting never asks anything.
 */
export function installFavoriteCollections(
  host: SheetHost,
  notify: (message: string) => void,
  source = new CollectionsController(api),
): () => void {
  let generation = 0;
  const unsubscribe = favoriteMutations.subscribe(
    () => undefined,
    (mediaId, result) => {
      if (result?.favorite) void offer(mediaId);
    },
  );

  async function offer(mediaId: string): Promise<void> {
    const ticket = ++generation;
    await source.load();
    if (ticket !== generation || source.error) return;
    showPicker(mediaId, source.writable());
  }

  function showPicker(mediaId: string, collections: CollectionDto[]): void {
    const body: Node[] = [sheetNote(collections.length ? "已收藏，也加入一个集合吗？" : "已收藏，可以新建一个集合来存放它。")];
    for (const collection of collections) {
      body.push(sheetChoice(collection.name, `${collection.count} 个视频`, false, () => void add(mediaId, collection)));
    }
    const actions = element("div", "filter-actions");
    const skip = element("button", "library-button", "不加入");
    skip.type = "button";
    skip.addEventListener("click", () => closeSheet(host));
    const create = element("button", "library-button filter-apply", "新建集合");
    create.type = "button";
    create.addEventListener("click", () => showCreate(mediaId));
    actions.append(skip, create);
    body.push(actions);
    openSheet(host, "加入集合", body);
  }

  function showCreate(mediaId: string): void {
    openSheet(host, "新建集合", [buildNameSheet({
      value: "",
      submitLabel: "新建并加入",
      onSubmit: (name, error) => void (async () => {
        const created = await source.create(name);
        if (!created) { error.textContent = "新建失败，请换个名字或稍后重试"; return; }
        await add(mediaId, created);
      })(),
      onCancel: () => void offer(mediaId),
    })]);
  }

  async function add(mediaId: string, collection: CollectionDto): Promise<void> {
    const added = await source.addItem(collection.collection_id, mediaId);
    closeSheet(host);
    notify(added ? `已加入「${collection.name}」` : "加入集合失败，请稍后重试");
  }

  return () => { generation++; unsubscribe(); };
}
