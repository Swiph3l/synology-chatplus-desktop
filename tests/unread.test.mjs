import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

const result = await build({
  entryPoints: ["src/theme/provider-unread.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "unreadUi",
});

function fixture({
  marker = true,
  present = true,
  source = "chatplus-dom",
  providerZero = false,
} = {}) {
  const messages = [],
    tasks = [],
    listeners = new Map();
  let focused = true;
  let changed;
  let conversation = "conversation-a";
  let latest = true;
  let contentRevision = 0;
  let aggregateUnknown = false;
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
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type) => listeners.delete(type),
  };
  class KeyboardEvent {
    constructor(key, isTrusted, inConversation) {
      this.key = key;
      this.isTrusted = isTrusted;
      this.inConversation = inConversation;
    }
  }
  const context = {
    window,
    document,
    KeyboardEvent,
    queueMicrotask: (callback) => tasks.push(callback),
  };
  runInNewContext(result.outputFiles[0].text, context);
  const stop = context.unreadUi.installUnreadAdapter(
    {
      source,
      snapshot: () => ({
        hasUnread: present && !aggregateUnknown ? marker : null,
        count: null,
      }),
      providerUnreadZero: () =>
        providerZero && present && !aggregateUnknown && marker === false,
      observe(callback) {
        changed = callback;
        return () => {};
      },
      readContext: () => (present && latest ? conversation : null),
      contentContext: () =>
        present ? `${conversation}:${contentRevision}` : null,
      interactionContext: (event) =>
        event.inConversation ? conversation : null,
      isViewingNotification: (notification) =>
        present &&
        latest &&
        notification.tag === conversation &&
        (notification.revision === undefined ||
          notification.revision === contentRevision),
    },
    document,
    window,
  );
  const flush = () => {
    while (tasks.length) tasks.shift()();
  };
  flush();
  return {
    messages,
    document,
    window,
    stop,
    flush,
    badges(value) {
      marker = value;
      changed();
    },
    tabs(value) {
      present = value;
      changed();
    },
    focus(value) {
      focused = value;
    },
    foreground(value, generation = 1, incoming = 0) {
      window.__chatplusSetForeground(value, generation, incoming);
    },
    conversation(value, atLatest = true) {
      conversation = value;
      latest = atLatest;
      changed();
    },
    renderMessage() {
      contentRevision += 1;
      changed();
    },
    aggregateUnavailable(value = true) {
      aggregateUnknown = value;
      changed();
    },
    gesture({
      type = "click",
      trusted = true,
      key = "Enter",
      inConversation = true,
    } = {}) {
      listeners.get(type)(
        type === "keydown"
          ? new KeyboardEvent(key, trusted, inConversation)
          : { isTrusted: trusted, inConversation },
      );
    },
  };
}

for (const source of ["chatplus-dom", "synology-chat-dom", "discord-dom"]) {
  test(`${source}: a fresh gesture in the old pane cannot acknowledge an unrendered native arrival`, () => {
    const f = fixture({ marker: false, source });
    f.foreground(true, 1, 1);
    f.gesture();
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, null);
    f.renderMessage();
    f.flush();
    assert.equal(
      f.messages.at(-1).acknowledgement,
      null,
      "a gesture before the new message rendered is no read proof",
    );
    f.gesture();
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, null);
    f.window.__chatplusIsViewingNotification({
      tag: "conversation-a",
      arrival: 1,
    });
    f.gesture();
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, 1);
  });

  test(`${source}: background arrivals retain their content barrier through restore and stale projections`, () => {
    const f = fixture({ marker: false, source });
    f.foreground(false, 1, 2);
    f.window.__chatplusIsViewingNotification({
      tag: "conversation-a",
      arrival: 2,
      revision: 1,
    });
    f.flush();
    f.foreground(true, 2, 2);
    f.foreground(true, 2, 1);
    f.gesture();
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, null);
    f.renderMessage();
    f.gesture();
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, 2);
  });

  test(`${source}: exact event-view proof releases only that arrival's read barrier`, () => {
    const f = fixture({ marker: false, source });
    f.foreground(true, 3, 4);
    assert.equal(
      f.window.__chatplusIsViewingNotification({
        tag: "conversation-a",
        arrival: 3,
      }),
      true,
    );
    f.gesture();
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, 3);
    assert.deepEqual(f.messages.at(-1).readArrivals, [3]);
    assert.equal(
      f.window.__chatplusIsViewingNotification({
        tag: "conversation-a",
        arrival: 4,
      }),
      true,
    );
    f.gesture();
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, 3);
    assert.deepEqual(f.messages.at(-1).readArrivals, [4, 3]);
  });
}

test("positive sidebar evidence alone cannot read an unseen arrival in the old content", () => {
  const f = fixture({ marker: true });
  f.foreground(true, 1, 1);
  f.gesture();
  f.badges(false);
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
  f.renderMessage();
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
  f.window.__chatplusIsViewingNotification({
    tag: "conversation-a",
    arrival: 1,
  });
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, 1);
});

