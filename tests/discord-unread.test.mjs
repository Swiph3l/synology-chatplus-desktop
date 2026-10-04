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

function fixture({
  rows = guildRow(),
  dms = "",
  privateList = "",
  chat = conversation(),
  path = `/channels/${guild}/${channel}`,
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
  document.elementFromPoint = () =>
    document.querySelector('[data-list-id="chat-messages"]');
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

test("Discord guild/DM evidence is scoped and mention totals are never presented as unread message counts", () => {
  for (const options of [
    { rows: guildRow({ pill: "visible__new" }) },
    { rows: guildRow({ pill: "visible__new selected__new", badge: "2" }) },
    {
      dms: '<div class="listItem__new"><span class="numberBadge__new">9+</span></div>',
    },
    {
      privateList:
        '<div data-list-id="private-channels-generated"><a href="/channels/@me/333333333333333333"><span class="unreadPill__new"></span></a></div>',
    },
  ]) {
    const f = fixture(options);
    assert.deepEqual(f.adapter.snapshot(), { hasUnread: true, count: null });
  }
  const f = fixture({
    chat:
      conversation() +
      '<div class="numberBadge__new">5</div><div class="unreadPill__new">Message divider</div><div id="sidebar-tab-item-invented"><span data-testid="tab-item-indicator"></span></div>',
  });
  f.document.title = "(50) Discord";
  assert.deepEqual(f.adapter.snapshot(), { hasUnread: false, count: null });
});

test("hover/selection cannot manufacture Discord unread or erase an ambiguous aggregate", () => {
  for (const pill of [
    "visible__new selected__new",
    "visible__new hovered__new",
  ]) {
    const unknown = fixture({
      rows: guildRow({ pill, label: "Guild, localized status" }),
    });
    unknown.document
      .querySelector("[data-dnd-name]")
      .insertAdjacentHTML(
        "beforeend",
        '<span class="iconBadge__new">Media status</span>',
      );
    assert.equal(unknown.adapter.snapshot().hasUnread, null);
    const clear = fixture({
      rows: guildRow({ pill, label: "Serwer", name: "Serwer" }),
    });
    assert.equal(
      clear.adapter.snapshot().hasUnread,
      false,
      "exact provider name proves clear independently of the UI locale",
    );
    const unread = fixture({
      rows: guildRow({ pill, label: "Guild, localized unread status" }),
    });
    assert.equal(
      unread.adapter.snapshot().hasUnread,
      true,
      "without a media badge the provider label change means unread/mentions",
    );
  }
});

test("Discord Home promotions are excluded while Favorites keeps its message aggregate", () => {
  const f = fixture();
  f.document
    .querySelector('[data-list-id="guildsnav"]')
    .insertAdjacentHTML("afterbegin", guildRow({ id: "home", badge: "5" }));
  assert.equal(f.adapter.snapshot().hasUnread, false);
  f.document
    .querySelector('[data-list-id="guildsnav"]')
    .insertAdjacentHTML(
      "afterbegin",
      guildRow({ id: "favorites", pill: "visible__new" }),
    );
  assert.equal(f.adapter.snapshot().hasUnread, true);
  const pill = f.document
    .querySelector('[data-list-item-id="guildsnav___favorites"]')
    .closest('[class*="listItem_"]')
    .querySelector("span");
  pill.className = "item__new visible__new selected__new";
  assert.equal(
    f.adapter.snapshot().hasUnread,
    null,
    "selected Favorites cannot clear a hidden unread conversation",
  );
});

test("Discord requires complete aggregate groups before a global clear", () => {
  const incomplete = fixture({ rows: guildRow({ size: 2 }) });
  assert.equal(incomplete.adapter.snapshot().hasUnread, null);
  const duplicated = fixture({
    rows:
      guildRow({ size: 2 }) +
      guildRow({ id: otherGuild, size: 2, position: 1 }),
  });
  assert.equal(duplicated.adapter.snapshot().hasUnread, null);
  const complete = fixture({
    rows:
      guildRow({ size: 2 }) +
      guildRow({ id: otherGuild, size: 2, position: 2 }),
  });
  assert.equal(complete.adapter.snapshot().hasUnread, false);
  complete.document.getElementById("root-guilds").replaceChildren();
  assert.equal(
    complete.adapter.snapshot().hasUnread,
    null,
    "temporary missing/virtualized guilds remain unknown",
  );
  const missingDms = fixture();
  missingDms.document.getElementById("guild-list-unread-dms").remove();
  assert.equal(missingDms.adapter.snapshot().hasUnread, null);
});

test("collapsed and expanded Discord folders preserve their provider aggregate meaning", () => {
  const collapsedUnread = fixture({
    rows: guildRow({ id: folder, expanded: false, pill: "visible__new" }),
  });
  assert.equal(collapsedUnread.adapter.snapshot().hasUnread, true);
  const selectedCollapsed = fixture({
    rows: guildRow({
      id: folder,
      expanded: false,
      pill: "visible__new selected__new",
    }),
  });
  assert.equal(selectedCollapsed.adapter.snapshot().hasUnread, null);
  const expanded = fixture({
    rows:
      guildRow({ id: folder, expanded: true }) +
      `<ul id="folder-items-${folder}" role="group">${guildRow({ pill: "visible__new", label: "Localized unread" })}</ul>`,
  });
  assert.equal(
    expanded.adapter.snapshot().hasUnread,
    true,
    "expanded folder pill is disabled; children own its evidence",
  );
  expanded.document.querySelector("#folder-items-42 span").className =
    "item__new selected__new visible__new";
  const link = expanded.document.querySelector(
    "#folder-items-42 [data-list-item-id]",
  );
  link.setAttribute("aria-label", "Guild");
  assert.equal(expanded.adapter.snapshot().hasUnread, false);
  link.setAttribute("aria-setsize", "2");
  assert.equal(
    expanded.adapter.snapshot().hasUnread,
    null,
    "an incomplete expanded folder cannot clear hidden guilds",
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

test("Discord thread routes only acknowledge the actual thread message viewport", () => {
  const f = fixture({
    path: `/channels/${guild}/${otherChannel}/threads/${channel}`,
  });
  assert.equal(f.adapter.readContext(), channel);
  assert.equal(f.adapter.isViewingNotification({ tag: message }), true);
  const wrong = fixture({
    path: `/channels/${guild}/${otherChannel}/threads/${channel}`,
    chat: conversation({ id: otherChannel }),
  });
  assert.equal(wrong.adapter.readContext(), null);
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
