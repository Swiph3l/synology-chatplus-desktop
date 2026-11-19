import { test } from "node:test";
import assert from "node:assert/strict";
import { providerFixtures } from "./helpers/provider-fixtures.mjs";

const fixture = await providerFixtures();

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

test("reinjection and page-cache transitions retain one observer owner and dispose it on document exit", () => {
  const f = fixture("whatsapp");
  const original = f.host.__chatplusSetForeground;
  f.boot();
  f.flush();
  assert.equal(f.host.__chatplusSetForeground, original);
  assert.equal(f.messages.length, 1);
  f.listeners.get("pagehide")({ isTrusted: true, persisted: true });
  assert.equal(f.host.__chatplusSetForeground, original);
  f.listeners.get("pagehide")({ isTrusted: true, persisted: false });
  assert.equal(f.host.__chatplusSetForeground, undefined);
  assert.equal(f.listeners.has("pagehide"), false);
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
