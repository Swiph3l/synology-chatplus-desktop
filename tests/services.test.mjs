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
