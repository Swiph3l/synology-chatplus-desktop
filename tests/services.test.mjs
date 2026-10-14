import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";

const result = await build({
  entryPoints: ["src/ui/services.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "railUi",
  plugins: [
    {
      name: "native-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\/api\// }, ({ path }) => ({
          path,
          namespace: "native-fixture",
        }));
        builder.onLoad(
          { filter: /.*/, namespace: "native-fixture" },
          ({ path }) => ({
            contents: path.endsWith("core")
              ? "export const invoke = (...args) => globalThis.nativeInvoke(...args)"
              : "export const listen = (...args) => globalThis.nativeListen(...args)",
            loader: "js",
          }),
        );
        builder.onLoad({ filter: /[\\/]theme[\\/]theme\.ts$/ }, () => ({
          contents: "export const bindShellTheme = async () => {}",
          loader: "js",
        }));
      },
    },
  ],
});

test("an empty workspace offers the normal Add service flow without a provider assumption", async () => {
  const { window, document } = parseHTML(
    '<html><body><main id="app"></main></body></html>',
  );
  const settings = {
    onboardingCompleted: true,
    services: [],
    activeService: null,
    includeBetaUpdates: false,
  };
  const calls = [],
    events = new Map();
  const context = {
    window,
    document,
    nativeInvoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "get_settings") return settings;
    },
    nativeListen: async (event, callback) => {
      events.set(event, callback);
      return () => {};
    },
  };
  runInNewContext(result.outputFiles[0].text, context);
  await context.railUi.renderServices();
  assert.equal(document.querySelectorAll(".rail-services button").length, 0);
  assert.equal(
    document.querySelector(".workspace-empty h1").textContent,
    "No services configured.",
  );
  document.querySelector(".workspace-empty button").click();
  document.querySelector('[data-rail-key="add"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    calls
      .filter((call) => call.command === "open_settings")
      .map((call) => call.args.section),
    ["services-add", "services-add"],
  );
  events.get("services-changed")({
    payload: {
      ...settings,
      services: [
        {
          id: "community",
          provider: "discord",
          name: "Community",
          enabled: true,
        },
      ],
      activeService: "community",
    },
  });
  assert.equal(document.querySelector(".workspace-empty"), null);
  assert.equal(document.querySelectorAll(".rail-services button").length, 1);
});

test("two Discord instances keep separate rail identities and configured-name tooltips", async () => {
  const { window, document } = parseHTML(
    '<html><body><main id="app"></main></body></html>',
  );
  const settings = {
    activeService: "personal",
    services: [
      {
        id: "personal",
        provider: "discord",
        name: "Personal Discord",
        enabled: true,
      },
      {
        id: "work",
        provider: "discord",
        name: "GameDev Discord",
        enabled: true,
      },
      {
        id: "chatplus",
        provider: "synology-chatplus",
        name: "Home ChatPlus",
        enabled: true,
      },
    ],
  };
  const calls = [],
    events = new Map();
  const context = {
    window,
    document,
    nativeInvoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "get_settings") return settings;
    },
    nativeListen: async (event, callback) => {
      events.set(event, callback);
      return () => {};
    },
  };
  runInNewContext(result.outputFiles[0].text, context);
  await context.railUi.renderServices();
  const buttons = [...document.querySelectorAll(".rail-services button")];
  assert.equal(buttons.length, 3);
  assert.match(buttons[0].title, /^Personal Discord/);
  assert.match(buttons[1].title, /^GameDev Discord/);
  assert.equal(
    buttons[0].querySelector("img").src,
    buttons[1].querySelector("img").src,
  );
  for (const button of buttons.slice(0, 2))
    button.dispatchEvent(new window.Event("click"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    calls.filter((x) => x.command === "activate_service").map((x) => x.args.id),
    ["personal", "work"],
  );
  events.get("services-changed")({
    payload: { ...settings, activeService: "work" },
  });
  assert.equal(
    document
      .querySelector('[data-rail-key="personal"]')
      .getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    document
      .querySelector('[data-rail-key="work"]')
      .getAttribute("aria-pressed"),
    "true",
  );
});

