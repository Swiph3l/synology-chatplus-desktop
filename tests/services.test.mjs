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
  window.HTMLElement.prototype.focus = function () {
    focused = this;
  };
  runInNewContext(result.outputFiles[0].text, context);
  await context.railUi.renderServices();
  let buttons = [...document.querySelectorAll("button")];
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
    payload: { a: { hasUnread: true }, b: { hasUnread: false } },
  });
  events.get("services-changed")({
    payload: { ...settings, activeService: "b" },
  });
  buttons = [...document.querySelectorAll("button")];
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
    fail: () => {
      fail = true;
    },
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

test("right-click suppresses only service icon menus and targets the clicked service without activating it", async () => {
  const f = await contextFixture();
  f.events.get("service-unread")({ payload: { first: { hasUnread: true } } });
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
  f.events.get("service-unread")({ payload: { first: { hasUnread: true } } });
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
  f.events.get("service-unread")({ payload: { first: { hasUnread: true } } });
  const settings = structuredClone(f.settings);
  settings.services[0].name = "Renamed service";
  f.events.get("services-changed")({ payload: settings });
  assert.match(f.button("first").title, /^Renamed service/);
  assert.equal(f.button("first").querySelector("img").src, icon);
  assert.equal(f.button("first").getAttribute("aria-pressed"), "true");
  assert.ok(f.button("first").classList.contains("has-unread"));
});
