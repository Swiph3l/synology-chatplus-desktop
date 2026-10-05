import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";

const loadAdapter = async (entry) => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
};
const [{ createChatplusAdapter }, { createSynologyChatAdapter }] =
  await Promise.all([
    loadAdapter("src/theme/providers/chatplus.ts"),
    loadAdapter("src/theme/providers/synology-chat.ts"),
  ]);

function fixture(html, hash = "") {
  const { document, window: dom } = parseHTML(
    `<html><body>${html}</body></html>`,
  );
  let browserVisible = true;
  let browserFocused = true;
  document.hasFocus = () => browserFocused;
  Object.defineProperties(document, {
    hidden: { configurable: true, get: () => !browserVisible },
    visibilityState: {
      configurable: true,
      get: () => (browserVisible ? "visible" : "hidden"),
    },
  });
  const observers = [];
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.records = [];
      observers.push(this);
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
    disconnect() {
      this.disconnected = true;
    }
    takeRecords() {
      return this.records.splice(0);
    }
  }
  const listeners = new Map();
  const windowEvents = document.createElement("window-event-target");
  const location = { href: `https://provider.example/${hash}`, hash };
  Object.defineProperty(document, "defaultView", {
    value: {
      MutationObserver,
      Event: dom.Event,
      location,
      getComputedStyle: (element) => ({
        display: element.style.display ?? "",
        visibility: element.style.visibility ?? "",
        overflowY: element.style.overflowY ?? "",
      }),
      addEventListener(type, callback, options) {
        listeners.set(type, callback);
        windowEvents.addEventListener(type, callback, options);
      },
      removeEventListener(type, callback, options) {
        listeners.delete(type);
        windowEvents.removeEventListener(type, callback, options);
      },
      dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
    },
  });
  for (const element of document.querySelectorAll("*")) {
    element.getBoundingClientRect = () => ({
      width: 500,
      height: 200,
      top: 100,
      bottom: 300,
    });
  }
  return {
    document,
    observers,
    listeners,
    location,
    browserVisibility: (value) => {
      browserVisible = value;
    },
    browserFocus: (value) => {
      browserFocused = value;
    },
    record(target, type = "childList", attributeName = null, nodes = {}) {
      for (const observer of observers)
        observer.records.push({
          target,
          type,
          attributeName,
          addedNodes: [],
          removedNodes: [],
          ...nodes,
        });
    },
    notify() {
      for (const observer of observers)
        observer.callback(observer.takeRecords());
    },
  };
}

// Swiph3l: These small fixtures are independently authored from audited selector semantics; they are not authenticated DOM captures or copied provider bundles.
const chatplusHtml = `<main id="chat-main-app"><header>
  <button id="sidebar-tab-item-a"></button><button id="sidebar-tab-item-b"><span data-testid="tab-item-indicator"></span></button>
  </header><section class="message-viewer-scrollbar"><article>Example</article></section>
  <textarea data-testid="message-create-box-text-area"></textarea></main>`;
function chatplusFixture() {
  const state = fixture(chatplusHtml);
  state.document.body.classList.add("eos-scope");
  const viewer = state.document.querySelector(".message-viewer-scrollbar");
  viewer.style.overflowY = "auto";
  Object.assign(viewer, {
    clientHeight: 200,
    scrollHeight: 600,
    scrollTop: 400,
  });
  const originalHasFocus = state.document.hasFocus;
  const originalDescriptors = ["hasFocus", "hidden", "visibilityState"].map(
    (key) => Object.getOwnPropertyDescriptor(state.document, key),
  );
  return {
    ...state,
    viewer,
    originalHasFocus,
    originalDescriptors,
    adapter: createChatplusAdapter(state.document),
  };
}

