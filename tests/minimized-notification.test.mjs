import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";

const built = await build({
  entryPoints: ["src/theme/unread.ts"],
  bundle: true,
  write: false,
  format: "iife",
});

const guild = "111111111111111111";
const channel = "333333333333333333";
const previousMessage = "555555555555555555";
const newMessage = "666666666666666666";
const providers = [
  ["Synology ChatPlus", "synology-chatplus", "chatplus-dom"],
  ["Synology Chat", "synology-chat", "synology-chat-dom"],
  ["Discord", "discord", "discord-dom"],
];

function fixture(provider) {
  const markup = {
    "synology-chatplus": `<main id="chat-main-app"><header><button id="sidebar-tab-item-a"></button></header>
      <section class="message-viewer-scrollbar" id="user-a"><article>Earlier message</article></section><textarea data-testid="message-create-box-text-area"></textarea></main>`,
    "synology-chat": `<main class="syno-chat"><aside class="channel-list-main">
      <div class="channel-list-container"><div class="channel-list-group"><i class="unread number-0"></i></div><div class="channel-list-view"><div class="channel-list-item"><span>User A</span><i class="unread number-0"></i></div></div></div>
      <div class="channel-list-container"><div class="channel-list-group"><i class="unread number-0"></i></div><div class="channel-list-view"></div></div>
      </aside><section class="chat-center-content-panel"><section class="msg-panel"><header class="chat-msg-top-toolbar"><button class="new-message-btn" style="display:none"></button></header>
      <div class="chat-msgview" id="user-a"><div class="mcontentwrapper"><div class="contentwrapper"><div class="msg-wrap" data-post-id="1">Earlier message</div></div></div></div></section><div class="chat-input-aria-main"><div class="msg-inputarea-textarea" contenteditable="true"></div></div></section></main>`,
    discord: `<div data-list-id="guildsnav" role="tree"><div id="guild-list-unread-dms" role="group"></div><div role="group" id="root-guilds">
      <div class="listItem__current"><div class="wrapper__current" aria-hidden="true"><span class="item__current"></span></div><div data-dnd-name="Guild"><a data-list-item-id="guildsnav___${guild}" aria-setsize="1" aria-posinset="1" aria-label="Guild"></a></div></div></div></div>
      <ul data-list-id="private-channels-generated"><li class="channel__current" aria-setsize="2" aria-posinset="1"><a href="/channels/@me">Friends</a></li><li class="channel__current dm__current" aria-setsize="2" aria-posinset="2"><div class="interactive__current"><a href="/channels/@me/${channel}">User A</a></div></li></ul>
      <div class="chatContent_current"><div class="messagesWrapper__current"><div class="scroller__current" id="user-a"><ol data-list-id="chat-messages"><li id="chat-messages-${channel}-${previousMessage}"><div>Earlier message</div></li></ol></div></div><div class="channelTextArea_current"><div role="textbox" contenteditable="true"></div></div></div>`,
  };
  const { document, window: dom } = parseHTML(
    `<html><body class="eos-scope">${markup[provider]}</body></html>`,
  );
  const messages = [];
  const tasks = [];
  const observers = [];
  const listeners = new Map();
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  const host = {
    __chatplusProvider: provider,
    location: {
      href: `https://provider.example/channels/${guild}/${channel}#channels/42`,
      pathname: `/channels/${guild}/${channel}`,
      hash: "#channels/42",
    },
    Event: dom.Event,
    MutationObserver,
    getComputedStyle: (node) => ({
      display: node.style.display || "block",
      visibility: node.style.visibility || "visible",
      overflowY: node.style.overflowY || "",
    }),
    chrome: {
      webview: { postMessage: (value) => messages.push(JSON.parse(value)) },
    },
    addEventListener(type, callback, capture = false) {
      const entries = listeners.get(type) ?? [];
      entries.push({ callback, capture });
      listeners.set(type, entries);
    },
    removeEventListener(type, callback) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter(
          (entry) => entry.callback !== callback,
        ),
      );
    },
    dispatchEvent(event) {
      let stopped = false;
      event.stopImmediatePropagation = () => {
        stopped = true;
      };
      for (const capture of [true, false])
        for (const entry of listeners.get(event.type) ?? [])
          if (entry.capture === capture && !stopped) entry.callback(event);
      return true;
    },
  };
  host.top = host;
  const rawHasFocus = () => true;
  Object.defineProperties(document, {
    defaultView: { value: host },
    hasFocus: { configurable: true, writable: true, value: rawHasFocus },
    hidden: { configurable: true, get: () => false },
    visibilityState: { configurable: true, get: () => "visible" },
  });
  const bounds = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 400,
    bottom: 200,
    width: 400,
    height: 200,
  };
  const geometry = () => {
    for (const node of document.querySelectorAll("*"))
      node.getBoundingClientRect = () => bounds;
  };
  geometry();
  const pane = document.getElementById("user-a");
  pane.style.overflowY = "auto";
  Object.assign(pane, {
    clientHeight: 200,
    offsetHeight: 200,
    scrollHeight: 600,
    scrollTop: 400,
  });
  document.elementFromPoint = () => pane;
  runInNewContext(built.outputFiles[0].text, {
    document,
    window: host,
    Event: dom.Event,
    KeyboardEvent: class {},
    queueMicrotask: (callback) => tasks.push(callback),
  });
  const flush = () => {
    while (tasks.length) tasks.shift()();
  };
  const changed = () => {
    geometry();
    for (const observer of observers)
      observer.callback([
        { target: pane, type: "childList", addedNodes: [], removedNodes: [] },
      ]);
    flush();
  };
  const gesture = (target = pane, type = "click", trusted = true) => {
    const event = new dom.Event(type, { bubbles: true });
    Object.defineProperty(event, "isTrusted", { value: trusted });
    target.dispatchEvent(event);
    flush();
  };
  const badges = (unread) => {
    if (provider === "synology-chatplus") {
      document.querySelector('[data-testid="tab-item-indicator"]')?.remove();
      if (unread) {
        const badge = document.createElement("span");
        badge.dataset.testid = "tab-item-indicator";
        document.querySelector("#sidebar-tab-item-a").append(badge);
      }
    } else if (provider === "synology-chat") {
      document
        .querySelector(".channel-list-item")
        .classList.toggle("highlight", unread);
    } else {
      document
        .querySelector(".item__current")
        .classList.toggle("visible__current", unread);
    }
    changed();
  };
  const arrival = () => {
    const message = document.createElement(
      provider === "discord" ? "li" : "article",
    );
    message.textContent = "New message from User A";
    if (provider === "discord")
      message.id = `chat-messages-${channel}-${newMessage}`;
    if (provider === "synology-chat") {
      message.className = "msg-wrap";
      message.dataset.postId = "2";
    }
    (
      document.querySelector(
        '[data-list-id="chat-messages"], .contentwrapper',
      ) ?? pane
    ).append(message);
    badges(true);
  };
  flush();
  return {
    document,
    host,
    pane,
    composer: document.querySelector(
      '[data-testid="message-create-box-text-area"], .msg-inputarea-textarea, [role="textbox"]',
    ),
    messages,
    rawHasFocus,
    flush,
    gesture,
    badges,
    arrival,
  };
}

