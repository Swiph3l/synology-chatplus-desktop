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
  globalName: "shellUi",
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

const snapshot = (phase, latestVersion = null) => ({
  configured: true,
  channel: "stable",
  phase,
  currentVersion: "0.5.0-beta.3",
  latestVersion,
  notes: "",
  downloaded: 0,
  total: null,
  message: "",
  messageCode: "",
  lastSuccessfulCheck: null,
});

async function fixture({
  deferred = false,
  deferredSettings = false,
  language = "en",
} = {}) {
  const { window, document } = parseHTML(
    '<html><body><main id="app"></main></body></html>',
  );
  const calls = [],
    events = new Map();
  const settings = {
    language,
    activeService: "chatplus",
    services: [
      {
        id: "chatplus",
        provider: "synology-chatplus",
        name: "Home",
        enabled: true,
      },
    ],
  };
  let focused = null;
  Object.defineProperty(document, "activeElement", { get: () => focused });
  document.hasFocus = () => true;
  window.HTMLElement.prototype.focus = function () {
    focused = this;
  };
  let finishUpdate, finishConnection;
  let finishSettings;
  let settingsReads = 0;
  const settingsReply = deferredSettings
    ? new Promise((resolve) => {
        finishSettings = resolve;
      })
    : settings;
  const updateReply = deferred
    ? new Promise((resolve) => {
        finishUpdate = resolve;
      })
    : snapshot("idle");
  const connectionReply = deferred
    ? new Promise((resolve) => {
        finishConnection = resolve;
      })
    : "connected";
  const context = {
    window,
    document,
    nativeInvoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "get_settings")
        return ++settingsReads === 1 ? settings : settingsReply;
      if (command === "get_current_version") return "0.5.0-beta.3";
      if (command === "get_update_state") return updateReply;
      if (command === "get_connection_state") return connectionReply;
    },
    nativeListen: async (event, handler) => {
      events.set(event, handler);
      return () => {};
    },
  };
  runInNewContext(result.outputFiles[0].text, context);
  const rendering = context.shellUi.renderServices();
  await new Promise((resolve) => setImmediate(resolve));
  if (!deferred && !deferredSettings) await rendering;
  return {
    document,
    calls,
    events,
    settings,
    rendering,
    finishUpdate: (value) => finishUpdate(value),
    finishConnection: (value) => finishConnection(value),
    finishSettings: (value) => finishSettings(value),
    action: (key) => document.querySelector(`[data-footer-action="${key}"]`),
    status: () => document.getElementById("rail-status"),
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

test("footer shows installed version, disabled upcoming actions and existing project/About destinations", async () => {
  const f = await fixture();
  assert.equal(
    f.document.querySelector(".footer-version").textContent,
    "ChatPlus 0.5.0-beta.3",
  );
  for (const key of ["console", "donate"]) {
    assert.equal(f.action(key).disabled, true);
    assert.equal(f.action(key).title, "Coming soon");
    f.action(key).click();
  }
  await f.flush();
  assert.equal(
    f.calls.filter((call) =>
      ["open_project_link", "open_settings"].includes(call.command),
    ).length,
    0,
  );
  f.action("feedback").click();
  f.action("about").click();
  await f.flush();
  assert.equal(
    f.calls.find((call) => call.command === "open_project_link").args.link,
    "issues",
  );
  assert.equal(
    f.calls.find((call) => call.command === "open_settings").args.section,
    "about",
  );
  assert.equal(f.status().getAttribute("aria-live"), "polite");
});

test("unread and service refreshes preserve the footer node, status and enabled-action keyboard focus", async () => {
  const f = await fixture();
  const footer = f.document.querySelector(".app-footer");
  const about = f.action("about");
  about.focus();
  f.events.get("update-state")({ payload: snapshot("available", "0.5.0") });
  const status = f.status().textContent;
  f.events.get("service-unread")({
    payload: {
      revision: 1,
      services: { chatplus: { hasUnread: true } },
      aggregate: { hasUnread: true },
    },
  });
  f.events.get("services-changed")({ payload: f.settings });
  assert.equal(f.document.querySelector(".app-footer"), footer);
  assert.equal(f.document.activeElement, about);
  assert.equal(f.status().textContent, status);
  const update = f.status().querySelector("button");
  assert.equal(update.disabled, false);
  update.click();
  await f.flush();
  assert.equal(f.calls.at(-1).args.section, "updates");
});

test("footer keeps newer live status when initial native snapshots arrive late", async () => {
  const f = await fixture({ deferred: true });
  f.events.get("update-state")({ payload: snapshot("available", "0.5.0") });
  f.events.get("connection-changed")({ payload: "offline" });
  f.finishUpdate(snapshot("current"));
  f.finishConnection("connected");
  await f.rendering;
  assert.match(f.status().textContent, /Offline/i);
  assert.equal(f.status().querySelector("button").disabled, true);
  f.events.get("connection-changed")({ payload: "connected" });
  assert.match(f.status().textContent, /0\.5\.0/);
});

test("footer labels change with saved Spanish language without replacing actions", async () => {
  const f = await fixture();
  const about = f.action("about");
  f.events.get("services-changed")({
    payload: { ...f.settings, language: "es" },
  });
  assert.equal(f.action("about"), about);
  assert.equal(about.textContent, "Acerca de");
  assert.equal(f.action("console").title, "Próximamente");
  f.events.get("notification-issue")({});
  assert.ok(f.status().textContent.length > 0);
});

test("service and language changes during shell mounting take precedence over its older settings snapshot", async () => {
  const f = await fixture({ deferredSettings: true });
  const changed = structuredClone(f.settings);
  changed.language = "es";
  changed.services[0].name = "New name";
  f.events.get("services-changed")({ payload: changed });
  f.finishSettings(f.settings);
  await f.rendering;
  assert.match(
    f.document.querySelector(".rail-services button").title,
    /^New name/,
  );
  assert.equal(f.action("about").textContent, "Acerca de");
});