test("service rail filters disabled services, routes activation and keeps unread per service", async () => {
  const { window, document } = parseHTML(
    '<html><body><main id="app"></main></body></html>',
  );
  const calls = [],
    events = new Map();
  const settings = {
    activeService: "a",
    services: [
      {
        id: "a",
        provider: "synology-chatplus",
        name: "ChatPlus",
        enabled: true,
      },
      {
        id: "b",
        provider: "slack",
        name: '<img src=x onerror="bad()">',
        enabled: true,
      },
      {
        id: "disabled",
        provider: "synology-chat",
        name: "Disabled",
        enabled: false,
      },
    ],
  };
  const context = {
    window,
    document,
    nativeInvoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "get_settings") return settings;
    },
    nativeListen: async (event, callback) => {
      events.set(event, callback);
      return () => {};
    },
  };
  let focused = null;
  Object.defineProperty(document, "activeElement", { get: () => focused });
  document.hasFocus = () => true;
  window.HTMLElement.prototype.focus = function () {
    focused = this;
  };
  runInNewContext(result.outputFiles[0].text, context);
  await context.railUi.renderServices();
  let buttons = [...document.querySelectorAll(".service-rail button")];
  assert.equal(buttons.length, 4);
  assert.equal(buttons[0].getAttribute("aria-pressed"), "true");
  assert.match(buttons[1].title, /Experimental/);
  assert.equal(
    document.querySelector('img[src="x"]'),
    null,
    "names are never markup",
  );
  assert.equal(document.querySelectorAll(".provider-icon").length, 2);
  assert.notEqual(
    buttons[0].querySelector("img").src,
    buttons[1].querySelector("img").src,
  );
  assert.match(buttons[1].title, /Slack/);
  assert.deepEqual(
    [...document.querySelectorAll(".rail-actions button")].map((x) => x.title),
    ["Add service", "Settings"],
  );
  buttons[1].dispatchEvent(new window.Event("click"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.at(-1).command, "activate_service");
  assert.equal(calls.at(-1).args.id, "b");
  buttons[1].focus();
  events.get("service-unread")({
    payload: {
      revision: 1,
      services: { a: { hasUnread: true }, b: { hasUnread: false } },
      aggregate: { hasUnread: true },
    },
  });
  events.get("services-changed")({
    payload: { ...settings, activeService: "b" },
  });
  buttons = [...document.querySelectorAll(".service-rail button")];
  assert.ok(buttons[0].classList.contains("has-unread"));
  assert.match(buttons[0].getAttribute("aria-label"), /unread messages/);
  assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
  assert.ok(!buttons[1].classList.contains("has-unread"));
  assert.equal(
    document.activeElement.dataset.railKey,
    "b",
    "unread and active-state rendering keep keyboard focus",
  );
});

async function contextFixture() {
  const { window, document } = parseHTML(
    '<html><body><main id="app"></main><p id="outside">Outside</p></body></html>',
  );
  const calls = [],
    events = new Map(),
    pending = [];
  const settings = {
    activeService: "first",
    services: [
      {
        id: "first",
        provider: "synology-chatplus",
        name: "First service",
        enabled: true,
      },
      {
        id: "second",
        provider: "discord",
        name: "Second service",
        enabled: true,
      },
    ],
  };
  let focused = null,
    railFocused = true,
    fail = false;
  Object.defineProperty(document, "activeElement", { get: () => focused });
  document.hasFocus = () => railFocused;
  window.HTMLElement.prototype.focus = function () {
    focused = this;
  };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { right: 48, top: this.dataset.railKey === "second" ? 104 : 64 };
  };
  const context = {
    window,
    document,
    nativeInvoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "get_settings") return settings;
      if (command === "show_service_context_menu") {
        if (fail) throw new Error("Fixture failure");
        await new Promise((resolve) => pending.push(resolve));
      }
    },
    nativeListen: async (event, callback) => {
      events.set(event, callback);
      return () => {};
    },
  };
  runInNewContext(result.outputFiles[0].text, context);
  await context.railUi.renderServices();
  const dispatch = (element, type, props = {}) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, props);
    element.dispatchEvent(event);
    return event;
  };
  return {
    document,
    calls,
    events,
    settings,
    dispatch,
    button: (id) => document.querySelector(`[data-rail-key="${id}"]`),
    menus: () =>
      calls.filter((call) => call.command === "show_service_context_menu"),
    dismiss: (index = pending.length - 1) => pending[index](),
    moveFocusOutside: () => {
      railFocused = false;
      document.getElementById("outside").focus();
    },
    blurShell: () => {
      railFocused = false;
    },
    fail: () => {
      fail = true;
    },
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

test("right-click suppresses only service icon menus and targets the clicked service without activating it", async () => {
  const f = await contextFixture();
  f.events.get("service-unread")({
    payload: {
      revision: 1,
      services: { first: { hasUnread: true } },
      aggregate: { hasUnread: true },
    },
  });
  const event = f.dispatch(
    f.button("second").querySelector("img"),
    "contextmenu",
    { clientX: 32, clientY: 125 },
  );
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.menus()[0].args.id, "second");
  assert.equal(f.menus()[0].args.x, 32);
  assert.equal(f.menus()[0].args.y, 125);
  assert.equal(f.button("second").getAttribute("aria-haspopup"), "menu");
  assert.equal(f.button("first").getAttribute("aria-pressed"), "true");
  assert.ok(f.button("first").classList.contains("has-unread"));
  assert.equal(
    f.calls.filter((call) => call.command === "activate_service").length,
    0,
  );
  for (const element of [
    f.document.body,
    f.document.querySelector(".rail-brand"),
    f.document.querySelector(".rail-actions button"),
  ]) {
    assert.equal(
      f.dispatch(element, "contextmenu", { clientX: 20, clientY: 20 })
        .defaultPrevented,
      false,
    );
  }
  assert.equal(f.menus().length, 1);
  f.dismiss();
  await f.flush();
});

