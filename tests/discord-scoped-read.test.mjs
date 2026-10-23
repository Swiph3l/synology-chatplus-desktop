import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";
import { bridgeMessages } from "./helpers/bridge-messages.mjs";

const built = await build({
  stdin: {
    contents: `export { createDiscordAdapter } from "./src/theme/providers/discord";
      export { installUnreadAdapter } from "./src/theme/provider-unread";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "discordRead",
});
const first = "111111111111111111";
const second = "222222222222222222";
const message = "333333333333333333";
const settle = () => new Promise(setImmediate);

function fixture({
  otherUnread = false,
  unattributed = false,
  privateList = true,
} = {}) {
  const rail = (id) =>
    `<div data-list-item-id="guildsnav___${id}"><span class="numberBadge_current">1</span></div>`;
  const dm = (id, position, unread) =>
    `<li class="channel_current dm_current" aria-setsize="30" aria-posinset="${position}"><a href="/channels/@me/${id}">${unread ? '<span class="unreadPill_current"></span>' : ""}</a></li>`;
  const { document, window: dom } = parseHTML(`<html><body>
    <div id="guild-list-unread-dms">${rail(first)}${otherUnread ? rail(second) : ""}${unattributed ? '<span class="numberBadge_current">1</span>' : ""}</div>
    ${privateList ? `<ul data-list-id="private-channels-current">${dm(first, 1, true)}${dm(second, 2, otherUnread)}</ul>` : ""}
    <button id="header">Header</button><div class="chatContent_current"><div class="messagesWrapper_current"><div class="scroller_current">
      <ol data-list-id="chat-messages"><li id="chat-messages-${first}-${message}"><div id="body">Message</div></li></ol>
    </div></div><div class="channelTextArea_current"><div id="composer" contenteditable="true"></div></div></div>
  </body></html>`);
  let focused = true,
    covered = false,
    clock = 1000;
  const host = Object.assign(new EventTarget(), {
    location: { pathname: `/channels/@me/${first}` },
    MutationObserver: dom.MutationObserver,
    getComputedStyle: (node) => ({
      display: node.style.display || "block",
      visibility: node.style.visibility || "visible",
    }),
  });
  Object.defineProperties(document, {
    defaultView: { value: host },
    hasFocus: { configurable: true, value: () => focused },
    visibilityState: { value: "visible" },
  });
  const bounds = {
    left: 0,
    top: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
  };
  dom.HTMLElement.prototype.getBoundingClientRect = () => bounds;
  document.elementFromPoint = () =>
    document.getElementById(covered ? "header" : "body");
  Object.assign(document.querySelector(".scroller_current"), {
    scrollTop: 300,
    scrollHeight: 600,
    offsetHeight: 300,
  });
  const bridge = bridgeMessages();
  host.chrome = { webview: { postMessage: bridge.postMessage } };
  const context = {
    Event,
    KeyboardEvent: class {},
    queueMicrotask,
    Date: class extends Date {
      static now() {
        return clock;
      }
    },
  };
  runInNewContext(built.outputFiles[0].text, context);
  const adapter = context.discordRead.createDiscordAdapter(document);
  const stop = context.discordRead.installUnreadAdapter(
    adapter,
    document,
    host,
  );
  return {
    document,
    host,
    adapter,
    stop,
    messages: bridge.messages,
    diagnostics: bridge.diagnostics,
    foreground(generation = 7, incoming = 2) {
      host.__chatplusSetForeground(true, generation, incoming);
    },
    read(id = first) {
      document
        .querySelector(
          `[data-list-item-id="guildsnav___${id}"] .numberBadge_current`,
        )
        ?.remove();
      document
        .querySelector(`a[href="/channels/@me/${id}"] .unreadPill_current`)
        ?.remove();
    },
    gesture(id = "body", trusted = true) {
      const event = new dom.Event("click", { bubbles: true });
      Object.defineProperty(event, "isTrusted", { value: trusted });
      document.getElementById(id).dispatchEvent(event);
    },
    arm(tag = message, generation = 7, incoming = 2) {
      return host.__chatplusPrepareToastRead({ tag }, generation, incoming);
    },
    cover(value = true) {
      covered = value;
      document.dispatchEvent(new dom.Event("scroll"));
    },
    blur() {
      focused = false;
      host.dispatchEvent(new Event("blur"));
    },
    advance(ms) {
      clock += ms;
    },
  };
}
function readProofs(f) {
  return f.messages.filter((event) => event.readScope === "conversation-read");
}

test("Discord maps non-href DM rail items before private sidebar exists", async () => {
  const f = fixture({ privateList: false, otherUnread: true });
  try {
    await settle();
    const state = f.adapter.snapshot();
    assert.equal(state.hasUnread, true);
    assert.equal(state.unattributedUnread, false);
    assert.deepEqual(JSON.parse(JSON.stringify(state.conversations)), [
      { id: first, hasUnread: true },
      { id: second, hasUnread: true },
    ]);
  } finally {
    f.stop();
  }
});

for (const otherUnread of [false, true]) {
  test(`Discord pane input reads only current observed DM with partial sidebar (other unread: ${otherUnread})`, async () => {
    const f = fixture({ otherUnread });
    try {
      f.foreground();
      await settle();
      f.read();
      await settle();
      assert.equal(
        readProofs(f).length,
        0,
        "badge disappearance and selection alone are not read",
      );
      f.gesture("body", false);
      await settle();
      assert.equal(readProofs(f).length, 0);
      f.gesture();
      await settle();
      const proof = readProofs(f).at(-1);
      assert.equal(proof.acknowledgement, 7);
      assert.equal(proof.hasUnread, otherUnread ? true : null);
      assert.equal(proof.currentConversation, first);
      assert.equal(proof.proofOnly, undefined);
      assert.deepEqual(proof.readArrivals, []);
      assert.ok(
        proof.conversations.some(
          (row) => row.id === first && row.hasUnread === false,
        ),
      );
      assert.equal(
        proof.conversations.some((row) => row.id === second && row.hasUnread),
        otherUnread,
      );
      assert.equal(
        f.adapter.providerUnreadZero(),
        false,
        "partial sidebar never becomes global DM zero",
      );
    } finally {
      f.stop();
    }
  });
}

test("Discord scoped read retains unattributed positive metadata", async () => {
  const f = fixture({ unattributed: true });
  try {
    f.foreground();
    await settle();
    f.read();
    await settle();
    f.gesture();
    await settle();
    const proof = readProofs(f).at(-1);
    assert.equal(proof.hasUnread, true);
    assert.equal(proof.unattributedUnread, true);
    assert.equal(proof.readScope, "conversation-read");
  } finally {
    f.stop();
  }
});

test("Discord read-context diagnostics are bounded per reason/generation and contain no identities", async () => {
  const f = fixture();
  try {
    f.foreground();
    await settle();
    f.gesture("header");
    f.gesture("header");
    f.document.querySelector(".scroller_current").scrollTop = 100;
    f.gesture();
    f.document.querySelector(".scroller_current").scrollTop = 300;
    f.gesture();
    f.gesture();
    await settle();
    const events = f.diagnostics.filter(
      (event) => event.event === "read-context-checked",
    );
    assert.deepEqual(
      events.map((event) => event.reason),
      ["conversation-unmapped", "latest-unavailable", "conversation-ready"],
    );
    for (const event of events) {
      assert.deepEqual(Object.keys(event).sort(), [
        "chatplusUnreadDiagnostic",
        "event",
        "generation",
        "reason",
        "source",
      ]);
      assert.equal(event.generation, 7);
      assert.ok(!JSON.stringify(event).includes(first));
    }
  } finally {
    f.stop();
  }
});

test("Discord native toast intent waits for exact message and provider row read transition", async () => {
  const f = fixture({ otherUnread: true });
  try {
    f.foreground();
    await settle();
    assert.equal(f.arm(), true);
    await settle();
    assert.equal(
      readProofs(f).length,
      0,
      "toast intent alone cannot read a positive row",
    );
    f.read();
    await settle();
    const proof = readProofs(f).at(-1);
    assert.equal(proof.reason, "toast-view-read-proof");
    assert.equal(proof.hasUnread, true, "another known DM remains unread");
    assert.equal(proof.currentConversation, first);
    assert.deepEqual(proof.readArrivals, []);
  } finally {
    f.stop();
  }
});

for (const [name, invalidate] of [
  ["new arrival", (f) => f.foreground(8, 3)],
  ["blur", (f) => f.blur()],
  ["expiry", (f) => f.advance(10001)],
  [
    "unrelated pane",
    (f) => {
      f.host.location.pathname = `/channels/@me/${second}`;
    },
  ],
  [
    "offscreen exact message",
    (f) => {
      f.document.querySelector('[id^="chat-messages-"]').getBoundingClientRect =
        () => ({
          left: 0,
          right: 400,
          top: -200,
          bottom: -100,
          width: 400,
          height: 100,
        });
    },
  ],
  ["covered pane", (f) => f.cover()],
  ["wrong exact tag", (f) => f.arm("999999999999999999")],
]) {
  test(`Discord toast intent cannot read after ${name}`, async () => {
    const f = fixture();
    try {
      f.foreground();
      await settle();
      f.arm();
      await settle();
      invalidate(f);
      f.read();
      await settle();
      assert.equal(readProofs(f).length, 0);
    } finally {
      f.stop();
    }
  });
}

test("Discord rejects a stale queued toast arm and clears hooks on teardown", async () => {
  const f = fixture();
  f.foreground(8, 3);
  await settle();
  assert.equal(f.arm(message, 7, 2), false);
  f.read();
  await settle();
  assert.equal(readProofs(f).length, 0);
  f.stop();
  assert.equal(f.host.__chatplusPrepareToastRead, undefined);
});
