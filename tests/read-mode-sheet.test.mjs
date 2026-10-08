import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { installDom } from "./dom-stub.mjs";
import { icon } from "../.test-dist/icons.js";
import { element } from "../.test-dist/components/dom.js";

const { flush, Node } = installDom();
globalThis.HTMLButtonElement = Node;
// Compiled modules use extensionless imports; inject their dependencies instead.
async function load(path, deps) {
  const code = (await readFile(new URL("../.test-dist/" + path, import.meta.url), "utf8")).replace(/^import .* from .*;$/gm, "");
  globalThis.__readModeDeps = deps;
  return import("data:text/javascript;base64," + Buffer.from(
    "const { " + Object.keys(deps).join(",") + " } = globalThis.__readModeDeps;\n" + code).toString("base64"));
}
const sheet = await load("components/sheet.js", {
  element, icon, activateDialog: () => () => {}, animateArrival: () => {}, flingOut: async () => {}, settleFromVelocity: async () => {},
});
const { readModeChoices, createReadModeSheet, readModeLabel, cacheModeChoices } = await load("views/network-sheets.js", {
  element, sheetChoice: sheet.sheetChoice, sheetNote: sheet.sheetNote,
});

const rows = (nodes) => nodes.filter((node) => node.dataset?.readMode);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("both modes are offered and the unconfigured one stays visible but disabled", () => {
  const nodes = readModeChoices({ mode: "webdav", direct_available: false }, null, () => {});
  const [webdav, direct] = rows(nodes);
  assert.equal(webdav.getAttribute("aria-pressed"), "true");
  assert.equal(direct.disabled, true);
  assert.match(direct.textContent, /未配置/);
});

test("a switch in flight disables both rows and marks only the chosen one busy", () => {
  const [webdav, direct] = rows(readModeChoices({ mode: "webdav", direct_available: true }, "direct", () => {}));
  assert.equal(webdav.disabled && direct.disabled, true);
  assert.equal(direct.getAttribute("aria-busy"), "true");
  assert.equal(webdav.getAttribute("aria-busy"), null);
  assert.ok(direct.querySelector(".sheet-spinner"), "the chosen row shows the spinner");
  assert.match(direct.textContent, /正在切换/);
});

test("a fast switch never flashes a spinner, a slow one shows it until the answer", async () => {
  const renders = [];
  const notes = [];
  let pending = null;
  const sheet = createReadModeSheet({
    load: async () => ({ mode: "webdav", direct_available: true }),
    save: () => pending.promise,
    render: (nodes) => renders.push(nodes),
    notify: (message) => notes.push(message),
  }, 20);
  await sheet.open();

  pending = deferred();
  const fast = sheet.pick("direct");
  pending.resolve({ mode: "direct", direct_available: true });
  await fast;
  assert.ok(renders.every((nodes) => !rows(nodes).some((row) => row.getAttribute("aria-busy"))), "no spinner for an instant answer");
  assert.match(notes.at(-1), /115 直连/);
  assert.equal(readModeLabel(), "115 直连 · 更快", "the settings list shows the new mode");

  pending = deferred();
  const slow = sheet.pick("webdav");
  await delay(40);
  assert.ok(rows(renders.at(-1)).some((row) => row.getAttribute("aria-busy") === "true"), "a slow switch shows the spinner");
  pending.resolve({ mode: "webdav", direct_available: true });
  await slow;
  await flush();
  assert.ok(!rows(renders.at(-1)).some((row) => row.getAttribute("aria-busy")), "the spinner leaves with the answer");
});

test("a failed switch keeps the previous mode and says so", async () => {
  const renders = [];
  const notes = [];
  const sheet = createReadModeSheet({
    load: async () => ({ mode: "webdav", direct_available: true }),
    save: async () => { throw new Error("offline"); },
    render: (nodes) => renders.push(nodes),
    notify: (message) => notes.push(message),
  }, 5);
  await sheet.open();
  await sheet.pick("direct");
  assert.match(notes.at(-1), /切换失败/);
  const status = renders.at(-1).find((node) => node.getAttribute?.("role") === "status");
  assert.match(status?.textContent ?? "", /切换失败/, "the result is said inside the sheet, above any toast");
  assert.equal(rows(renders.at(-1))[0].getAttribute("aria-pressed"), "true", "still on WebDAV");
});

test("a late answer after the sheet is left does not redraw it", async () => {
  const renders = [];
  const pending = deferred();
  const sheet = createReadModeSheet({
    load: () => pending.promise, save: async (mode) => ({ mode, direct_available: true }),
    render: (nodes) => renders.push(nodes), notify: () => {},
  });
  const opening = sheet.open();
  const before = renders.length;
  sheet.dispose();
  pending.resolve({ mode: "direct", direct_available: true });
  await opening;
  assert.equal(renders.length, before);
});

test("cache choices mark the current mode and report the pick", () => {
  const picked = [];
  const choices = cacheModeChoices("speed", (mode) => picked.push(mode));
  assert.equal(choices.length, 4);
  assert.equal(choices[1].getAttribute("aria-pressed"), "true");
  choices[3].dispatch("click");
  assert.deepEqual(picked, ["off"]);
});