test("keyboard context menu uses the current icon rectangle, including a scrolled rail", async () => {
  const f = await contextFixture();
  const button = f.button("second");
  button.getBoundingClientRect = () => ({ right: 46, top: 21 });
  assert.equal(
    f.dispatch(button, "keydown", { key: "F10", shiftKey: true })
      .defaultPrevented,
    true,
  );
  assert.equal(f.menus()[0].args.id, "second");
  assert.equal(f.menus()[0].args.x, 46);
  assert.equal(f.menus()[0].args.y, 21, "uses visible rect, not scroll offset");
  f.dismiss();
  await f.flush();
  assert.equal(
    f.dispatch(button, "keydown", { key: "ContextMenu" }).defaultPrevented,
    true,
  );
  assert.equal(f.menus().length, 2);
  f.dismiss();
  await f.flush();
});

test("native-menu dismissal restores a replaced trigger but never steals outside focus", async () => {
  const f = await contextFixture();
  f.dispatch(f.button("first"), "contextmenu", { clientX: 25, clientY: 70 });
  // Native menu handles Escape/outside click; the rail must leave these events untouched.
  assert.equal(
    f.dispatch(f.button("first"), "keydown", { key: "Escape" })
      .defaultPrevented,
    false,
  );
  assert.equal(
    f.dispatch(f.document.getElementById("outside"), "click").defaultPrevented,
    false,
  );
  f.events.get("service-unread")({
    payload: {
      revision: 1,
      services: { first: { hasUnread: true } },
      aggregate: { hasUnread: true },
    },
  });
  f.dismiss();
  await f.flush();
  assert.equal(f.document.activeElement, f.button("first"));
  f.dispatch(f.button("second"), "contextmenu", { clientX: 25, clientY: 110 });
  f.moveFocusOutside();
  f.dismiss();
  await f.flush();
  assert.equal(f.document.activeElement.id, "outside");
});

test("right-click on another service supersedes context and stale completion cannot steal its focus", async () => {
  const f = await contextFixture();
  f.dispatch(f.button("first"), "contextmenu", { clientX: 25, clientY: 70 });
  f.dispatch(f.button("second"), "contextmenu", { clientX: 25, clientY: 110 });
  assert.deepEqual(
    f.menus().map((call) => call.args.id),
    ["first", "second"],
  );
  f.dismiss(0);
  await f.flush();
  assert.equal(f.document.activeElement, f.button("second"));
  f.dismiss(1);
  await f.flush();
});

test("unread refresh never steals focus from a provider while the shell retains a stale activeElement", async () => {
  const f = await contextFixture();
  const oldButton = f.button("first");
  oldButton.focus();
  f.blurShell();
  f.events.get("service-unread")({
    payload: {
      revision: 1,
      services: { first: { hasUnread: true } },
      aggregate: { hasUnread: true },
    },
  });
  assert.equal(
    f.document.activeElement,
    oldButton,
    "no focus() call is made by the inactive shell",
  );
  assert.notEqual(f.button("first"), oldButton);
  assert.ok(f.button("first").classList.contains("has-unread"));
});