test("unrelated old-pane content changes never release an unknown native event", () => {
  const f = fixture({ marker: false });
  f.foreground(true, 1, 1);
  f.window.__chatplusIsViewingNotification({
    tag: "unrendered-message",
    arrival: 1,
  });
  f.renderMessage();
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
  assert.deepEqual(f.messages.at(-1).readArrivals, []);
});

test("rendering only an older message cannot prove a newer completed native arrival", () => {
  const f = fixture({ marker: false });
  f.foreground(true, 1, 1);
  f.window.__chatplusIsViewingNotification({
    tag: "conversation-a",
    arrival: 1,
    revision: 1,
  });
  f.foreground(true, 2, 2);
  f.window.__chatplusIsViewingNotification({
    tag: "conversation-a",
    arrival: 2,
    revision: 2,
  });
  f.renderMessage();
  f.gesture();
  f.flush();
  assert.deepEqual(f.messages.at(-1).readArrivals, [1]);
  f.window.__chatplusAcceptRead([1]);
  f.renderMessage();
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, 2);
  assert.deepEqual(f.messages.at(-1).readArrivals, [2]);
});

test("arrival history saturation keeps unread rather than evicting unknown events", () => {
  const f = fixture({ marker: false });
  for (let arrival = 1; arrival <= 257; arrival += 1)
    f.foreground(true, arrival, arrival);
  for (let arrival = 1; arrival <= 257; arrival += 1)
    f.window.__chatplusIsViewingNotification({
      tag: "conversation-a",
      arrival,
    });
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
});

test("a readonly query with stale renderer visibility cannot mint a lasting read proof", () => {
  const f = fixture({ marker: false });
  f.foreground(true, 1, 1);
  assert.equal(
    f.window.__chatplusIsViewingNotification({
      tag: "conversation-a",
      arrival: 1,
    }),
    true,
  );
  f.conversation("conversation-b");
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
  assert.deepEqual(f.messages.at(-1).readArrivals, []);
});

test("a rejected native read cannot reuse old proofs in another conversation", () => {
  const f = fixture({ marker: false });
  f.foreground(true, 1, 1);
  f.window.__chatplusIsViewingNotification({
    tag: "conversation-a",
    arrival: 1,
  });
  f.gesture();
  f.flush();
  assert.deepEqual(f.messages.at(-1).readArrivals, [1]);
  // Native deliberately sends no acceptance: its foreground revalidation rejected this proposal.
  f.conversation("conversation-b");
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
  assert.deepEqual(f.messages.at(-1).readArrivals, []);
});

test("native confirmation retires only accepted read events before reading another conversation", () => {
  const f = fixture({ marker: false });
  f.foreground(true, 1, 1);
  f.window.__chatplusIsViewingNotification({
    tag: "conversation-a",
    arrival: 1,
  });
  f.foreground(true, 2, 2);
  f.window.__chatplusIsViewingNotification({
    tag: "conversation-b",
    arrival: 2,
  });
  f.gesture();
  f.flush();
  assert.deepEqual(f.messages.at(-1).readArrivals, [1]);
  f.window.__chatplusAcceptRead([1]);
  f.conversation("conversation-b");
  f.gesture();
  f.flush();
  assert.deepEqual(f.messages.at(-1).readArrivals, [2]);
});

test("reading one exact event progresses while another conversation keeps provider badges positive", () => {
  const f = fixture({ marker: true });
  f.foreground(true, 1, 1);
  f.window.__chatplusIsViewingNotification({
    tag: "conversation-a",
    arrival: 1,
  });
  f.foreground(true, 2, 2);
  f.window.__chatplusIsViewingNotification({
    tag: "conversation-b",
    arrival: 2,
  });
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).hasUnread, true);
  assert.deepEqual(f.messages.at(-1).readArrivals, [1]);
  f.window.__chatplusAcceptRead([1]);
  f.conversation("conversation-b");
  f.badges(false);
  f.gesture();
  f.flush();
  assert.deepEqual(f.messages.at(-1).readArrivals, [2]);
});

test("exact event proofs progress through unknown aggregate UI without proposing a provider zero", () => {
  const f = fixture({ marker: false });
  f.foreground(true, 1, 1);
  f.window.__chatplusIsViewingNotification({
    tag: "conversation-a",
    arrival: 1,
  });
  f.aggregateUnavailable();
  f.gesture();
  f.flush();
  assert.deepEqual(f.messages.at(-1).readArrivals, [1]);
  assert.equal(f.messages.at(-1).proofOnly, true);
  assert.equal(f.messages.at(-1).reason, "native-read-proof");
});

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
      readArrivals: [],
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