const chatHtml = `<main class="syno-chat"><aside class="channel-list-main">
  <div class="channel-list-container"><div class="channel-list-group"><i class="unread number-0"></i></div>
  <div class="channel-list-view"><div class="channel-list-item highlight"><span class="name">Example</span><i class="unread number-0"></i></div></div></div>
  <div class="channel-list-container"><div class="channel-list-group"><i class="unread number-0"></i></div><div class="channel-list-view"></div></div>
  </aside><section class="chat-center-content-panel"><section class="msg-panel"><header class="chat-msg-top-toolbar"><button class="new-message-btn" style="display:none"></button></header>
  <div class="chat-msgview"><div class="mcontentwrapper"><div class="contentwrapper"><div class="msg-wrap" data-post-id="1">Example</div></div></div></div></section><div class="chat-input-aria-main"><div class="msg-inputarea-textarea" contenteditable="true"></div></div></section></main>`;
function synologyChatFixture() {
  const state = fixture(chatHtml, "#channels/42");
  return {
    ...state,
    viewer: state.document.querySelector(".chat-msgview"),
    adapter: createSynologyChatAdapter(state.document),
  };
}

test("ChatPlus aggregates all audited tab indicators without inventing counts", () => {
  const { document, adapter } = chatplusFixture();
  assert.deepEqual(adapter.snapshot(), { hasUnread: true, count: null });
  document.querySelector('[data-testid="tab-item-indicator"]').remove();
  assert.deepEqual(adapter.snapshot(), { hasUnread: false, count: null });
  document.querySelector("header").remove();
  assert.deepEqual(adapter.snapshot(), { hasUnread: null, count: null });
});

test("ChatPlus maps its main composer and actual latest viewer while excluding the header", () => {
  const { document, viewer, adapter } = chatplusFixture();
  const context = adapter.readContext();
  assert.equal(typeof context, "string");
  assert.equal(
    adapter.interactionContext({ target: viewer.firstElementChild }),
    context,
  );
  assert.equal(
    adapter.interactionContext({ target: document.querySelector("button") }),
    null,
  );
  assert.equal(
    adapter.interactionContext({ target: document.querySelector("textarea") }),
    context,
  );
  viewer.scrollTop = 200;
  assert.equal(adapter.readContext(), null);
  assert.equal(adapter.interactionContext({ target: viewer }), context);
  viewer.scrollTop = 400;
  viewer.style.display = "none";
  assert.equal(adapter.readContext(), null);
  assert.equal(adapter.interactionContext({ target: viewer }), null);
});

test("Synology composers are scoped to one visible main conversation and exclude search/thread/ambiguous controls", () => {
  for (const make of [chatplusFixture, synologyChatFixture]) {
    const f = make();
    const editor = f.document.querySelector(
      '[data-testid="message-create-box-text-area"], .msg-inputarea-textarea',
    );
    const context = f.adapter.readContext();
    assert.equal(f.adapter.interactionContext({ target: editor }), context);
    const search = f.document.createElement("textarea");
    search.getBoundingClientRect = editor.getBoundingClientRect;
    f.document.querySelector("main").append(search);
    assert.equal(f.adapter.interactionContext({ target: search }), null);
    editor.style.display = "none";
    assert.equal(f.adapter.interactionContext({ target: editor }), null);
    editor.style.display = "";
    const duplicate = editor.cloneNode(true);
    duplicate.getBoundingClientRect = editor.getBoundingClientRect;
    editor.parentElement.append(duplicate);
    assert.equal(f.adapter.interactionContext({ target: editor }), null);
    duplicate.remove();
    if (f.adapter.source === "chatplus-dom")
      editor.setAttribute("data-testid", "thread-viewer-comments-section");
    else editor.setAttribute("contenteditable", "false");
    assert.equal(f.adapter.interactionContext({ target: editor }), null);
  }
});

test("Synology complete zero is an explicit adapter capability and missing provider surfaces cannot provide it", () => {
  for (const make of [chatplusFixture, synologyChatFixture]) {
    const f = make();
    assert.equal(f.adapter.providerUnreadZero(), false);
    f.document.querySelector('[data-testid="tab-item-indicator"]')?.remove();
    f.document
      .querySelector(".channel-list-item")
      ?.classList.remove("highlight");
    assert.equal(f.adapter.providerUnreadZero(), true);
    f.document
      .querySelector("#chat-main-app header, .channel-list-main")
      .remove();
    assert.equal(f.adapter.providerUnreadZero(), false);
  }
});