test("a failed native popup reports an accessible error without changing active/unread state", async () => {
  const f = await contextFixture();
  f.fail();
  f.dispatch(f.button("second"), "contextmenu", { clientX: 25, clientY: 110 });
  await f.flush();
  assert.match(
    f.document.getElementById("rail-status").textContent,
    /Could not open the service menu/,
  );
  assert.equal(f.button("first").getAttribute("aria-pressed"), "true");
});

test("saved display-name changes refresh the rail immediately with stable icon, ID and unread state", async () => {
  const f = await contextFixture();
  const icon = f.button("first").querySelector("img").src;
  f.events.get("service-unread")({
    payload: {
      revision: 1,
      services: { first: { hasUnread: true } },
      aggregate: { hasUnread: true },
    },
  });
  const settings = structuredClone(f.settings);
  settings.services[0].name = "Renamed service";
  f.events.get("services-changed")({ payload: settings });
  assert.match(f.button("first").title, /^Renamed service/);
  assert.equal(f.button("first").querySelector("img").src, icon);
  assert.equal(f.button("first").getAttribute("aria-pressed"), "true");
  assert.ok(f.button("first").classList.contains("has-unread"));
});

test("sidebar follows native multi-service snapshots and cannot resurrect dots from older revisions after clearing", async () => {
  const f = await contextFixture();
  const emit = (revision, first, second) => {
    const payload = {
      revision,
      services: {
        first: { hasUnread: first },
        second: { hasUnread: second },
      },
      aggregate: { hasUnread: first || second },
    };
    f.events.get("service-unread")({ payload });
    for (const id of ["first", "second"])
      assert.equal(
        f.button(id).classList.contains("has-unread"),
        payload.services[id].hasUnread,
      );
    assert.equal(
      [...f.document.querySelectorAll(".rail-services button")].some((button) =>
        button.classList.contains("has-unread"),
      ),
      payload.aggregate.hasUnread,
      "sidebar and tray aggregate derive from the same native transition",
    );
    return payload;
  };
  const both = emit(1, true, true);
  emit(2, false, true);
  emit(3, false, false);
  f.events.get("service-unread")({ payload: both });
  assert.equal(f.button("first").classList.contains("has-unread"), false);
  assert.equal(f.button("second").classList.contains("has-unread"), false);
});

test("the native unread snapshot IPC supplies the same initial per-service sidebar state", async () => {
  const { window, document } = parseHTML(
    '<html><body><main id="app"></main></body></html>',
  );
  const settings = {
    activeService: "first",
    services: [
      {
        id: "first",
        provider: "synology-chatplus",
        name: "First",
        enabled: true,
      },
      { id: "second", provider: "discord", name: "Second", enabled: true },
    ],
  };
  const native = {
    revision: 7,
    services: { first: { hasUnread: false }, second: { hasUnread: true } },
    aggregate: { hasUnread: true },
  };
  const context = {
    window,
    document,
    nativeInvoke: async (command) => {
      if (command === "get_settings") return settings;
      if (command === "get_unread_state") return native;
    },
    nativeListen: async () => () => {},
  };
  runInNewContext(result.outputFiles[0].text, context);
  await context.railUi.renderServices();
  for (const id of ["first", "second"])
    assert.equal(
      document
        .querySelector(`[data-rail-key="${id}"]`)
        .classList.contains("has-unread"),
      native.services[id].hasUnread,
    );
  assert.equal(
    document.querySelectorAll(".rail-services .has-unread").length,
    1,
  );
});

test("saved order and per-instance colors drive boolean unread dots in the rail", async () => {
  const f = await contextFixture();
  const settings = structuredClone(f.settings);
  settings.services[0].notificationColor = "red";
  settings.services[1].notificationColor = "cyan";
  settings.services.reverse();
  f.events.get("services-changed")({ payload: settings });
  f.events.get("service-unread")({
    payload: {
      revision: 1,
      services: { first: { hasUnread: true }, second: { hasUnread: true } },
      aggregate: { hasUnread: true },
    },
  });
  assert.deepEqual(
    [...f.document.querySelectorAll(".rail-services button")].map(
      (button) => button.dataset.railKey,
    ),
    ["second", "first"],
  );
  assert.equal(
    f.button("first").style.getPropertyValue("--notification-color"),
    "#c73948",
  );
  assert.equal(
    f.button("second").style.getPropertyValue("--notification-color"),
    "#18a9bd",
  );
  assert.ok(f.button("first").classList.contains("has-unread"));
  assert.ok(f.button("second").classList.contains("has-unread"));
  f.events.get("service-unread")({
    payload: {
      revision: 2,
      services: {
        first: { hasUnread: true, totalUnreadCount: 120 },
        second: { hasUnread: true, totalUnreadCount: 7 },
      },
      aggregate: { hasUnread: true },
    },
  });
  assert.equal(
    f.button("first").querySelector(".rail-unread-count").textContent,
    "99+",
  );
  assert.equal(
    f.button("second").querySelector(".rail-unread-count").textContent,
    "7",
  );
  assert.equal(f.button("first").classList.contains("has-unread"), false);
  assert.match(f.button("first").getAttribute("aria-label"), /120/);
  settings.services[0].notificationColor = "historical-invalid";
  delete settings.services[1].notificationColor;
  f.events.get("services-changed")({ payload: settings });
  assert.equal(
    f.button("first").style.getPropertyValue("--notification-color"),
    "var(--accent)",
  );
  assert.equal(
    f.button("second").style.getPropertyValue("--notification-color"),
    "var(--accent)",
  );
});

