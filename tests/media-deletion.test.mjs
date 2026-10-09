import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { installDom } from "./dom-stub.mjs";
import { element } from "../.test-dist/components/dom.js";

const { Node } = installDom();
globalThis.HTMLButtonElement = Node;

// Compiled modules use extensionless imports; inject their dependencies instead.
async function load(path, deps) {
  const code = (await readFile(new URL("../.test-dist/" + path, import.meta.url), "utf8")).replace(/^import .* from .*;$/gm, "");
  globalThis.__deletionDeps = deps;
  return import("data:text/javascript;base64," + Buffer.from(
    "const { " + Object.keys(deps).join(",") + " } = globalThis.__deletionDeps;\n" + code).toString("base64"));
}

class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
const { showUndoToast } = await load("components/undo-toast.js", { element });
const { deleteWithUndo, UNDO_SECONDS } = await load("media-deletion.js", { api: {}, ApiError, showUndoToast });

// The undo button fires and forgets; let its promise chain settle.
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

function harness({ deleteMedia, cancelMediaDeletion } = {}) {
  const log = [];
  const notices = [];
  const deps = {
    deleteMedia: deleteMedia ?? (async () => ({ undoSeconds: 6 })),
    cancelMediaDeletion: cancelMediaDeletion ?? (async () => true),
    notify: (options) => {
      const notice = { ...options, closed: false };
      notices.push(notice);
      return () => { notice.closed = true; };
    },
    wait: async (ms) => { log.push(`wait ${ms}`); },
  };
  const target = {
    mediaId: "a".repeat(64),
    remove: () => { log.push("removed"); return () => log.push("restored"); },
  };
  return { log, notices, deps, target };
}

test("the video leaves the screen before the server answers and undo is offered at once", async () => {
  const answer = deferred();
  const { log, notices, deps, target } = harness({ deleteMedia: () => answer.promise });
  const result = deleteWithUndo(target, deps);
  assert.deepEqual(log, ["removed"]);
  assert.equal(notices[0].message, "已删除");
  assert.equal(notices[0].actionLabel, "撤销");
  assert.equal(notices[0].seconds, UNDO_SECONDS);
  answer.resolve({ undoSeconds: 6 });
  assert.equal(await result, "queued");
  assert.deepEqual(log, ["removed"], "a recorded delete never comes back by itself");
});

test("a network failure is retried before anything is restored", async () => {
  let calls = 0;
  const { log, deps, target } = harness({
    deleteMedia: async () => { calls += 1; if (calls < 3) throw new TypeError("offline"); return { undoSeconds: 6 }; },
  });
  assert.equal(await deleteWithUndo(target, deps), "queued");
  assert.equal(calls, 3);
  assert.deepEqual(log, ["removed", "wait 800", "wait 2000"]);
});

test("a delete the server never recorded comes back and says so", async () => {
  const { log, notices, deps, target } = harness({ deleteMedia: async () => { throw new TypeError("offline"); } });
  assert.equal(await deleteWithUndo(target, deps), "not-recorded");
  assert.equal(log.at(-1), "restored");
  assert.equal(notices[0].closed, true, "the undo offer closes");
  assert.match(notices.at(-1).message, /没有提交成功.*已恢复/);
});

test("a closed session is not retried", async () => {
  let calls = 0;
  const { log, deps, target } = harness({
    deleteMedia: async () => { calls += 1; throw new ApiError("unauthorized", 401); },
  });
  assert.equal(await deleteWithUndo(target, deps), "not-recorded");
  assert.equal(calls, 1);
  assert.equal(log.at(-1), "restored");
});

test("media the server no longer has counts as deleted", async () => {
  const { log, deps, target } = harness({ deleteMedia: async () => { throw new ApiError("unavailable", 404); } });
  assert.equal(await deleteWithUndo(target, deps), "queued");
  assert.deepEqual(log, ["removed"]);
});

test("undo restores only when the server took it back", async () => {
  const { log, notices, deps, target } = harness();
  await deleteWithUndo(target, deps);
  notices[0].onAction();
  await settle();
  assert.equal(log.at(-1), "restored");
  assert.equal(notices.at(-1).message, "已撤销删除");
});

test("undo pressed before the server answered waits for the answer", async () => {
  const answer = deferred();
  let cancelled = 0;
  const { log, notices, deps, target } = harness({
    deleteMedia: () => answer.promise,
    cancelMediaDeletion: async () => { cancelled += 1; return true; },
  });
  const result = deleteWithUndo(target, deps);
  notices[0].onAction();
  await settle();
  assert.equal(cancelled, 0, "nothing to cancel before the server recorded it");
  answer.resolve({ undoSeconds: 6 });
  await result; await settle();
  assert.equal(cancelled, 1);
  assert.equal(log.at(-1), "restored");
});

test("a late undo leaves the video deleted and says why", async () => {
  const { log, notices, deps, target } = harness({ cancelMediaDeletion: async () => false });
  await deleteWithUndo(target, deps);
  notices[0].onAction();
  await settle();
  assert.deepEqual(log, ["removed"]);
  assert.match(notices.at(-1).message, /无法撤销/);
});

test("a failed undo request leaves the video deleted and says so", async () => {
  const { log, notices, deps, target } = harness({ cancelMediaDeletion: async () => { throw new TypeError("offline"); } });
  await deleteWithUndo(target, deps);
  notices[0].onAction();
  await settle();
  assert.deepEqual(log, ["removed"]);
  assert.match(notices.at(-1).message, /撤销没有成功/);
});

test("pressing undo twice sends one cancel", async () => {
  let cancelled = 0;
  const { notices, deps, target } = harness({ cancelMediaDeletion: async () => { cancelled += 1; return true; } });
  await deleteWithUndo(target, deps);
  notices[0].onAction(); notices[0].onAction();
  await settle();
  assert.equal(cancelled, 1);
});

test("the undo notice leaves the document when it closes, so its button keeps no tab stop", async () => {
  let pressed = 0;
  const close = showUndoToast({ message: "已删除", seconds: 5, actionLabel: "撤销", onAction: () => { pressed += 1; } });
  const toast = document.body.children.find(node => node.className === "undo-toast");
  assert.ok(toast);
  assert.equal(toast.getAttribute("role"), "status");
  const action = toast.children.find(node => node.className === "undo-toast-action");
  assert.equal(action.type, "button");
  action.dispatchEvent?.({ type: "click" }) ?? action.events.get("click")[0]();
  assert.equal(pressed, 1);
  assert.equal(document.body.children.includes(toast), false);
  close();
});

test("a new notice replaces the previous one", () => {
  showUndoToast({ message: "已删除", seconds: 5, actionLabel: "撤销", onAction: () => {} });
  showUndoToast({ message: "已撤销删除", seconds: 2 });
  const toasts = document.body.children.filter(node => node.className === "undo-toast");
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].children.some(node => node.className === "undo-toast-action"), false);
});