for (const source of ["chatplus-dom", "synology-chat-dom", "discord-dom"]) {
  test(`${source}: logically focused selected provider cannot acknowledge while host is minimized or backgrounded`, () => {
    const f = fixture({ source });
    f.foreground(false, 8);
    f.badges(false);
    f.gesture();
    f.flush();
    assert.equal(f.messages.at(-1).source, source);
    assert.equal(f.messages.at(-1).acknowledgement, null);
    assert.equal(
      f.window.__chatplusIsViewingNotification({ tag: "conversation-a" }),
      false,
    );
  });
  test(`${source}: read acknowledgement belongs to the interacted conversation at its latest messages`, () => {
    const f = fixture({ source });
    f.foreground(true, 9);
    f.gesture();
    f.conversation("conversation-b");
    f.badges(false);
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, null);
    f.gesture({ inConversation: false });
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, null);
    f.conversation("conversation-b", false);
    f.gesture();
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, null);
    f.conversation("conversation-b", true);
    f.gesture();
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, 9);
  });
  test(`${source}: suppression needs matching conversation evidence and real host foreground`, () => {
    const f = fixture({ source });
    f.foreground(true, 10);
    f.flush();
    const viewed = f.window.__chatplusIsViewingNotification;
    assert.equal(viewed({ tag: "conversation-a" }), true);
    assert.equal(viewed({ tag: "conversation-b" }), false);
    f.conversation("conversation-a", false);
    assert.equal(viewed({ tag: "conversation-a" }), false);
    f.conversation("conversation-a", true);
    f.tabs(false);
    assert.equal(viewed({ tag: "conversation-a" }), false);
    f.tabs(true);
    f.foreground(false, 11);
    assert.equal(viewed({ tag: "conversation-a" }), false);
  });
}

test("unmount removes provider listeners and native script hooks", () => {
  const f = fixture();
  f.badges(false);
  const count = f.messages.length;
  f.stop();
  f.flush();
  assert.equal(f.messages.length, count);
  assert.equal(f.window.__chatplusSetForeground, undefined);
  assert.equal(f.window.__chatplusIsViewingNotification, undefined);
});

test("trusted scrolling can acknowledge reaching latest messages but not an older viewport", () => {
  const f = fixture();
  f.foreground(true, 12);
  f.conversation("conversation-a", false);
  f.gesture({ type: "wheel" });
  f.badges(false);
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
  f.conversation("conversation-a", true);
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, 12);
});

for (const source of ["chatplus-dom", "synology-chat-dom", "discord-dom"]) {
  test(`${source}: provider zero plus new trusted conversation input releases unmapped completed arrivals`, () => {
    const f = fixture({ marker: false, source, providerZero: true });
    f.foreground(false, 1, 1);
    f.window.__chatplusIsViewingNotification({ tag: "", arrival: 1 });
    f.flush();
    f.foreground(true, 2, 1);
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, null);
    f.gesture({ trusted: false, type: "input" });
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, null);
    // Swiph3l: Providers may finish rendering before the native query; requiring
    // a later content mutation would recreate the sticky unread after typing.
    f.gesture({ type: "input" });
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, 2);
    assert.equal(f.messages.at(-1).readScope, "provider-zero");
    assert.deepEqual(f.messages.at(-1).readArrivals, [1]);
  });
}

test("provider zero cannot reuse input across content, conversation, visibility or arrival changes", () => {
  for (const change of [
    (f) => f.renderMessage(),
    (f) => f.conversation("conversation-b"),
    (f) => f.foreground(false, 2, 1),
    (f) => f.foreground(true, 2, 2),
    (f) => f.window.__chatplusIsViewingNotification({ tag: "", arrival: 2 }),
  ]) {
    const f = fixture({ marker: false, providerZero: true });
    f.foreground(true, 1, 1);
    f.gesture();
    change(f);
    f.flush();
    assert.equal(f.messages.at(-1).acknowledgement, null);
    assert.equal(f.messages.at(-1).readScope, undefined);
  }
});

test("provider zero can recover saturated arrival history only through new trusted foreground read evidence", () => {
  const f = fixture({ marker: false, providerZero: true });
  for (let arrival = 1; arrival <= 257; arrival += 1)
    f.foreground(false, arrival, arrival);
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
  f.foreground(true, 258, 257);
  f.flush();
  assert.equal(f.messages.at(-1).acknowledgement, null);
  f.gesture();
  f.flush();
  assert.equal(f.messages.at(-1).readScope, "provider-zero");
  assert.equal(f.messages.at(-1).readArrivals.length, 256);
  f.window.__chatplusAcceptRead(f.messages.at(-1).readArrivals);
  f.foreground(true, 259, 258);
  f.window.__chatplusIsViewingNotification({
    tag: "conversation-a",
    arrival: 258,
  });
  f.badges(true);
  f.flush();
  f.gesture();
  f.flush();
  assert.deepEqual(f.messages.at(-1).readArrivals, [258]);
  assert.equal(f.messages.at(-1).readScope, undefined);
});
