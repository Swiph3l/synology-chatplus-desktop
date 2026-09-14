import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

const result = await build({
  entryPoints: ["src/theme/unread.ts"],
  bundle: true,
  write: false,
  format: "iife",
});
test("sidebar unread observes initial state and read changes, not focus or missing UI", () => {
  const messages = [],
    observers = [],
    tasks = [];
  let marker = true,
    present = true;
  const header = {
    isConnected: true,
    querySelectorAll: () =>
      present ? [{ querySelector: () => (marker ? {} : null) }] : [],
  };
  const window = {
    chrome: {
      webview: {
        postMessage: (value) => messages.push(JSON.parse(value)),
      },
    },
  };
  window.top = window;
  runInNewContext(result.outputFiles[0].text, {
    window,
    document: { querySelector: () => ({ parentElement: header }) },
    queueMicrotask: (callback) => tasks.push(callback),
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
    },
  });
  const flush = () => {
    while (tasks.length) tasks.shift()();
  };
  flush();
  assert.deepEqual(messages, [{ chatplusUnread: 1, unread: true }]);
  observers[0].callback();
  observers[0].callback();
  flush();
  assert.equal(messages.length, 1, "coalesce unchanged state");
  present = false;
  observers[0].callback();
  flush();
  assert.equal(messages.length, 1, "missing tabs must not clear unread");
  present = true;
  marker = false;
  observers[0].callback();
  flush();
  assert.deepEqual(messages[1], { chatplusUnread: 1, unread: false });
});
