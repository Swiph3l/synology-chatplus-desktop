import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";

const built = await build({
  entryPoints: ["src/theme/providers/discord.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { createDiscordAdapter } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);

const guild = "111111111111111111";
const otherGuild = "222222222222222222";
const channel = "333333333333333333";
const otherChannel = "444444444444444444";
const message = "555555555555555555";
const otherMessage = "666666666666666666";
const folder = "42";

function guildRow({
  id = guild,
  position = 1,
  size = 1,
  pill = "",
  label = "Guild",
  name = "Guild",
  badge = "",
  expanded,
} = {}) {
  const attrs =
    expanded === undefined
      ? `aria-label="${label}"`
      : `aria-expanded="${expanded}" aria-owns="folder-items-${id}"`;
  return `<div class="listItem__current"><div class="wrapper__current" aria-hidden="true"><span class="item__current ${pill}"></span></div><div data-dnd-name="${name}"><a data-list-item-id="guildsnav___${id}" aria-setsize="${size}" aria-posinset="${position}" ${attrs}>${badge ? `<span class="numberBadge__current">${badge}</span>` : ""}</a></div></div>`;
}

function conversation({ id = channel, tag = message, history = false } = {}) {
  return `<div class="chatContent_current"><div class="messagesWrapper__current"><div class="scroller__current"><ol data-list-id="chat-messages"><li id="chat-messages-${id}-${tag}"><div id="message-content-${tag}">Message</div></li></ol></div>${history ? '<div class="jumpToPresentBar__current">Localized history control</div>' : ""}</div><div class="channelTextArea_current"><div role="textbox" contenteditable="true"><span id="composer-text">Draft</span></div></div></div>`;
}

function privateRow({
  id = otherChannel,
  size = 2,
  position = 2,
  state = "",
} = {}) {
  return `<li class="channel__current dm__current" aria-setsize="${size}" aria-posinset="${position}"><div class="interactive__current ${state}"><a href="/channels/@me/${id}">User</a></div></li>`;
}

function privateSidebar(row = privateRow()) {
  return `<ul data-list-id="private-channels-generated"><li class="channel__current" aria-setsize="2" aria-posinset="1"><a href="/channels/@me">Friends</a></li>${row}</ul>`;
}

function fixture({
  rows = guildRow(),
  dms = "",
  privateList = privateSidebar(),
  chat = conversation(),
  path = `/channels/@me/${channel}`,
} = {}) {
  const parsed = parseHTML(
    `<html><body><div data-list-id="guildsnav" role="tree"><div id="guild-list-unread-dms" role="group">${dms}</div><div role="group" id="root-guilds">${rows}</div></div>${privateList}${chat}<button id="header">Header</button></body></html>`,
  );
  const { document } = parsed;
  let browserFocused = true;
  const originalHasFocus = () => browserFocused;
  document.hasFocus = originalHasFocus;
  const listeners = new Map();
  const events = [];
  const view = {
    location: { pathname: path },
    MutationObserver: parsed.window.MutationObserver,
    getComputedStyle: (node) => ({
      display: node.style.display || "block",
      visibility: node.style.visibility || "visible",
    }),
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
      events.push(event.type);
      let stopped = false;
      Object.defineProperty(event, "stopImmediatePropagation", {
        value: () => {
          stopped = true;
        },
      });
      for (const capture of [true, false]) {
        for (const entry of listeners.get(event.type) ?? []) {
          if (entry.capture === capture && !stopped) entry.callback(event);
        }
      }
      return true;
    },
  };
  Object.defineProperty(document, "defaultView", { value: view });
  // Browser hit testing returns the visible message content, rather than the
  // ancestor list. Exact-notification occlusion checks need that distinction.
  document.elementFromPoint = () =>
    document.querySelector('[data-list-id="chat-messages"] li div');
  const bounds = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 300,
    right: 400,
    width: 400,
    height: 300,
  };
  for (const node of document.querySelectorAll("*"))
    node.getBoundingClientRect = () => bounds;
  const setDimensions = (scroller) => {
    for (const [key, value] of Object.entries({
      offsetHeight: 300,
      scrollHeight: 600,
      scrollTop: 300,
    })) {
      Object.defineProperty(scroller, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
  };
  for (const scroller of document.querySelectorAll('[class*="scroller__"]'))
    setDimensions(scroller);
  const adapter = createDiscordAdapter(document);
  const interact = (id = `message-content-${message}`) => {
    const target = document.getElementById(id);
    return adapter.interactionContext({
      target,
      composedPath: () => [target, target?.parentElement, document],
    });
  };
  return {
    document,
    view,
    events,
    adapter,
    interact,
    originalHasFocus,
    setDimensions,
    focus: (value) => {
      browserFocused = value;
    },
  };
}

test("Discord snapshots inspect the latest conversation once for both scoped state and completeness", () => {
  const f = fixture();
  const query = f.document.querySelectorAll.bind(f.document);
  let viewportQueries = 0;
  f.document.querySelectorAll = (selector) => {
    if (selector === '[data-list-id="chat-messages"]') viewportQueries += 1;
    return query(selector);
  };
  for (let index = 0; index < 100; index += 1) {
    const state = f.adapter.snapshot();
    assert.equal(state.hasUnread, false);
    assert.equal(state.currentConversation, channel);
  }
  assert.equal(viewportQueries, 100);
});

test("Discord rail evidence is DM-only and mention totals remain unknown counts", () => {
  for (const options of [
    {
      dms: '<div class="listItem__new"><span class="numberBadge__new">9+</span></div>',
    },
    {
      privateList:
        '<div data-list-id="private-channels-generated"><a href="/channels/@me/333333333333333333"><span class="unreadPill__new"></span></a></div>',
    },
  ]) {
    const f = fixture(options);
    const { hasUnread, count, unreadScope } = f.adapter.snapshot();
    assert.deepEqual(
      { hasUnread, count, unreadScope },
      {
        hasUnread: true,
        count: null,
        unreadScope: "direct-messages",
      },
    );
    assert.equal(f.adapter.providerUnreadZero(), false);
    assert.equal(f.adapter.providerAllUnreadZero(), false);
    assert.equal(f.adapter.tracksNotificationArrivals, false);
  }
  const f = fixture({
    rows: guildRow({ pill: "visible__new", badge: "2" }),
    chat:
      conversation() +
      '<div class="numberBadge__new">5</div><div class="unreadPill__new">Message divider</div>',
  });
  f.document.title = "(50) Discord";
  const { hasUnread, count, unreadScope } = f.adapter.snapshot();
  assert.deepEqual(
    { hasUnread, count, unreadScope },
    {
      hasUnread: false,
      count: null,
      unreadScope: "direct-messages",
    },
  );
  assert.equal(f.adapter.providerUnreadZero(), true);
  assert.equal(
    f.adapter.providerAllUnreadZero(),
    false,
    "unread guilds block Inbox zero, not the DM dot",
  );
});

test("guilds, Favorites, collapsed folders and media ambiguity never light the DM dot", () => {
  for (const rows of [
    guildRow({ pill: "visible__new" }),
    guildRow({ pill: "visible__new selected__new", badge: "2" }),
    guildRow({
      pill: "visible__new hovered__new",
      label: "Guild, localized unread",
    }),
    guildRow({ id: "favorites", pill: "visible__new" }),
    guildRow({ id: folder, expanded: false, pill: "visible__new" }),
    guildRow({
      id: folder,
      expanded: false,
      pill: "visible__new selected__new",
    }),
    guildRow({ id: folder, expanded: true }) +
      `<ul id="folder-items-${folder}" role="group">${guildRow({ pill: "visible__new" })}</ul>`,
  ]) {
    const f = fixture({ rows });
    assert.equal(f.adapter.snapshot().hasUnread, false);
    assert.equal(f.adapter.providerUnreadZero(), true);
    assert.equal(f.adapter.providerAllUnreadZero(), false);
  }
  const media = fixture({
    rows: guildRow({
      pill: "visible__new selected__new",
      label: "Localized media",
    }),
  });
  media.document
    .querySelector("[data-dnd-name]")
    .insertAdjacentHTML(
      "beforeend",
      '<span class="iconBadge__new">Media status</span>',
    );
  assert.equal(media.adapter.snapshot().hasUnread, false);
  assert.equal(media.adapter.providerAllUnreadZero(), false);
  const home = fixture();
  home.document
    .querySelector('[data-list-id="guildsnav"]')
    .insertAdjacentHTML("afterbegin", guildRow({ id: "home", badge: "5" }));
  assert.equal(home.adapter.snapshot().hasUnread, false);
  assert.equal(
    home.adapter.providerAllUnreadZero(),
    true,
    "Home promotions do not become messages",
  );
});

test("DM zero is separate from complete global guild and folder evidence", () => {
  for (const rows of [
    guildRow({ size: 2 }),
    guildRow({ size: 2 }) + guildRow({ id: otherGuild, size: 2, position: 1 }),
    "",
  ]) {
    const f = fixture({ rows });
    assert.equal(f.adapter.snapshot().hasUnread, false);
    assert.equal(f.adapter.providerUnreadZero(), true);
    assert.equal(
      f.adapter.providerAllUnreadZero(),
      false,
      "partial guilds cannot certify Inbox read-all",
    );
  }
  const complete = fixture({
    rows:
      guildRow({ size: 2 }) +
      guildRow({ id: otherGuild, size: 2, position: 2 }),
  });
  assert.equal(complete.adapter.providerAllUnreadZero(), true);
  complete.document.getElementById("root-guilds").replaceChildren();
  assert.equal(complete.adapter.snapshot().hasUnread, false);
  assert.equal(complete.adapter.providerAllUnreadZero(), false);
  const expanded = fixture({
    rows:
      guildRow({ id: folder, expanded: true }) +
      `<ul id="folder-items-${folder}" role="group">${guildRow()}</ul>`,
  });
  assert.equal(expanded.adapter.providerAllUnreadZero(), true);
  expanded.document
    .querySelector("#folder-items-42 [data-list-item-id]")
    .setAttribute("aria-setsize", "2");
  assert.equal(expanded.adapter.snapshot().hasUnread, false);
  assert.equal(expanded.adapter.providerAllUnreadZero(), false);
});

test("partial, muted, selected or hidden other DMs remain unknown and guild positives cannot replace them", () => {
  const missing = fixture({
    privateList: "",
    rows: guildRow({ pill: "visible__new" }),
  });
  assert.equal(missing.adapter.snapshot().hasUnread, null);
  assert.equal(missing.adapter.providerUnreadZero(), false);
  for (const row of [
    privateRow({ size: 3 }),
    privateRow({ position: 1 }),
    privateRow({ state: "muted__new" }),
    privateRow({ state: "interactiveSelected__new" }),
  ]) {
    const f = fixture({ privateList: privateSidebar(row) });
    assert.equal(f.adapter.snapshot().hasUnread, null);
    assert.equal(f.adapter.providerUnreadZero(), false);
    assert.equal(f.adapter.providerAllUnreadZero(), false);
  }
  const hovered = fixture();
  const row = hovered.document.querySelector('[class*="dm__"]');
  const originalMatches = row.matches.bind(row);
  row.matches = (selector) =>
    selector === ":hover" || originalMatches(selector);
  assert.equal(hovered.adapter.snapshot().hasUnread, null);
  const divider = fixture({
    privateList: `<ul data-list-id="private-channels-generated"><li class="channel__current" aria-setsize="3" aria-posinset="1"><a href="/channels/@me">Friends</a></li><div class="sectionDivider__current"></div>${privateRow({ size: 3, position: 3 })}</ul>`,
  });
  assert.equal(divider.adapter.snapshot().hasUnread, null);
  const request = fixture();
  request.document
    .querySelector('[data-list-id^="private-channels-"]')
    .insertAdjacentHTML(
      "beforeend",
      '<li><a href="/message-requests">Localized requests</a></li>',
    );
  assert.equal(request.adapter.snapshot().hasUnread, null);
  const missingAnchor = fixture();
  missingAnchor.document.querySelector('[class*="dm__"] a').remove();
  assert.equal(missingAnchor.adapter.snapshot().hasUnread, null);
  const hidden = fixture();
  hidden.document
    .querySelector('[data-list-id^="private-channels-"]')
    .setAttribute("hidden", "");
  assert.equal(hidden.adapter.snapshot().hasUnread, null);
  const noGroup = fixture();
  noGroup.document.getElementById("guild-list-unread-dms").remove();
  assert.equal(noGroup.adapter.snapshot().hasUnread, null);
});

test("only the exact latest visible current DM can resolve its own selected row", () => {
  const options = {
    privateList: privateSidebar(
      privateRow({ id: channel, state: "interactiveSelected__new" }),
    ),
  };
  const f = fixture(options);
  assert.equal(f.adapter.snapshot().hasUnread, false);
  assert.equal(f.adapter.providerUnreadZero(), true);
  assert.equal(
    f.adapter.providerAllUnreadZero(),
    false,
    "the current-DM exception is not provider-wide Inbox evidence",
  );
  f.document.querySelector('[class*="scroller__"]').scrollTop = 100;
  assert.equal(
    f.adapter.snapshot().hasUnread,
    null,
    "old history does not resolve a selected row",
  );
  f.document.querySelector('[class*="scroller__"]').scrollTop = 300;
  f.document.elementFromPoint = () => f.document.getElementById("header");
  assert.equal(
    f.adapter.snapshot().hasUnread,
    null,
    "a covered pane is not viewed",
  );
  const guildPane = fixture({
    ...options,
    path: `/channels/${guild}/${channel}`,
  });
  assert.equal(
    guildPane.adapter.snapshot().hasUnread,
    null,
    "the same channel snowflake in a guild route is outside DM scope",
  );
  const other = fixture({
    privateList: `<ul data-list-id="private-channels-generated"><li class="channel__current" aria-setsize="3" aria-posinset="1"><a href="/channels/@me">Friends</a></li>${privateRow({ id: channel, size: 3, position: 2, state: "interactiveSelected__new" })}${privateRow({ size: 3, position: 3, state: "muted__new" })}</ul>`,
  });
  assert.equal(
    other.adapter.snapshot().hasUnread,
    null,
    "a viewed DM cannot resolve another muted DM",
  );
  const unreadOther = fixture({
    ...options,
    dms: '<span class="numberBadge__new">1</span>',
  });
  assert.equal(
    unreadOther.adapter.snapshot().hasUnread,
    true,
    "another dedicated DM badge remains authoritative",
  );
});

test("Discord conversation read requires a matching visible route and the actual latest viewport", () => {
  const f = fixture();
  assert.equal(f.adapter.readContext(), channel);
  assert.equal(f.interact(), channel);
  assert.equal(f.interact("composer-text"), channel);
  assert.equal(f.interact("header"), null);
  const scroller = f.document.querySelector('[class*="scroller__"]');
  scroller.scrollTop = 200;
  assert.equal(f.adapter.readContext(), null);
  assert.equal(
    f.interact(),
    channel,
    "wheel input can remember the conversation before scrolling to latest",
  );
  scroller.scrollTop = 298;
  assert.equal(
    f.adapter.readContext(),
    channel,
    "provider scroll rounding tolerance is two pixels",
  );
  f.view.location.pathname = `/channels/${guild}/${otherChannel}`;
  assert.equal(
    f.adapter.readContext(),
    null,
    "stale SPA message rows cannot acknowledge the new conversation",
  );
  f.view.location.pathname = "/channels/@me";
  assert.equal(f.adapter.readContext(), null);
});

test("Discord content context follows actual newest message identity independently of latest scrolling", () => {
  const f = fixture();
  const initial = f.adapter.contentContext();
  assert.equal(initial, `${channel}:${message}`);
  const scroller = f.document.querySelector('[class*="scroller__"]');
  scroller.scrollTop = 100;
  assert.equal(f.adapter.readContext(), null);
  assert.equal(f.adapter.contentContext(), initial);
  const list = f.document.querySelector('[data-list-id="chat-messages"]');
  list.insertAdjacentHTML(
    "afterbegin",
    `<li id="chat-messages-${channel}-111111111111111111">Older virtualized message</li>`,
  );
  assert.equal(f.adapter.contentContext(), initial);
  list.insertAdjacentHTML(
    "beforeend",
    `<li id="chat-messages-${channel}-${otherMessage}">Incoming message</li>`,
  );
  assert.equal(f.adapter.contentContext(), `${channel}:${otherMessage}`);
  list.textContent = "Loading conversation";
  assert.equal(f.adapter.contentContext(), null);
  const stale = fixture({ chat: conversation({ id: otherChannel }) });
  assert.equal(stale.adapter.contentContext(), null);
});

test("history-bottom, hidden or covered messages and duplicate conversation surfaces remain unknown", () => {
  assert.equal(
    fixture({ chat: conversation({ history: true }) }).adapter.readContext(),
    null,
  );
  const covered = fixture();
  covered.document.elementFromPoint = () =>
    covered.document.getElementById("header");
  assert.equal(
    covered.adapter.readContext(),
    null,
    "Discord overlays must not count as viewing the underlying chat",
  );
  const hidden = fixture();
  hidden.document.querySelector('[class*="messagesWrapper_"]').style.display =
    "none";
  assert.equal(hidden.adapter.readContext(), null);
  const duplicate = fixture({ chat: conversation() + conversation() });
  const lists = [
    ...duplicate.document.querySelectorAll('[data-list-id="chat-messages"]'),
  ];
  lists[1].parentElement.getBoundingClientRect = () => ({
    top: 0,
    left: 500,
    bottom: 300,
    right: 900,
    width: 400,
    height: 300,
  });
  duplicate.document.elementFromPoint = (x) => lists[x < 500 ? 0 : 1];
  assert.equal(duplicate.adapter.readContext(), null);
});

test("Discord invalid or negative viewport metrics cannot acknowledge reads or suppress a toast", () => {
  for (const [metric, value] of [
    ["scrollTop", NaN],
    ["scrollTop", Infinity],
    ["scrollTop", -1],
    ["scrollHeight", NaN],
    ["scrollHeight", Infinity],
    ["scrollHeight", -1],
    ["offsetHeight", NaN],
    ["offsetHeight", Infinity],
    ["offsetHeight", -1],
  ]) {
    const f = fixture();
    f.document.querySelector('[class*="scroller__"]')[metric] = value;
    assert.equal(
      f.adapter.readContext(),
      null,
      `${metric}=${value} has no reliable latest viewport`,
    );
    assert.equal(f.adapter.isViewingNotification({ tag: message }), false);
  }
  const f = fixture();
  f.document.querySelector('[class*="scroller__"]').getBoundingClientRect =
    () => ({
      top: 0,
      left: 0,
      bottom: Infinity,
      right: 400,
      width: 400,
      height: Infinity,
    });
  assert.equal(f.adapter.readContext(), null);
});

test("Discord native notification tags match message snowflakes rather than channel IDs or titles", () => {
  const f = fixture();
  assert.equal(
    f.adapter.isViewingNotification({ tag: message, title: "Same name" }),
    true,
  );
  for (const tag of [channel, otherMessage, "discord:" + channel, ""]) {
    assert.equal(
      f.adapter.isViewingNotification({ tag, title: "Same name" }),
      false,
    );
  }
  const row = f.document.getElementById(`chat-messages-${channel}-${message}`);
  row.getBoundingClientRect = () => ({
    top: -200,
    bottom: -100,
    left: 0,
    right: 400,
    width: 400,
    height: 100,
  });
  assert.equal(
    f.adapter.isViewingNotification({ tag: message }),
    false,
    "a retained but offscreen message is not actually viewed",
  );
  assert.equal(
    fixture({
      chat: conversation({ history: true }),
    }).adapter.isViewingNotification({ tag: message }),
    false,
  );
  assert.equal(
    fixture({
      chat: conversation({ id: otherChannel }),
    }).adapter.isViewingNotification({ tag: message }),
    false,
  );
});

test("Discord notification hit testing rejects ancestor lists, sibling messages and overlays", () => {
  const f = fixture();
  assert.equal(f.adapter.isViewingNotification({ tag: message }), true);
  for (const selector of [
    '[data-list-id="chat-messages"]',
    '[class*="scroller__"]',
    "#header",
  ]) {
    f.document.elementFromPoint = () => f.document.querySelector(selector);
    assert.equal(
      f.adapter.isViewingNotification({ tag: message }),
      false,
      selector,
    );
  }
  f.document
    .querySelector('[data-list-id="chat-messages"]')
    .insertAdjacentHTML(
      "beforeend",
      `<li id="chat-messages-${channel}-${otherMessage}"><div id="other-content">Other message</div></li>`,
    );
  f.document.elementFromPoint = () =>
    f.document.getElementById("other-content");
  assert.equal(f.adapter.isViewingNotification({ tag: message }), false);
  f.document.elementFromPoint = () => null;
  assert.equal(f.adapter.isViewingNotification({ tag: message }), false);
});

test("guild and thread viewports can suppress exact toasts but cannot acknowledge DM unread", () => {
  const f = fixture({
    path: `/channels/${guild}/${otherChannel}/threads/${channel}`,
  });
  assert.equal(f.adapter.readContext(), null);
  assert.equal(f.adapter.contentContext(), null);
  assert.equal(f.interact(), null);
  assert.equal(f.adapter.isViewingNotification({ tag: message }), true);
  const guildPane = fixture({ path: `/channels/${guild}/${channel}` });
  assert.equal(guildPane.adapter.readContext(), null);
  assert.equal(guildPane.adapter.contentContext(), null);
  assert.equal(guildPane.interact(), null);
  assert.equal(guildPane.adapter.isViewingNotification({ tag: message }), true);
  const wrong = fixture({
    path: `/channels/${guild}/${otherChannel}/threads/${channel}`,
    chat: conversation({ id: otherChannel }),
  });
  assert.equal(wrong.adapter.readContext(), null);
  assert.equal(wrong.adapter.isViewingNotification({ tag: message }), false);
});

test("native foreground projection fixes Discord's public blur predicate despite logically focused minimized WebViews", () => {
  const f = fixture();
  let providerFocused = true;
  f.view.addEventListener("focus", () => {
    providerFocused = true;
  });
  f.view.addEventListener("blur", () => {
    if (!f.document.hasFocus()) providerFocused = false;
  });
  f.adapter.onHostForegroundChanged(false);
  assert.equal(
    f.originalHasFocus(),
    true,
    "Windows logical WebView focus remains true in this regression",
  );
  assert.equal(f.document.hasFocus(), false);
  assert.equal(
    providerFocused,
    false,
    "Discord's audited public blur handler now accepts background state",
  );
  f.adapter.onHostForegroundChanged(false);
  assert.deepEqual(
    f.events,
    ["blur"],
    "native generation-only updates must not repeat focus events",
  );
  f.view.dispatchEvent(new Event("focus"));
  assert.equal(
    providerFocused,
    false,
    "logical background focus cannot undo host visibility",
  );
  assert.deepEqual(f.events, ["blur", "focus", "blur"]);
  f.adapter.onHostForegroundChanged(true);
  assert.equal(f.document.hasFocus(), true);
  assert.equal(providerFocused, true);
  f.adapter.onHostForegroundChanged(true);
  assert.deepEqual(f.events, ["blur", "focus", "blur", "focus"]);
  f.focus(false);
  f.adapter.onHostForegroundChanged(false);
  f.adapter.onHostForegroundChanged(true);
  assert.equal(
    providerFocused,
    false,
    "native foreground cannot invent browser focus before real focus arrives",
  );
  f.focus(true);
  f.view.dispatchEvent(new Event("focus"));
  assert.equal(providerFocused, true);
});

test("Discord observes provider mutations and scrolling and releases observers and its browser focus override", async () => {
  const f = fixture();
  let changes = 0;
  const stop = f.adapter.observe(() => {
    changes += 1;
  });
  f.document
    .querySelector("[data-list-item-id]")
    .setAttribute("aria-label", "Localized unread status");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    changes >= 2,
    "provider status attributes are observed after initial root discovery",
  );
  const afterMutation = changes;
  const event = f.document.createEvent("Event");
  event.initEvent("scroll", true, false);
  f.document.querySelector('[class*="scroller__"]').dispatchEvent(event);
  assert.ok(
    changes > afterMutation,
    "viewport scrolling triggers fresh latest-message evidence",
  );
  stop();
  assert.equal(f.document.hasFocus, f.originalHasFocus);
  assert.ok(changes >= afterMutation);
  const afterStop = changes;
  f.document
    .querySelector("[data-list-item-id]")
    .setAttribute("aria-label", "Changed after teardown");
  f.view.dispatchEvent(new Event("resize"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(changes, afterStop);
});

test("Discord initialization before body discovers the later application surface", async () => {
  const f = fixture();
  const html = f.document.documentElement;
  html.remove();
  let changes = 0;
  const stop = f.adapter.observe(() => {
    changes += 1;
  });
  assert.equal(f.adapter.snapshot().hasUnread, null);
  f.document.append(html);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    changes > 0,
    "document-level discovery binds the provider after body is created",
  );
  assert.equal(f.adapter.snapshot().hasUnread, false);
  stop();
});