test("ChatPlus host presentation hides the previously active latest conversation despite raw WebView focus when minimized or another service is selected", () => {
  for (const scenario of ["selected-minimized", "another-service-selected"]) {
    const state = chatplusFixture();
    const { adapter, document, originalHasFocus } = state;
    const window = document.defaultView;
    const stop = adapter.observe(() => {});
    adapter.onHostForegroundChanged(false);
    adapter.onHostForegroundChanged(true);
    const conversation = adapter.readContext();
    assert.equal(typeof conversation, "string");
    const events = [];
    let providerFocused = document.hasFocus();
    for (const type of ["focus", "blur"])
      window.addEventListener(type, () => {
        providerFocused = document.hasFocus();
        events.push(type);
      });
    document.addEventListener("visibilitychange", () => {
      events.push(document.visibilityState);
    });
    adapter.onHostForegroundChanged(false);
    assert.equal(originalHasFocus(), true, scenario);
    assert.equal(document.hasFocus(), false, scenario);
    assert.equal(document.hidden, true, scenario);
    assert.equal(document.visibilityState, "hidden", scenario);
    assert.equal(providerFocused, false, scenario);
    assert.equal(
      adapter.readContext(),
      conversation,
      "the old conversation remains selected and at latest",
    );
    assert.deepEqual(events, ["blur", "hidden"]);
    adapter.onHostForegroundChanged(false);
    window.dispatchEvent(new window.Event("focus"));
    document.dispatchEvent(new window.Event("visibilitychange"));
    assert.deepEqual(
      events,
      ["blur", "hidden"],
      "logical native events cannot revive a background provider",
    );
    state.browserFocus(false);
    adapter.onHostForegroundChanged(true);
    assert.equal(document.hidden, false);
    assert.equal(
      document.hasFocus(),
      false,
      "restore cannot invent original browser focus",
    );
    assert.deepEqual(events, ["blur", "hidden", "visible"]);
    window.dispatchEvent(new window.Event("focus"));
    assert.equal(providerFocused, false);
    state.browserFocus(true);
    window.dispatchEvent(new window.Event("focus"));
    assert.equal(providerFocused, true);
    assert.equal(document.hasFocus(), true);
    state.browserVisibility(false);
    document.dispatchEvent(new window.Event("visibilitychange"));
    assert.equal(
      document.hidden,
      true,
      "native foreground cannot expose a browser-hidden document",
    );
    assert.equal(document.hasFocus(), false);
    assert.equal(providerFocused, false);
    state.browserVisibility(true);
    document.dispatchEvent(new window.Event("visibilitychange"));
    assert.equal(document.hasFocus(), true);
    stop();
    assert.equal(document.hasFocus, originalHasFocus);
    assert.deepEqual(
      ["hasFocus", "hidden", "visibilityState"].map((key) =>
        Object.getOwnPropertyDescriptor(document, key),
      ),
      state.originalDescriptors,
    );
    adapter.onHostForegroundChanged(false);
    window.dispatchEvent(new window.Event("focus"));
    assert.equal(
      providerFocused,
      true,
      "teardown releases native focus listeners",
    );
  }
});

test("ChatPlus host presentation preserves later provider overrides and rolls back nonconfigurable browser properties", () => {
  const state = chatplusFixture();
  const stop = state.adapter.observe(() => {});
  const providerHasFocus = () => false;
  Object.defineProperty(state.document, "hasFocus", {
    configurable: true,
    value: providerHasFocus,
  });
  stop();
  assert.equal(state.document.hasFocus, providerHasFocus);
  for (const key of ["hasFocus", "hidden", "visibilityState"]) {
    const fallback = fixture("");
    const originals = ["hasFocus", "hidden", "visibilityState"].map((name) =>
      Object.getOwnPropertyDescriptor(fallback.document, name),
    );
    Object.defineProperty(fallback.document, key, {
      ...Object.getOwnPropertyDescriptor(fallback.document, key),
      configurable: false,
    });
    originals[
      ["hasFocus", "hidden", "visibilityState"].indexOf(key)
    ].configurable = false;
    const adapter = createChatplusAdapter(fallback.document);
    adapter.onHostForegroundChanged(false);
    assert.equal(fallback.document.hasFocus(), true);
    assert.equal(fallback.document.hidden, false);
    assert.equal(fallback.document.visibilityState, "visible");
    const stopFallback = adapter.observe(() => {});
    stopFallback();
    assert.deepEqual(
      ["hasFocus", "hidden", "visibilityState"].map((name) =>
        Object.getOwnPropertyDescriptor(fallback.document, name),
      ),
      originals,
    );
  }
});

