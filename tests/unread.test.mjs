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

function fixture({ marker = true, present = true } = {}) {
  const messages = [],
    observers = [],
    tasks = [],
    listeners = new Map();
  let focused = true;
  const header = {
    isConnected: true,
    querySelectorAll: () =>
      present ? [{ querySelector: () => (marker ? {} : null) }] : [],
  };
  const window = {
    chrome: {
      webview: { postMessage: (value) => messages.push(JSON.parse(value)) },
    },
  };
  window.top = window;
  const document = {
    title: "(5) ChatPlus",
    visibilityState: "visible",
    hasFocus: () => focused,
    querySelector: () => (present ? { parentElement: header } : null),
    addEventListener: (type, callback) => listeners.set(type, callback),
  };
  class KeyboardEvent {
    constructor(key, isTrusted) {
      this.key = key;
      this.isTrusted = isTrusted;
    }
  }
  runInNewContext(result.outputFiles[0].text, {
    window,
    document,
    KeyboardEvent,
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
  return {
    messages,
    document,
    flush,
    badges(value) {
      marker = value;
      observers[0].callback();
    },
    tabs(value) {
      present = value;
      observers[0].callback();
    },
    focus(value) {
      focused = value;
    },
    foreground(value, generation = 1) {
      window.__chatplusSetForeground(value, generation);
    },
    gesture({ type = "click", trusted = true, key = "Enter" } = {}) {
      listeners.get(type)(
        type === "keydown"
          ? new KeyboardEvent(key, trusted)
          : { isTrusted: trusted },
      );
    },
  };
}

test("initial sidebar unread is observed and unchanged/missing provider state cannot invent a clear", () => {
  const f = fixture();
  assert.deepEqual(f.messages, [
    {
      chatplusUnread: 1,
      source: "chatplus-dom",
      hasUnread: true,
      count: null,
      reason: "badge-present",
      acknowledgement: null,
    },
  ]);
  f.badges(true);
  f.badges(true);
  f.flush();
  assert.equal(f.messages.length, 1, "unchanged observations are coalesced");
  f.tabs(false);
  f.flush();
  assert.equal(
    f.messages.length,
    1,
    "missing sidebar is unknown, even with a flashing unread title",
  );
});

test("selected provider removing badges while minimized/backgrounded has no read acknowledgement", () => {
  const f = fixture();
  f.foreground(false, 2);
  f.badges(false);
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).hasUnread, false);
  assert.equal(
    f.messages.at(-1).acknowledgement,
    null,
    "WebView focus and selection cannot acknowledge a read",
  );
  assert.equal(f.messages.at(-1).reason, "provider-empty");
});

test("foreground/service activation alone cannot acknowledge cached unread; trusted provider input and empty badges can", () => {
  const f = fixture();
  f.badges(false);
  f.foreground(true, 7);
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
  f.gesture({ trusted: false });
  f.flush();
  assert.equal(
    f.messages.at(-1).acknowledgement,
    null,
    "synthetic provider input is not user activity",
  );
  f.gesture({ type: "keydown", key: "Tab" });
  f.flush();
  assert.equal(
    f.messages.at(-1).acknowledgement,
    null,
    "tabbing through controls does not read messages",
  );
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, 7);
  assert.equal(f.messages.at(-1).reason, "user-read-acknowledgement");
});

test("real foreground interaction allows provider read evidence without an arbitrary clear timer", () => {
  const f = fixture();
  f.foreground(true, 3);
  f.gesture({ type: "keydown" });
  f.flush();
  assert.equal(
    f.messages.at(-1).hasUnread,
    true,
    "a gesture alone never clears provider unread",
  );
  f.badges(false);
  f.flush();
  assert.equal(f.messages.at(-1).hasUnread, false);
  assert.equal(f.messages.at(-1).acknowledgement, 3);
  f.badges(true);
  f.flush();
  f.badges(false);
  f.flush();
  assert.equal(
    f.messages.at(-1).acknowledgement,
    null,
    "a consumed gesture cannot acknowledge a later unread transition",
  );
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, 3);
});

test("a trusted click before a later message cannot clear that message without new read input", () => {
  const f = fixture({ marker: false });
  f.foreground(true, 1);
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, 1);
  f.badges(true);
  f.flush();
  f.badges(false);
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
  f.foreground(true, 2);
  f.flush();
  assert.equal(
    f.messages.at(-1).acknowledgement,
    null,
    "a new native incoming generation invalidates earlier provider input",
  );
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, 2);
});

test("native visibility changes invalidate pending input acknowledgements before their microtask runs", () => {
  const f = fixture();
  f.foreground(true, 1);
  f.gesture();
  f.badges(false);
  f.foreground(false, 2);
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
  f.foreground(true, 3);
  f.flush();
  assert.equal(
    f.messages.at(-1).acknowledgement,
    null,
    "restore/notification activation is not a provider gesture",
  );
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, 3);
});

test("a new native message invalidates a queued gesture without requiring a focus transition", () => {
  const f = fixture();
  f.foreground(true, 1);
  f.gesture();
  f.badges(false);
  f.foreground(true, 2);
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, 2);
});

test("an older native visibility snapshot cannot overwrite the current generation", () => {
  const f = fixture();
  f.foreground(true, 2);
  f.foreground(false, 1);
  f.badges(false);
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, 2);
});

test("provider document focus or visibility alone cannot authorize a read acknowledgement", () => {
  for (const visibility of ["hidden", "visible"]) {
    const f = fixture();
    f.foreground(true);
    f.document.visibilityState = visibility;
    if (visibility === "visible") f.focus(false);
    f.badges(false);
    f.gesture();
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, null);
  }
});

test("flashing document title cannot create unread when sidebar is unavailable", () => {
  const f = fixture({ present: false });
  f.flush();
  assert.equal(f.messages.length, 0);
});
