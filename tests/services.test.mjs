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
  runInNewContext(result.outputFiles[0].text, context);
  await context.railUi.renderServices();
  let buttons = [...document.querySelectorAll("button")];
  assert.equal(buttons.length, 4);
  assert.equal(buttons[0].getAttribute("aria-pressed"), "true");
  assert.match(buttons[1].title, /Experimental/);
  assert.equal(
    document.querySelector("img"),
    null,
    "names are text, never markup",
  );
  buttons[1].dispatchEvent(new window.Event("click"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.at(-1).command, "activate_service");
  assert.equal(calls.at(-1).args.id, "b");
  events.get("service-unread")({
    payload: { a: { hasUnread: true }, b: { hasUnread: false } },
  });
  events.get("services-changed")({
    payload: { ...settings, activeService: "b" },
  });
  buttons = [...document.querySelectorAll("button")];
  assert.ok(buttons[0].classList.contains("has-unread"));
  assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
  assert.ok(!buttons[1].classList.contains("has-unread"));
});
