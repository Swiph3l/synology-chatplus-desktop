import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { bridgeMessages } from "./helpers/bridge-messages.mjs";

const built = await build({
  stdin: {
    contents: `export { currentReadArrivals, readCapabilities } from "./src/theme/providers/read";
      export { createDiscordAdapter } from "./src/theme/providers/discord";
      export { installUnreadAdapter } from "./src/theme/provider-unread";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
});
const {
  currentReadArrivals,
  readCapabilities,
  createDiscordAdapter,
  installUnreadAdapter,
} = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);

test("read capabilities distinguish scoped local acknowledgement from unsupported provider actions", () => {
  assert.deepEqual(readCapabilities("discord-dom"), {
    current: "local",
    all: "local",
  });
  for (const source of ["chatplus-dom", "synology-chat-dom"])
    assert.deepEqual(readCapabilities(source), {
      current: "unsupported",
      all: "local",
    });
  assert.deepEqual(readCapabilities("whatsapp-dom"), {
    current: "unsupported",
    all: "unsupported",
  });
  assert.deepEqual(readCapabilities("messenger-dom"), {
    current: "unsupported",
    all: "unsupported",
  });
});

test("explicit current read retains unknown and unrelated arrivals and requires a stable mapped pane", () => {
  let context = "channel-a";
  let content = "channel-a:latest";
  const adapter = {
    source: "discord-dom",
    readContext: () => context,
    contentContext: () => content,
    isViewingNotification: ({ tag }) => tag.startsWith("channel-a:"),
  };
  const arrivals = new Map([
    [1, { tag: "channel-a:first" }],
    [2, { tag: "channel-b:unrelated" }],
    [3, null],
    [4, { tag: "channel-a:latest" }],
  ]);
  assert.deepEqual(currentReadArrivals(adapter, arrivals), [1, 4]);
  assert.equal(arrivals.size, 4, "querying does not itself retire tokens");
  context = null;
  assert.deepEqual(currentReadArrivals(adapter, arrivals), []);
  context = "channel-a";
  content = null;
  assert.deepEqual(currentReadArrivals(adapter, arrivals), []);
  content = "channel-a:latest";
  adapter.isViewingNotification = () => {
    context = "channel-b";
    return true;
  };
  assert.deepEqual(currentReadArrivals(adapter, arrivals), []);
  context = "channel-a";
  adapter.isViewingNotification = () => {
    content = "channel-a:replacement";
    return true;
  };
  assert.deepEqual(currentReadArrivals(adapter, arrivals), []);
  adapter.source = "whatsapp-dom";
  adapter.readContext = () => {
    throw new Error("unsupported actions must not inspect a provider pane");
  };
  assert.deepEqual(currentReadArrivals(adapter, arrivals), []);
  adapter.source = "messenger-dom";
  assert.deepEqual(currentReadArrivals(adapter, arrivals), []);
});

const guild = "111111111111111111";
const otherGuild = "222222222222222222";
const channel = "333333333333333333";
const otherChannel = "444444444444444444";
const firstMessage = "555555555555555555";
const secondMessage = "666666666666666666";
const unrelatedMessage = "777777777777777777";
const settle = () => new Promise(setImmediate);

function guildRow(id, pill, position) {
  return `<div class="listItem__current">
    <div class="wrapper__current" aria-hidden="true"><span class="item__current ${pill}"></span></div>
    <div data-dnd-name="Guild"><a data-list-item-id="guildsnav___${id}"
      aria-label="Guild" aria-setsize="2" aria-posinset="${position}"></a></div>
  </div>`;
}

function discordFixture(otherUnread = true) {
  const parsed = parseHTML(`<html><body>
    <div data-list-id="guildsnav"><div id="guild-list-unread-dms" role="group"></div>
      <div role="group">${guildRow(guild, "visible__current selected__current", 1)}
      ${guildRow(otherGuild, otherUnread ? "visible__current" : "", 2)}</div>
    </div>
    <ul data-list-id="private-channels-current">
      <li class="channel__current" aria-setsize="1" aria-posinset="1"><a href="/channels/@me">Friends</a></li>
    </ul>
    <div class="chatContent_current"><div class="messagesWrapper__current">
      <div class="scroller__current"><ol data-list-id="chat-messages">
        <li id="chat-messages-${channel}-${firstMessage}"><div id="first">First message</div></li>
        <li id="chat-messages-${channel}-${secondMessage}"><div id="second">Second message</div></li>
      </ol></div>
    </div></div></body></html>`);
  const { document } = parsed;
  let browserFocus = true;
  document.hasFocus = () => browserFocus;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  const host = Object.assign(new EventTarget(), {
    location: { pathname: `/channels/${guild}/${channel}` },
    MutationObserver: parsed.window.MutationObserver,
    getComputedStyle: (node) => ({
      display: node.style.display || "block",
      visibility: node.style.visibility || "visible",
    }),
  });
  Object.defineProperty(document, "defaultView", { value: host });
  const rect = (top = 0, bottom = 300) => ({
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: 400,
    width: 400,
    height: bottom - top,
  });
  for (const node of document.querySelectorAll("*"))
    node.getBoundingClientRect = () => rect();
  document.getElementById(
    `chat-messages-${channel}-${firstMessage}`,
  ).getBoundingClientRect = () => rect(0, 100);
  document.getElementById(
    `chat-messages-${channel}-${secondMessage}`,
  ).getBoundingClientRect = () => rect(100, 200);
  document.elementFromPoint = (_, y) =>
    document.getElementById(y < 100 ? "first" : "second");
  const scroller = document.querySelector(".scroller__current");
  for (const [key, value] of Object.entries({
    offsetHeight: 300,
    scrollHeight: 600,
    scrollTop: 300,
  }))
    Object.defineProperty(scroller, key, {
      configurable: true,
      writable: true,
      value,
    });
  const bridge = bridgeMessages();
  host.chrome = { webview: { postMessage: bridge.postMessage } };
  const adapter = createDiscordAdapter(document);
  const stop = installUnreadAdapter(adapter, document, host);
  return {
    document,
    host,
    adapter,
    stop,
    messages: bridge.messages,
    focus(value) {
      browserFocus = value;
      host.dispatchEvent(new Event(value ? "focus" : "blur"));
    },
  };
}

test("Discord service activation and selected guild label cannot produce a global read", async () => {
  const f = discordFixture(false);
  try {
    assert.equal(f.adapter.snapshot().hasUnread, null);
    f.host.__chatplusSetForeground(true, 7);
    await settle();
    assert.ok(f.messages.length > 0);
    assert.ok(f.messages.every((event) => event.acknowledgement === null));
    assert.ok(f.messages.every((event) => event.readScope !== "provider-zero"));
    assert.equal(
      f.host.__chatplusMarkCurrentRead(),
      false,
      "no known exact arrival exists",
    );
  } finally {
    f.stop();
  }
});

test("Discord explicit current read works after rail focus, acknowledges two visible messages and preserves an unrelated channel", async () => {
  const f = discordFixture();
  try {
    f.host.__chatplusSetForeground(true, 7);
    for (const [arrival, tag] of [
      [1, firstMessage],
      [2, secondMessage],
      [3, unrelatedMessage],
    ])
      f.host.__chatplusIsViewingNotification({ arrival, tag });
    await settle();
    f.focus(false);
    assert.equal(f.document.hasFocus(), false, "the rail owns browser focus");
    assert.equal(f.host.__chatplusMarkCurrentRead(), true);
    const event = f.messages.at(-1);
    assert.equal(event.reason, "explicit-current-local");
    assert.equal(event.hasUnread, true, "the unrelated guild still has unread");
    assert.deepEqual(event.readArrivals, [1, 2]);
    assert.equal(event.acknowledgement, 7);
    assert.equal(
      event.readScope,
      undefined,
      "current read never claims provider zero",
    );
    f.host.__chatplusAcceptRead([1, 2]);
    await settle();
    assert.equal(
      f.host.__chatplusMarkCurrentRead(),
      false,
      "unrelated arrival cannot match this pane",
    );
    f.host.location.pathname = `/channels/${otherGuild}/${otherChannel}`;
    assert.equal(
      f.host.__chatplusMarkCurrentRead(),
      false,
      "stale route content cannot widen acknowledgement",
    );
    f.host.__chatplusSetForeground(false, 8);
    assert.equal(f.host.__chatplusMarkCurrentRead(), false);
  } finally {
    f.stop();
  }
});
