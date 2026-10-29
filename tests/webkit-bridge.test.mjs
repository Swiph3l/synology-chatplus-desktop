import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

const bundle = await build({
  entryPoints: ["src/theme/webkit-bridge.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "bridgeUi",
});
const shim = await build({
  entryPoints: ["src/theme/webkit-notifications.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "notificationUi",
});
function fixture() {
  const context = {};
  runInNewContext(bundle.outputFiles[0].text, context);
  const host = {
    crypto: { getRandomValues: (bytes) => bytes.fill(17) },
    location: { href: "https://nas.test/chat/" },
  };
  host.top = host;
  return { host, api: context.bridgeUi };
}

test("WebKit outbox preserves packet order, caps batches and releases capacity", () => {
  const { host, api } = fixture();
  const bridge = api.installWebkitBridge(host);
  for (let i = 0; i < api.QUEUE_LIMIT; ++i) bridge.postMessage(String(i));
  assert.throws(() => bridge.postMessage("overflow"), /full/);
  const batch = bridge.drain();
  assert.equal(batch.documentId, "11".repeat(16));
  assert.equal(batch.url, host.location.href);
  assert.equal(batch.messages.length, api.BATCH_LIMIT);
  assert.deepEqual(
    Array.from(batch.messages),
    Array.from({ length: api.BATCH_LIMIT }, (_, i) => String(i)),
  );
  bridge.postMessage("accepted-after-drain");
  assert.equal(api.installWebkitBridge(host), null);
  assert.throws(
    () => bridge.postMessage("x".repeat(api.MESSAGE_LIMIT + 1)),
    /Invalid/,
  );
  assert.throws(() => bridge.postMessage({}), /Invalid/);
});

test("only top frames with a document identity receive an outbox", () => {
  const { host, api } = fixture();
  host.top = {};
  assert.equal(api.installWebkitBridge(host), null);
  host.top = host;
  host.crypto.getRandomValues = () => {
    throw new Error("unavailable");
  };
  assert.equal(api.installWebkitBridge(host), null);
  assert.equal(host.__chatplusWebkitBridge, undefined);
});

test("WebKit notification shim submits bounded events without native command access", async () => {
  const { host, api } = fixture();
  const bridge = api.installWebkitBridge(host);
  const tasks = [];
  const context = {
    EventTarget,
    Event,
    queueMicrotask: (fn) => tasks.push(fn),
  };
  runInNewContext(shim.outputFiles[0].text, context);
  const Notification = context.notificationUi.installWebkitNotifications(host);
  const message = new Notification("Sender", {
    body: "Hello",
    tag: "t".repeat(513),
    silent: true,
  });
  const sent = JSON.parse(bridge.drain().messages[0]);
  assert.equal(sent.chatplusNotification, 1);
  assert.equal(sent.session, "11".repeat(16));
  assert.equal(sent.tag, "");
  assert.equal(sent.silent, true);
  let shown = 0;
  message.onshow = () => ++shown;
  tasks.splice(0).forEach((fn) => fn());
  assert.equal(shown, 1);
  message.close();
  tasks.splice(0).forEach((fn) => fn());
  assert.equal(bridge.drain().messages.length, 0);
  assert.equal(host.__TAURI_INTERNALS__, undefined);
});