test("ChatPlus rejects zero or invalid viewport metrics and ambiguous/thread panes", () => {
  const { document, viewer, adapter } = chatplusFixture();
  for (const metrics of [
    { clientHeight: 0, scrollHeight: 0, scrollTop: 0 },
    { clientHeight: 200, scrollHeight: NaN, scrollTop: 400 },
    { clientHeight: 200, scrollHeight: 100, scrollTop: 0 },
    { clientHeight: 200, scrollHeight: 600, scrollTop: -1 },
  ]) {
    Object.assign(viewer, metrics);
    assert.equal(adapter.readContext(), null);
  }
  Object.assign(viewer, {
    clientHeight: 200,
    scrollHeight: 600,
    scrollTop: 400,
  });
  const second = viewer.cloneNode(true);
  Object.assign(second, {
    clientHeight: 200,
    scrollHeight: 600,
    scrollTop: 400,
  });
  second.getBoundingClientRect = viewer.getBoundingClientRect;
  document.querySelector("main").append(second);
  assert.equal(adapter.readContext(), null);
  second.remove();
  viewer.setAttribute("data-testid", "thread-viewer-comments-section");
  assert.equal(adapter.readContext(), null);
});

test("a ChatPlus wrapper cannot acknowledge unread while the actual nested viewport is above latest", () => {
  const { document, viewer, adapter } = chatplusFixture();
  viewer.style.overflowY = "hidden";
  Object.assign(viewer, { clientHeight: 600, scrollHeight: 600, scrollTop: 0 });
  const scroll = document.createElement("div");
  scroll.style.overflowY = "auto";
  Object.assign(scroll, {
    clientHeight: 200,
    scrollHeight: 600,
    scrollTop: 200,
  });
  scroll.getBoundingClientRect = viewer.getBoundingClientRect;
  scroll.append(viewer.firstElementChild);
  viewer.append(scroll);
  const context = adapter.interactionContext({
    target: scroll.firstElementChild,
  });
  assert.equal(typeof context, "string");
  assert.equal(adapter.readContext(), null);
  assert.equal(adapter.interactionContext({ target: viewer }), null);
  scroll.scrollTop = 400;
  assert.equal(adapter.readContext(), context);
  viewer.style.overflowY = "auto";
  assert.equal(
    adapter.readContext(),
    null,
    "multiple native viewports are ambiguous",
  );
  assert.equal(adapter.interactionContext({ target: scroll }), null);
  viewer.style.overflowY = "hidden";
  scroll.style.overflowY = "hidden";
  assert.equal(
    adapter.readContext(),
    null,
    "a custom transformed viewport has no audited native metrics",
  );
});