async function reorderFixture({ previewOverflow = 0 } = {}) {
  const { window, document } = parseHTML(
    '<html><body><main id="app"></main></body></html>',
  );
  let current = {
    activeService: "first",
    theme: "dark",
    services: [
      { id: "first", provider: "discord", name: "First", enabled: true },
      { id: "hidden", provider: "discord", name: "Hidden", enabled: false },
      { id: "second", provider: "discord", name: "Second", enabled: true },
      { id: "third", provider: "discord", name: "Third", enabled: true },
    ],
  };
  const calls = [],
    events = new Map(),
    timers = new Map();
  let clock = 0,
    nextTimer = 0,
    fail = false,
    pending;
  window.setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, at: clock + delay });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  const advance = (ms) => {
    const end = clock + ms;
    while (true) {
      const ready = [...timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!ready) break;
      clock = ready[1].at;
      timers.delete(ready[0]);
      ready[1].callback();
    }
    clock = end;
  };
  document.hasFocus = () => true;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains("rail-services"))
      return { top: 60, bottom: 198, left: 5, right: 51 };
    const list = this.closest(".rail-services");
    const index = list ? [...list.children].indexOf(this) : 0;
    const top = 63 + index * 46 - (list?.scrollTop ?? 0);
    return { top, bottom: top + 40, left: 8, right: 48 };
  };
  Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", {
    get() {
      return (
        600 +
        (this.classList.contains("rail-services") &&
        this.querySelector(".rail-dragging")
          ? previewOverflow
          : 0)
      );
    },
    configurable: true,
  });
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
    get: () => 138,
    configurable: true,
  });
  let focused;
  const captures = new Map();
  window.HTMLElement.prototype.setPointerCapture = function (id) {
    captures.set(id, this);
  };
  window.HTMLElement.prototype.hasPointerCapture = function (id) {
    return captures.get(id) === this;
  };
  window.HTMLElement.prototype.releasePointerCapture = function (id) {
    if (captures.get(id) === this) captures.delete(id);
  };
  Object.defineProperty(document, "activeElement", { get: () => focused });
  window.HTMLElement.prototype.focus = function () {
    focused = this;
  };
  const context = {
    window,
    document,
    nativeInvoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "get_settings") return structuredClone(current);
      if (command === "reorder_services") {
        if (fail) throw new Error("Locked settings file");
        const remaining = args.ids.map((id) =>
          current.services.find((item) => item.id === id),
        );
        current.services = current.services.map((item) =>
          item.enabled ? remaining.shift() : item,
        );
        const result = structuredClone(current);
        if (pending)
          return new Promise((resolve) => {
            pending.resolve = () => resolve(result);
          });
        events.get("services-changed")({ payload: result });
        return result;
      }
    },
    nativeListen: async (name, callback) => {
      events.set(name, callback);
      return () => {};
    },
  };
  runInNewContext(result.outputFiles[0].text, context);
  await context.railUi.renderServices();
  const dispatch = (element, type, properties = {}) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(
      event,
      {
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: 26,
        clientY: 83,
      },
      properties,
    );
    element.dispatchEvent(event);
    return event;
  };
  return {
    window,
    document,
    events,
    calls,
    advance,
    dispatch,
    button: (id) => document.querySelector(`[data-rail-key="${id}"]`),
    order: () =>
      [...document.querySelectorAll(".rail-services button")].map(
        (button) => button.dataset.railKey,
      ),
    saved: () => current,
    emit: (settings) => {
      current = settings;
      events.get("services-changed")({ payload: settings });
    },
    fail: () => {
      fail = true;
    },
    defer: () => {
      pending = {};
    },
    resolve: () => pending.resolve(),
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    reorderCalls: () =>
      calls.filter((call) => call.command === "reorder_services"),
    activationCalls: () =>
      calls.filter((call) => call.command === "activate_service"),
  };
}

