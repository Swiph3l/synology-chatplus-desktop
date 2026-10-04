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

function fixture(provider, frame = false) {
  const { window: dom, document } = parseHTML(`<html><body class="eos-scope">
    <div><div id="sidebar-tab-item-messages"><span data-testid="tab-item-indicator"></span></div></div>
    <div class="syno-chat"><div class="channel-list-main"><div class="channel-list-view"><div class="channel-list-item highlight"></div></div></div></div>
    <div data-list-id="private-channels-example"><span class="unreadPill_current"></span></div>
  </body></html>`);
  const messages = [];
  const tasks = [];
  const listeners = new Map();
  const host = {
    __chatplusProvider: provider,
    location: { href: "https://example.com/", pathname: "/", hash: "" },
    MutationObserver: dom.MutationObserver,
    chrome: {
      webview: { postMessage: (value) => messages.push(JSON.parse(value)) },
    },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    dispatchEvent() {
      return true;
    },
  };
  host.top = frame ? {} : host;
  document.hasFocus = () => true;
  Object.defineProperty(document, "visibilityState", { value: "visible" });
  Object.defineProperty(document, "defaultView", { value: host });
  runInNewContext(built.outputFiles[0].text, {
    window: host,
    document,
    Event: dom.Event,
    KeyboardEvent: class {},
    queueMicrotask: (callback) => tasks.push(callback),
  });
  while (tasks.length) tasks.shift()();
  return { messages, host, document };
}

for (const [provider, source] of [
  ["synology-chatplus", "chatplus-dom"],
  ["synology-chat", "synology-chat-dom"],
  ["discord", "discord-dom"],
]) {
  test(`${provider}: complete native bootstrap chooses its own adapter without injecting ChatPlus CSS`, () => {
    const f = fixture(provider);
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].source, source);
    assert.equal(f.messages[0].hasUnread, true);
    assert.equal(f.messages[0].acknowledgement, null);
    assert.equal(typeof f.host.__chatplusSetForeground, "function");
    assert.equal(typeof f.host.__chatplusIsViewingNotification, "function");
    assert.equal(f.document.querySelector("#chatplus-desktop-theme"), null);
  });
}

test("unsupported providers and frames cannot install a different provider's unread adapter", () => {
  for (const provider of ["slack", "mattermost", "unknown", "constructor"]) {
    const f = fixture(provider);
    assert.deepEqual(f.messages, []);
    assert.equal(f.host.__chatplusSetForeground, undefined);
  }
  const f = fixture("synology-chatplus", true);
  assert.deepEqual(f.messages, []);
  assert.equal(f.host.__chatplusSetForeground, undefined);
});