test("a reused ChatPlus view or route cannot reuse an earlier conversation gesture", () => {
  const { document, viewer, adapter, location, record, listeners } =
    chatplusFixture();
  let changes = 0;
  const stop = adapter.observe(() => changes++);
  const original = adapter.interactionContext({ target: viewer });
  record(viewer);
  assert.notEqual(
    adapter.readContext(),
    original,
    "pending mutation is drained before observer delivery",
  );
  const changed = adapter.readContext();
  record(viewer, "attributes", "style");
  assert.equal(
    adapter.readContext(),
    changed,
    "scroll movement preserves the gesture's conversation context",
  );
  record(viewer, "attributes", "class");
  assert.equal(
    adapter.readContext(),
    changed,
    "focus class churn preserves a real read gesture",
  );
  location.href = "https://provider.example/other";
  assert.notEqual(adapter.readContext(), changed);
  const beforeReplacement = adapter.readContext();
  const replacement = viewer.cloneNode(true);
  Object.assign(replacement, {
    clientHeight: 200,
    scrollHeight: 600,
    scrollTop: 400,
  });
  replacement.getBoundingClientRect = viewer.getBoundingClientRect;
  viewer.replaceWith(replacement);
  assert.notEqual(adapter.readContext(), beforeReplacement);
  listeners.get("resize")();
  assert.equal(changes, 1);
  stop();
  assert.equal(listeners.size, 0);
  assert.equal(
    document.querySelector(".message-viewer-scrollbar"),
    replacement,
  );
});

test("Synology Chat ordinary messages remain unread even when mention badges are zero", () => {
  const { document, adapter } = synologyChatFixture();
  assert.deepEqual(adapter.snapshot(), { hasUnread: true, count: null });
  document.querySelector(".channel-list-item").classList.remove("highlight");
  assert.deepEqual(adapter.snapshot(), { hasUnread: false, count: null });
  document.querySelector(".channel-list-group .unread").className =
    "unread number-3";
  assert.deepEqual(adapter.snapshot(), { hasUnread: true, count: null });
});

test("Synology Chat hidden ordinary-unread rows remain unread in a collapsed group with a zero mention badge", () => {
  const { document, adapter } = synologyChatFixture();
  const row = document.querySelector(".channel-list-item");
  row.classList.add("hidden");
  document.querySelector(".channel-list-group").classList.add("collapsed");
  document.querySelector(".channel-list-view").style.display = "none";
  assert.deepEqual(adapter.snapshot(), { hasUnread: true, count: null });
});

test("Synology Chat incomplete groups cannot turn a mention-only zero into global read evidence", () => {
  const { document, adapter } = synologyChatFixture();
  document.querySelector(".channel-list-item").classList.remove("highlight");
  assert.equal(adapter.snapshot().hasUnread, false);
  document.querySelectorAll(".channel-list-view")[1].remove();
  assert.equal(adapter.snapshot().hasUnread, null);
  document.querySelector(".channel-list-item").classList.add("highlight");
  assert.equal(
    adapter.snapshot().hasUnread,
    true,
    "positive evidence survives another group's incomplete mount",
  );
  document.querySelector(".channel-list-item").classList.remove("highlight");
  document.querySelectorAll(".channel-list-container")[1].remove();
  assert.equal(
    adapter.snapshot().hasUnread,
    null,
    "one rendered group is not the complete audited sidebar",
  );
});

test("Synology Chat collapsed/starred groups never double-count and unknown/login DOM stays unknown", () => {
  const { document, adapter } = synologyChatFixture();
  const group = document.querySelector(".channel-list-container");
  group.classList.add("collapsed");
  group.parentElement.append(group.cloneNode(true));
  assert.deepEqual(adapter.snapshot(), { hasUnread: true, count: null });
  for (const row of document.querySelectorAll(".channel-list-item"))
    row.classList.remove("highlight");
  document.querySelector(".channel-list-group .unread").className = "unread";
  assert.deepEqual(adapter.snapshot(), { hasUnread: null, count: null });
  document.querySelectorAll(".channel-list-group .unread")[1].className =
    "unread number-2";
  assert.deepEqual(
    adapter.snapshot(),
    { hasUnread: true, count: null },
    "known unread survives another group's temporary unknown state",
  );
  document.querySelector(".channel-list-main").remove();
  assert.deepEqual(adapter.snapshot(), { hasUnread: null, count: null });
  assert.deepEqual(
    createSynologyChatAdapter(chatplusFixture().document).snapshot(),
    { hasUnread: null, count: null },
  );
  assert.deepEqual(createChatplusAdapter(document).snapshot(), {
    hasUnread: null,
    count: null,
  });
});