test("rail quick clicks activate while hold/drop reorders enabled slots without activation", async () => {
  const f = await reorderFixture();
  const first = f.button("first");
  f.dispatch(first, "pointerdown");
  f.advance(1999);
  assert.ok(!first.classList.contains("rail-dragging"));
  assert.equal(f.document.querySelector(".rail-drop-marker").hidden, true);
  f.dispatch(f.window, "pointerup");
  f.dispatch(first, "click");
  assert.equal(f.activationCalls().length, 1);
  f.dispatch(first, "pointerdown");
  f.advance(1999);
  assert.ok(
    !first.classList.contains("rail-dragging"),
    "holding less than two seconds does not arm a drag",
  );
  f.advance(1);
  assert.ok(first.classList.contains("rail-dragging"));
  const marker = f.document.querySelector(".rail-drop-marker");
  assert.equal(marker.getAttribute("aria-hidden"), "true");
  assert.equal(marker.hidden, false);
  f.dispatch(f.window, "pointermove", { clientY: 190 });
  assert.equal(f.button("third").dataset.dropAfter, "true");
  assert.equal(
    marker.style.top,
    "136px",
    "marker sits in the gap after the final target",
  );
  f.dispatch(f.window, "pointerup", { clientY: 190 });
  f.dispatch(first, "click");
  await f.flush();
  assert.deepEqual(
    [...f.reorderCalls()[0].args.ids],
    ["second", "third", "first"],
  );
  assert.deepEqual(f.order(), ["second", "third", "first"]);
  assert.deepEqual(
    f.saved().services.map((item) => item.id),
    ["second", "hidden", "third", "first"],
  );
  assert.equal(f.saved().activeService, "first");
  assert.equal(f.saved().theme, "dark");
  assert.equal(
    f.activationCalls().length,
    1,
    "drop's synthesized click is consumed",
  );
  assert.equal(f.document.querySelector(".rail-drop-marker").hidden, true);
});

test("unread arriving during a quick press leaves the native click target alive through release", async () => {
  const f = await reorderFixture();
  const first = f.button("first");
  f.dispatch(first, "pointerdown");
  f.advance(100);
  f.events.get("service-unread")({
    payload: {
      revision: 1,
      services: { second: { hasUnread: true } },
      aggregate: { hasUnread: true },
    },
  });
  f.dispatch(f.window, "pointerup");
  await Promise.resolve();
  assert.equal(
    f.button("first"),
    first,
    "microtasks must not replace native click target",
  );
  f.dispatch(first, "click");
  f.advance(0);
  await f.flush();
  assert.equal(f.activationCalls().length, 1);
  assert.notEqual(f.button("first"), first);
  assert.ok(f.button("second").classList.contains("has-unread"));
});

test("a primary mouse hold tolerates icon drift, previews its movement and reorders upward", async () => {
  const f = await reorderFixture();
  const third = f.button("third");
  f.dispatch(third, "pointerdown", { clientY: 175 });
  assert.equal(third.hasPointerCapture(1), true);
  f.advance(80);
  f.dispatch(f.window, "pointermove", { clientX: 28, clientY: 167 });
  f.advance(1919);
  assert.equal(third.classList.contains("rail-dragging"), false);
  f.advance(1);
  assert.equal(third.classList.contains("rail-dragging"), true);
  assert.equal(third.hasPointerCapture(1), true);
  f.dispatch(f.window, "pointermove", { clientY: 65 });
  assert.ok(
    Number.parseFloat(third.style.getPropertyValue("--rail-drag-offset")) < 0,
    "the actual service icon follows upward movement",
  );
  f.dispatch(f.window, "pointerup", { clientY: 65 });
  f.dispatch(third, "click", { detail: 1 });
  await f.flush();
  assert.deepEqual(f.order(), ["third", "first", "second"]);
  assert.equal(third.hasPointerCapture(1), false);
  assert.equal(third.style.getPropertyValue("--rail-drag-offset"), "");
  assert.equal(f.activationCalls().length, 0);
});

