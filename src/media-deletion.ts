import { api, ApiError } from "./api";
import { showUndoToast } from "./components/undo-toast";

/**
 * Permanent delete with undo: the one place every surface (feed, long player,
 * library and favorites playback) deletes through.
 *
 * The video leaves the screen the moment the viewer confirms; nothing waits for the
 * archive. The server records the delete in one local write and removes the files in
 * the background, retrying until they are gone, so the request here is short. It is
 * retried a few times on a network failure. Only when the server never recorded the
 * delete does the video come back, and the viewer is told so: a delete is never
 * silently lost and never silently reported as done.
 *
 * Undo is the server's: it holds the files back for a short window and answers
 * whether the undo still applied. The video returns only when it did.
 */
export interface DeletionTarget {
  mediaId: string;
  /** Take the video out of every view now; returns how to put it back. */
  remove(): () => void;
}

export interface DeletionDeps {
  deleteMedia(mediaId: string): Promise<{ undoSeconds: number }>;
  cancelMediaDeletion(mediaId: string): Promise<boolean>;
  notify(options: { message: string; seconds: number; actionLabel?: string; onAction?: () => void }): () => void;
  wait(ms: number): Promise<void>;
}

/** What happened to the request; an undo is reported to the viewer, not here. */
export type DeletionResult = "queued" | "not-recorded";

/** The server keeps a little more than this; the rest covers the undo's round trip. */
export const UNDO_SECONDS = 5;
const SUBMIT_RETRY_MS = [800, 2000, 4000];

const defaultDeps: DeletionDeps = {
  deleteMedia: id => api.deleteMedia(id),
  cancelMediaDeletion: id => api.cancelMediaDeletion(id),
  notify: showUndoToast,
  wait: ms => new Promise(resolve => window.setTimeout(resolve, ms)),
};

type Submitted = "queued" | "gone" | "failed";

async function submit(mediaId: string, deps: DeletionDeps): Promise<Submitted> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await deps.deleteMedia(mediaId);
      return "queued";
    } catch (error) {
      // Already gone on the server: what the viewer asked for is true.
      if (error instanceof ApiError && error.status === 404) return "gone";
      // A closed session cannot record anything; retrying would not help.
      if (error instanceof ApiError && error.code === "unauthorized") return "failed";
      if (attempt >= SUBMIT_RETRY_MS.length) return "failed";
      await deps.wait(SUBMIT_RETRY_MS[attempt]);
    }
  }
}

export function deleteWithUndo(target: DeletionTarget, deps: DeletionDeps = defaultDeps): Promise<DeletionResult> {
  const restore = target.remove();
  const submitted = submit(target.mediaId, deps);
  let undoing = false;
  const requestUndo = async (): Promise<void> => {
    if (undoing) return;
    undoing = true;
    // Undo what the server recorded; a delete it never recorded restores itself below.
    if (await submitted !== "queued") return;
    let restored = false;
    try {
      restored = await deps.cancelMediaDeletion(target.mediaId);
    } catch {
      deps.notify({ message: "撤销没有成功，视频会被删除", seconds: 3 });
      return;
    }
    if (!restored) {
      deps.notify({ message: "已开始删除，无法撤销", seconds: 3 });
      return;
    }
    restore();
    deps.notify({ message: "已撤销删除", seconds: 2 });
  };
  const closeNotice = deps.notify({
    message: "已删除", seconds: UNDO_SECONDS, actionLabel: "撤销", onAction: () => void requestUndo(),
  });
  return submitted.then(result => {
    if (result === "failed") {
      closeNotice();
      restore();
      deps.notify({ message: "删除没有提交成功，视频已恢复，请重试", seconds: 4 });
      return "not-recorded";
    }
    return "queued";
  });
}