test("Synology Chat read evidence requires the actual route, viewport and provider latest hint", () => {
  const { document, adapter, viewer, location } = synologyChatFixture();
  const context = adapter.readContext();
  assert.equal(typeof context, "string");
  assert.equal(
    adapter.interactionContext({ target: viewer.querySelector(".msg-wrap") }),
    context,
  );
  assert.equal(
    adapter.interactionContext({
      target: document.querySelector(".channel-list-item"),
    }),
    null,
  );
  const button = document.querySelector(".new-message-btn");
  button.style.display = "";
  assert.equal(adapter.readContext(), null);
  button.style.display = "none";
  const wrapper = document.querySelector(".contentwrapper");
  wrapper.getBoundingClientRect = () => ({ bottom: 400 });
  assert.equal(
    adapter.readContext(),
    null,
    "custom FleXcroll is above the content end",
  );
  wrapper.getBoundingClientRect = () => ({ bottom: 300 });
  location.hash = "#channels/unknown";
  assert.equal(adapter.readContext(), null);
  location.hash = "#channels/42";
  const mask = document.createElement("div");
  mask.className = "ext-el-mask";
  mask.getBoundingClientRect = () => ({ width: 500, height: 200 });
  document.querySelector(".syno-chat").append(mask);
  assert.equal(adapter.readContext(), null, "provider is still loading");
});

test("Synology Chat reused panes, route navigation and missing messages revoke read context", () => {
  const { document, adapter, viewer, location, record } = synologyChatFixture();
  const stop = adapter.observe(() => {});
  const before = adapter.readContext();
  record(viewer, "characterData");
  assert.notEqual(adapter.readContext(), before);
  const updated = adapter.readContext();
  location.href = "https://provider.example/#channels/43";
  location.hash = "#channels/43";
  assert.notEqual(adapter.readContext(), updated);
  document.querySelector(".msg-wrap").remove();
  assert.equal(adapter.readContext(), null);
  stop();
});

test("Synology pane detach/reinsert boundaries revoke old gestures even when the same element and route return", () => {
  for (const factory of [chatplusFixture, synologyChatFixture]) {
    const { adapter, viewer, record } = factory();
    const stop = adapter.observe(() => {});
    const context = adapter.readContext();
    assert.equal(typeof context, "string");
    const parent = viewer.parentElement;
    viewer.remove();
    assert.equal(adapter.readContext(), null);
    parent.append(viewer);
    record(parent, "childList", null, {
      removedNodes: [viewer],
      addedNodes: [viewer],
    });
    assert.notEqual(adapter.readContext(), context);
    stop();
  }
});

test("Synology content contexts change for message content but remain stable while scrolling to latest", () => {
  for (const factory of [chatplusFixture, synologyChatFixture]) {
    const { document, adapter, viewer, record } = factory();
    const stop = adapter.observe(() => {});
    const before = adapter.contentContext();
    assert.equal(typeof before, "string");
    if (adapter.source === "chatplus-dom") viewer.scrollTop = 200;
    else document.querySelector(".new-message-btn").style.display = "";
    record(viewer, "attributes", "style");
    assert.equal(adapter.readContext(), null);
    assert.equal(
      adapter.contentContext(),
      before,
      "scroll position alone is not proof of a new message rendering",
    );
    const rendered = document.createElement("article");
    viewer.append(rendered);
    record(viewer, "childList", null, { addedNodes: [rendered] });
    assert.notEqual(
      adapter.contentContext(),
      before,
      "new message content invalidates the captured arrival context",
    );
    assert.equal(
      adapter.readContext(),
      null,
      "content proof does not imply the user is at latest",
    );
    stop();
  }
});

test("Synology providers never suppress toasts based on generic titles or unverified tags", () => {
  const adapters = [chatplusFixture().adapter, synologyChatFixture().adapter];
  for (const adapter of adapters) {
    assert.equal(
      adapter.isViewingNotification({ tag: "", title: "Chat" }),
      false,
    );
    assert.equal(
      adapter.isViewingNotification({ tag: "42", title: "Example" }),
      false,
    );
  }
});