test("moving the mouse and releasing before the hold deadline neither activates nor reorders", async () => {
  const f = await reorderFixture();
  const first = f.button("first");
  f.dispatch(first, "pointerdown");
  f.advance(80);
  f.dispatch(f.window, "pointermove", { clientY: 91 });
  f.dispatch(f.window, "pointerup", { clientY: 91 });
  f.dispatch(first, "click", { detail: 1 });
  f.advance(2100);
  await f.flush();
  assert.equal(f.activationCalls().length, 0);
  assert.equal(f.reorderCalls().length, 0);
  assert.equal(first.hasPointerCapture(1), false);
});

test("a released mouse button cannot arm a pending hold after a missed native pointerup", async () => {
  const f = await reorderFixture();
  const first = f.button("first");
  f.dispatch(first, "pointerdown");
  f.advance(80);
  f.dispatch(f.window, "pointermove", { buttons: 0 });
  f.advance(2100);
  f.dispatch(f.window, "pointerup", { clientY: 190 });
  f.dispatch(first, "click", { detail: 1 });
  assert.equal(first.classList.contains("rail-dragging"), false);
  assert.equal(first.hasPointerCapture(1), false);
  assert.equal(f.activationCalls().length, 0);
  assert.equal(f.reorderCalls().length, 0);
});

test("unread and nonstructural settings refreshes retain held rail nodes and apply latest state after drop", async () => {
  const f = await reorderFixture();
  const first = f.button("first");
  f.dispatch(first, "pointerdown");
  f.advance(2000);
  f.events.get("service-unread")({
    payload: {
      revision: 1,
      services: { second: { hasUnread: true, totalUnreadCount: 7 } },
      aggregate: { hasUnread: true },
    },
  });
  const changed = structuredClone(f.saved());
  changed.activeService = "second";
  changed.services[0].notifications = false;
  f.emit(changed);
  assert.equal(
    f.button("first"),
    first,
    "frequent refreshes cannot replace captured drag target",
  );
  f.dispatch(f.window, "pointermove", { clientY: 190 });
  f.dispatch(f.window, "pointerup", { clientY: 190 });
  f.dispatch(first, "click");
  await f.flush();
  assert.equal(f.button("second").getAttribute("aria-pressed"), "true");
  assert.equal(
    f.button("second").querySelector(".rail-unread-count").textContent,
    "7",
  );
  assert.equal(
    f.saved().services.find((item) => item.id === "first").notifications,
    false,
  );
  assert.equal(f.activationCalls().length, 0);
});

test("rail failures preserve original order and expose a status error", async () => {
  const f = await reorderFixture();
  f.fail();
  const first = f.button("first");
  f.dispatch(first, "pointerdown");
  f.advance(2000);
  f.dispatch(f.window, "pointermove", { clientY: 190 });
  f.dispatch(f.window, "pointerup", { clientY: 190 });
  f.dispatch(first, "click");
  await f.flush();
  assert.deepEqual(f.order(), ["first", "second", "third"]);
  assert.match(
    f.document.getElementById("rail-status").textContent,
    /Could not save the service order/,
  );
  assert.equal(f.activationCalls().length, 0);
});

test("rail cancels held gestures on Escape, pointer cancellation, blur, structural updates or native-view boundary", async () => {
  for (const reason of [
    "escape",
    "pointercancel",
    "blur",
    "outside",
    "structural",
    "released-button",
    "lost-capture",
  ]) {
    const f = await reorderFixture();
    const first = f.button("first");
    f.dispatch(first, "pointerdown");
    f.advance(2000);
    if (reason === "escape") f.dispatch(first, "keydown", { key: "Escape" });
    if (reason === "pointercancel") f.dispatch(f.window, "pointercancel");
    if (reason === "blur") f.dispatch(f.window, "blur");
    if (reason === "outside")
      f.dispatch(f.window, "pointermove", { clientX: 56, clientY: 190 });
    if (reason === "released-button")
      f.dispatch(f.window, "pointermove", { buttons: 0, clientY: 190 });
    if (reason === "lost-capture") f.dispatch(first, "lostpointercapture");
    if (reason === "structural") {
      const next = structuredClone(f.saved());
      next.services = next.services.filter((item) => item.id !== "third");
      f.emit(next);
    }
    f.dispatch(f.window, "pointerup", { clientY: 190 });
    f.dispatch(first, "click");
    f.advance(1000);
    await f.flush();
    assert.equal(f.reorderCalls().length, 0, reason);
    assert.equal(f.activationCalls().length, 0, reason);
    assert.equal(
      f.document.querySelectorAll(".rail-dragging").length,
      0,
      reason,
    );
  }
});

