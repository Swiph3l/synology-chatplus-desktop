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
    tasks = [],
    timers = [];
  let marker = true,
    present = true;
  const header = {
    isConnected: true,
    querySelectorAll: () =>
      present ? [{ querySelector: () => (marker ? {} : null) }] : [],
  };
  const titleNode = {};
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
    document: {
      title: "ChatPlus Desktop",
      querySelector: (selector) => {
        if (selector === "head > title") return titleNode;
        return { parentElement: header };
      },
    },
    queueMicrotask: (callback) => tasks.push(callback),
    setTimeout: (callback) => {
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timers.length;
    },
    clearTimeout: (id) => {
      const timer = timers[id - 1];
      if (timer) timer.cleared = true;
    },
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
  const runTimers = () => {
    for (const timer of timers.splice(0)) {
      if (!timer.cleared) timer.callback();
    }
  };
  flush();
  assert.deepEqual(messages, [
    {
      chatplusUnread: 1,
      source: "chatplus-dom",
      hasUnread: true,
      count: null,
      reason: "badge-present",
    },
  ]);
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
  marker = true;
  observers[0].callback();
  flush();
  runTimers();
  assert.equal(
    messages.length,
    1,
    "temporary badge removal must not clear unread immediately",
  );
  marker = false;
  observers[0].callback();
  flush();
  runTimers();
  assert.deepEqual(messages[1], {
    chatplusUnread: 1,
    source: "chatplus-dom",
    hasUnread: false,
    count: 0,
    reason: "confirmed-badge-removed",
  });
});

test("title fallback reports unread only when sidebar state is unavailable", () => {
  const messages = [],
    tasks = [];
  const window = {
    chrome: {
      webview: {
        postMessage: (value) => messages.push(JSON.parse(value)),
      },
    },
  };
  window.top = window;
  const titleNode = {};
  const document = {
    title: "(5) ChatPlus",
    querySelector: (selector) => {
      if (selector === "head > title") return titleNode;
      return null;
    },
  };
  runInNewContext(result.outputFiles[0].text, {
    window,
    document,
    queueMicrotask: (callback) => tasks.push(callback),
    setTimeout: () => 1,
    clearTimeout: () => {},
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {
        this.callback();
      }
      disconnect() {}
    },
  });
  while (tasks.length) tasks.shift()();
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], {
    chatplusUnread: 1,
    source: "title-fallback",
    hasUnread: true,
    count: 5,
    reason: "title-fallback",
  });
});