test("Synology Chat native visibility projection prevents upstream read activation in a logically visible minimized WebView", () => {
  const state = fixture(chatHtml, "#channels/42");
  const { document, browserVisibility } = state;
  const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
  const visibilityDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState",
  );
  const adapter = createSynologyChatAdapter(document);
  const stop = adapter.observe(() => {});
  const transitions = [];
  let active = true;
  // Swiph3l: Independently reproduce the audited ActiveDetector's public visibility predicate; this does not invoke provider stores or claim a live server notification test.
  document.addEventListener("visibilitychange", () => {
    active = !document.hidden;
    transitions.push(document.visibilityState);
  });
  adapter.onHostForegroundChanged(false);
  assert.equal(active, false);
  assert.equal(document.hidden, true);
  assert.equal(document.visibilityState, "hidden");
  adapter.onHostForegroundChanged(false);
  document.dispatchEvent(new document.defaultView.Event("visibilitychange"));
  assert.deepEqual(
    transitions,
    ["hidden"],
    "native logical visibility cannot reactivate a backgrounded provider",
  );
  adapter.onHostForegroundChanged(true);
  assert.equal(active, true);
  assert.equal(document.hidden, false);
  assert.deepEqual(transitions, ["hidden", "visible"]);
  browserVisibility(false);
  document.dispatchEvent(new document.defaultView.Event("visibilitychange"));
  assert.equal(
    active,
    false,
    "foreground projection cannot expose a browser-hidden page as visible",
  );
  adapter.onHostForegroundChanged(false);
  browserVisibility(true);
  document.dispatchEvent(new document.defaultView.Event("visibilitychange"));
  assert.equal(active, false);
  assert.equal(document.visibilityState, "hidden");
  adapter.onHostForegroundChanged(true);
  assert.equal(active, true);
  assert.deepEqual(transitions, ["hidden", "visible", "hidden", "visible"]);
  stop();
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(document, "hidden"),
    hiddenDescriptor,
  );
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(document, "visibilityState"),
    visibilityDescriptor,
  );
  browserVisibility(false);
  document.dispatchEvent(new document.defaultView.Event("visibilitychange"));
  assert.equal(
    active,
    false,
    "teardown restores browser events and properties",
  );
  assert.equal(transitions.length, 5);
});

test("Synology Chat visibility teardown respects later provider overrides and rolls back nonconfigurable properties", () => {
  const state = fixture(chatHtml, "#channels/42");
  const adapter = createSynologyChatAdapter(state.document);
  const stop = adapter.observe(() => {});
  const providerHidden = () => true;
  Object.defineProperty(state.document, "hidden", {
    configurable: true,
    get: providerHidden,
  });
  stop();
  assert.equal(
    Object.getOwnPropertyDescriptor(state.document, "hidden").get,
    providerHidden,
  );

  const fallback = fixture(chatHtml, "#channels/42");
  const original = Object.getOwnPropertyDescriptor(fallback.document, "hidden");
  Object.defineProperty(fallback.document, "visibilityState", {
    configurable: false,
    value: "visible",
  });
  const guarded = createSynologyChatAdapter(fallback.document);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(fallback.document, "hidden"),
    original,
  );
  guarded.onHostForegroundChanged(false);
  assert.equal(fallback.document.hidden, false);
  const stopFallback = guarded.observe(() => {});
  stopFallback();
  assert.equal(fallback.document.visibilityState, "visible");
});

test("Synology adapters observe the first provider mount when initialization precedes documentElement", () => {
  const { document, observers } = fixture("");
  const html = document.documentElement;
  html.remove();
  assert.equal(document.documentElement, null);
  for (const factory of [createChatplusAdapter, createSynologyChatAdapter]) {
    const adapter = factory(document);
    assert.deepEqual(adapter.snapshot(), { hasUnread: null, count: null });
    const stop = adapter.observe(() => {});
    const observer = observers.at(-1);
    assert.equal(observer.target, document);
    assert.equal(observer.options.childList, true);
    assert.equal(observer.options.attributes, true);
    stop();
    assert.equal(observer.disconnected, true);
  }
});