test("rail autoscroll continues at held edges and stays bounded", async () => {
  const f = await reorderFixture();
  const list = f.document.querySelector(".rail-services");
  f.dispatch(f.button("first"), "pointerdown");
  f.advance(2000);
  f.dispatch(f.window, "pointermove", { clientY: 195 });
  f.advance(2000);
  assert.equal(list.scrollTop, 462);
  assert.equal(
    list.querySelector(".rail-drop-marker").style.top,
    "136px",
    "marker uses scroll-content coordinates",
  );
  f.dispatch(f.window, "pointermove", { clientY: 61 });
  f.advance(3000);
  assert.equal(list.scrollTop, 0);
  f.dispatch(f.window, "pointercancel");
  assert.equal(list.querySelector(".rail-drop-marker").hidden, true);
});

test("drag preview overflow cannot grow the natural rail autoscroll limit", async () => {
  const f = await reorderFixture({ previewOverflow: 900 });
  const list = f.document.querySelector(".rail-services");
  f.dispatch(f.button("first"), "pointerdown");
  f.advance(2000);
  f.dispatch(f.window, "pointermove", { clientY: 195 });
  f.advance(10000);
  assert.equal(list.scrollTop, 462);
  f.advance(10000);
  assert.equal(list.scrollTop, 462, "a continued hold cannot extend the limit");
  f.dispatch(f.window, "pointercancel");
});

test("keyboard activation remains available after a cancelled hold without a synthesized pointer click", async () => {
  const f = await reorderFixture();
  const first = f.button("first");
  f.dispatch(first, "pointerdown");
  f.advance(2000);
  f.dispatch(f.window, "pointercancel");
  f.dispatch(first, "click", { detail: 0 });
  await f.flush();
  assert.equal(f.activationCalls().length, 1);
  assert.equal(f.reorderCalls().length, 0);
});

test("stale reorder replies cannot replace newer settings broadcasts; Alt+arrows retain keyboard focus", async () => {
  const f = await reorderFixture();
  f.defer();
  f.button("first").focus();
  f.dispatch(f.button("first"), "keydown", { key: "ArrowDown", altKey: true });
  const newer = structuredClone(f.saved());
  newer.activeService = "third";
  newer.services.find((item) => item.id === "first").name = "Latest name";
  f.emit(newer);
  f.resolve();
  await f.flush();
  assert.deepEqual(f.order(), ["second", "first", "third"]);
  assert.match(f.button("first").title, /^Latest name/);
  assert.equal(f.button("third").getAttribute("aria-pressed"), "true");
  assert.equal(f.document.activeElement, f.button("first"));
  assert.equal(f.activationCalls().length, 0);
});

test("late startup settings snapshot cannot undo a successful reorder reply", async () => {
  const { window, document } = parseHTML(
    '<html><body><main id="app"></main></body></html>',
  );
  const settings = {
    activeService: "first",
    services: [
      { id: "first", provider: "discord", name: "First", enabled: true },
      { id: "second", provider: "discord", name: "Second", enabled: true },
    ],
  };
  let reads = 0,
    completeSnapshot;
  const context = {
    window,
    document,
    nativeInvoke: async (command) => {
      if (command === "get_settings") {
        if (++reads === 1) return settings;
        return new Promise((resolve) => {
          completeSnapshot = () => resolve(settings);
        });
      }
      if (command === "reorder_services")
        return { ...settings, services: [...settings.services].reverse() };
    },
    nativeListen: async () => () => {},
  };
  runInNewContext(result.outputFiles[0].text, context);
  const mounting = context.railUi.renderServices();
  await new Promise((resolve) => setImmediate(resolve));
  const event = new window.Event("keydown", {
    bubbles: true,
    cancelable: true,
  });
  Object.assign(event, { key: "ArrowDown", altKey: true });
  document.querySelector('[data-rail-key="first"]').dispatchEvent(event);
  await new Promise((resolve) => setImmediate(resolve));
  completeSnapshot();
  await mounting;
  assert.deepEqual(
    [...document.querySelectorAll(".rail-services button")].map(
      (button) => button.dataset.railKey,
    ),
    ["second", "first"],
  );
});