// Swiph3l: Exercise the production bootstrap and real adapters together; changing only a fake adapter's source string cannot catch a provider missing its upstream visibility projection.
for (const [name, provider, source] of providers) {
  for (const mode of [
    "selected conversation receives a message while ChatPlus is minimized",
    "another service is selected while ChatPlus is minimized",
    "another service is selected while ChatPlus is foregrounded",
  ]) {
    test(`${name}: ${mode}`, () => {
      const f = fixture(provider);
      f.host.__chatplusSetForeground(true, 1, 0);
      f.flush();
      f.gesture();
      assert.equal(
        f.messages.at(-1).acknowledgement,
        1,
        "User A is a proven latest conversation before minimize/service switch",
      );
      const samePane = f.pane;
      f.host.__chatplusSetForeground(false, 2, 0);
      f.flush();
      assert.equal(
        f.rawHasFocus(),
        true,
        "the child WebView stays logically focused",
      );
      assert.equal(
        f.document.hasFocus() && !f.document.hidden,
        false,
        "provider public APIs must not report effective foreground",
      );
      const start = f.messages.length;
      f.host.__chatplusSetForeground(false, 2, 1);
      f.arrival();
      assert.equal(
        f.document.getElementById("user-a"),
        samePane,
        "conversation never changes",
      );
      assert.equal(f.messages.at(-1).source, source);
      assert.equal(
        f.messages.at(-1).hasUnread,
        true,
        "new message reports provider unread",
      );
      assert.equal(
        f.host.__chatplusIsViewingNotification({
          tag: newMessage,
          title: "User A",
          arrival: 1,
        }),
        false,
        "active conversation cannot suppress native delivery while host is inactive",
      );
      f.badges(false);
      f.gesture();
      f.host.__chatplusSetForeground(true, 1, 0);
      f.flush();
      assert.ok(
        f.messages
          .slice(start)
          .every((message) => message.acknowledgement === null),
        "badge removal, queued input and stale focus cannot clear native cached unread",
      );
      f.host.__chatplusSetForeground(true, 3, 1);
      f.flush();
      assert.equal(
        f.messages.at(-1).acknowledgement,
        null,
        "restore/select alone is not read",
      );
      f.gesture();
      assert.equal(f.messages.at(-1).acknowledgement, 3);
      assert.equal(f.messages.at(-1).readScope, "provider-zero");
      assert.deepEqual(
        f.messages.at(-1).readArrivals,
        [1],
        "trusted foreground conversation input plus proven provider zero retires the completed arrival without an exact tag",
      );
    });
  }
}

