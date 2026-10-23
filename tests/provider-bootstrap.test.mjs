import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";
import { bridgeMessages } from "./helpers/bridge-messages.mjs";
import { randomUUID } from "node:crypto";

const built = await build({
  entryPoints: ["src/theme/unread.ts"],
  bundle: true,
  write: false,
  format: "iife",
});

function fixture(provider, frame = false, title) {
  const { window: dom, document } = parseHTML(`<html><body class="eos-scope">
    <div><div id="sidebar-tab-item-messages"><span data-testid="tab-item-indicator"></span></div></div>
    <div class="syno-chat"><div class="channel-list-main"><div class="channel-list-view"><div class="channel-list-item highlight"></div></div></div></div>
    <div data-list-id="private-channels-example"><a href="/channels/@me/333333333333333333"><span class="unreadPill_current"></span></a></div>
    <div id="pane-side"><div role="grid"><div role="row"><span data-testid="unread-count">2</span></div></div></div>
    <div role="navigation"><div role="grid"><div role="row"><span aria-label="Unread"></span></div></div></div>
  </body></html>`);
  const bridge = bridgeMessages();
  const { messages, diagnostics } = bridge;
  const tasks = [];
  const listeners = new Map();
  const host = {
    __chatplusProvider: provider,
    location: {
      href: "https://example.com/",
      pathname: provider === "messenger" ? "/messages/" : "/",
      hash: "",
    },
    MutationObserver: dom.MutationObserver,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    chrome: {
      webview: { postMessage: bridge.postMessage },
    },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    dispatchEvent() {
      return true;
    },
  };
  host.top = frame ? {} : host;
  if (provider === "whatsapp") document.title = title ?? "(2) WhatsApp";
  document.hasFocus = () => true;
  dom.HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 300,
    height: 100,
  });
  Object.defineProperty(document, "visibilityState", { value: "visible" });
  Object.defineProperty(document, "defaultView", { value: host });
  runInNewContext(built.outputFiles[0].text, {
    window: host,
    document,
    Event: dom.Event,
    KeyboardEvent: class {},
    crypto: { randomUUID },
    queueMicrotask: (callback) => tasks.push(callback),
  });
  while (tasks.length) tasks.shift()();
  return { messages, diagnostics, host, document };
}

for (const [provider, source] of [
  ["synology-chatplus", "chatplus-dom"],
  ["synology-chat", "synology-chat-dom"],
  ["discord", "discord-dom"],
  ["whatsapp", "whatsapp-dom"],
  ["messenger", "messenger-dom"],
  ["mattermost", "mattermost-dom"],
]) {
  test(`${provider}: complete native bootstrap chooses its own adapter without injecting ChatPlus CSS`, () => {
    const f = fixture(provider);
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].source, source);
    assert.equal(
      f.messages[0].hasUnread,
      ["messenger", "mattermost"].includes(provider) ? null : true,
    );
    if (provider === "whatsapp") {
      assert.equal(f.messages[0].unreadScope, "notification-attention");
      assert.equal(f.messages[0].certainty, "unknown");
      assert.equal("acknowledgement" in f.messages[0], false);
      assert.equal(f.messages[0].count, 2);
    } else assert.equal(f.messages[0].acknowledgement, null);
    if (provider === "discord")
      assert.equal(f.messages[0].unreadScope, "direct-messages");
    assert.equal(typeof f.host.__chatplusSetForeground, "function");
    assert.equal(typeof f.host.__chatplusIsViewingNotification, "function");
    assert.equal(f.document.querySelector("#chatplus-desktop-theme"), null);
  });
}

test("WhatsApp bootstrap cannot replace an unavailable official counter with a visible row badge", () => {
  const f = fixture("whatsapp", false, "Unavailable publisher title");
  assert.equal(f.messages[0].hasUnread, null);
  assert.equal(f.messages[0].unreadScope, "notification-attention");
});

test("unsupported providers and frames cannot install a different provider's unread adapter", () => {
  for (const provider of ["slack", "unknown", "constructor"]) {
    const f = fixture(provider);
    assert.deepEqual(f.messages, []);
    assert.equal(f.host.__chatplusSetForeground, undefined);
  }
  const f = fixture("synology-chatplus", true);
  assert.deepEqual(f.messages, []);
  assert.equal(f.host.__chatplusSetForeground, undefined);
});