for (const [name, provider] of providers) {
  for (const input of ["keydown", "beforeinput", "input"]) {
    test(`${name}: foreground composer ${input} acknowledges a restored conversation without a notification tag`, () => {
      const f = fixture(provider);
      f.host.__chatplusSetForeground(false, 1, 1);
      f.arrival();
      f.host.__chatplusIsViewingNotification({ tag: "", arrival: 1 });
      f.badges(false);
      f.host.__chatplusSetForeground(true, 2, 1);
      f.flush();
      assert.equal(f.messages.at(-1).acknowledgement, null);
      f.gesture(f.composer, input, false);
      assert.equal(f.messages.at(-1).acknowledgement, null);
      f.gesture(f.composer, input);
      assert.equal(f.messages.at(-1).acknowledgement, 2);
      assert.equal(f.messages.at(-1).readScope, "provider-zero");
      assert.deepEqual(f.messages.at(-1).readArrivals, [1]);
    });
  }

  test(`${name}: sidebar/header activity cannot acknowledge a restored service zero`, () => {
    const f = fixture(provider);
    f.host.__chatplusSetForeground(false, 1, 1);
    f.arrival();
    f.badges(false);
    f.host.__chatplusSetForeground(true, 2, 1);
    f.flush();
    const sidebar = f.document.querySelector(
      '#sidebar-tab-item-a, .channel-list-item, [data-list-item-id^="guildsnav___"]',
    );
    f.gesture(sidebar);
    assert.equal(f.messages.at(-1).acknowledgement, null);
    f.gesture(f.composer);
    assert.equal(f.messages.at(-1).acknowledgement, 2);
  });

  test(`${name}: an unrelated unread conversation prevents a provider-wide zero proof`, () => {
    const f = fixture(provider);
    f.host.__chatplusSetForeground(false, 1, 1);
    f.arrival();
    f.host.__chatplusIsViewingNotification({ tag: "unmapped", arrival: 1 });
    f.host.__chatplusSetForeground(true, 2, 1);
    f.flush();
    f.gesture(f.composer, "input");
    assert.equal(f.messages.at(-1).hasUnread, true);
    assert.equal(f.messages.at(-1).readScope, undefined);
    assert.equal(f.messages.at(-1).acknowledgement, null);
  });
}
