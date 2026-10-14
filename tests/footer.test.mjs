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

const snapshot = (phase, latestVersion = null, changes = {}) => ({
  configured: true,
  includeBetaUpdates: true,
  phase,
  currentVersion: "0.5.0-beta.3",
  latestVersion,
  notes: "",
  downloaded: 0,
  total: null,
  message: "",
  messageCode: "",
  lastSuccessfulCheck:
    phase === "current" || latestVersion ? 1_760_000_000 : null,
  ...changes,
});

async function fixture({
  deferred = false,
  deferredSettings = false,
  language = "en",
  initialUpdate = snapshot("idle"),
  settings: settingsOverrides = {},
} = {}) {
  const { window, document } = parseHTML(
    '<html><body><main id="app"></main></body></html>',
  );
  const calls = [],
    events = new Map();
  const settings = {
    language,
    includeBetaUpdates: initialUpdate.includeBetaUpdates,
    activeService: "chatplus",
    services: [
      {
        id: "chatplus",
        provider: "synology-chatplus",
        name: "Home",
        enabled: true,
      },
    ],
    ...settingsOverrides,
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
    : initialUpdate;
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
    update: () => document.querySelector(".footer-update"),
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
  assert.equal(f.update().hidden, true);
});

test("confirmed update is adjacent to the installed version and opens only the existing Updates settings flow", async () => {
  const f = await fixture({
    initialUpdate: snapshot("available", "0.5.0-beta.4"),
  });
  const update = f.update();
  const version = f.document.querySelector(".footer-version");
  assert.equal(update.parentElement.className, "footer-identity");
  assert.equal(version.nextElementSibling, update);
  assert.equal(update.tagName, "BUTTON");
  assert.equal(update.type, "button");
  assert.equal(update.dataset.railKey, "footer:update");
  assert.equal(update.hidden, false);
  assert.equal(update.disabled, false);
  assert.equal(update.textContent, "Update to 0.5.0-beta.4");
  assert.equal(update.title, "Version 0.5.0-beta.4 is available.");
  assert.equal(f.status().textContent, "");
  const beforeClick = f.calls.length;
  update.focus();
  assert.equal(f.document.activeElement, update);
  update.click();
  await f.flush();
  const clickCalls = f.calls.slice(beforeClick);
  assert.equal(clickCalls.length, 1);
  assert.equal(clickCalls[0].command, "open_settings");
  assert.equal(clickCalls[0].args.section, "updates");
  assert.equal(
    f.calls.some((call) =>
      [
        "check_for_updates",
        "download_update",
        "install_update",
        "download_and_install",
      ].includes(call.command),
    ),
    false,
  );
});

test("update indicator follows confirmed updater targets and hides after current, reset or failed checks", async () => {
  const f = await fixture();
  const update = f.update();
  for (const state of [
    snapshot("checking"),
    snapshot("available", "0.5.0", { lastSuccessfulCheck: null }),
    snapshot("available", "", { lastSuccessfulCheck: 1_760_000_000 }),
    snapshot("available", null, { lastSuccessfulCheck: 1_760_000_000 }),
    snapshot("available", "0.5.0", { configured: false }),
  ]) {
    f.events.get("update-state")({ payload: state });
    assert.equal(update.hidden, true, JSON.stringify(state));
  }
  for (const phase of [
    "available",
    "checking",
    "downloading",
    "ready",
    "installing",
  ]) {
    f.events.get("update-state")({
      payload: snapshot(phase, "0.5.0-beta.4"),
    });
    assert.equal(update.hidden, false, phase);
    assert.equal(update.textContent, "Update to 0.5.0-beta.4");
    if (phase !== "available") assert.ok(f.status().textContent.length > 0);
  }
  f.events.get("update-state")({
    payload: snapshot("available", "0.5.0-beta.5"),
  });
  assert.equal(f.update(), update);
  assert.equal(update.textContent, "Update to 0.5.0-beta.5");
  assert.equal(update.title, "Version 0.5.0-beta.5 is available.");
  for (const phase of ["idle", "current", "unconfigured", "error"]) {
    f.events.get("update-state")({
      payload: snapshot(phase, "0.5.0-beta.5"),
    });
    assert.equal(update.hidden, true, phase);
  }
  f.events.get("update-state")({
    payload: snapshot("available", "0.5.0-beta.5"),
  });
  f.events.get("update-state")({
    payload: snapshot("checking", null, { messageCode: "preference-changed" }),
  });
  assert.equal(update.hidden, true);
});

test("saved beta preference gates cached initial targets and delayed updater events", async () => {
  const cached = await fixture({
    initialUpdate: snapshot("available", "0.6.0-beta.1"),
    settings: { includeBetaUpdates: false },
  });
  assert.equal(cached.update().hidden, true);
  assert.equal(cached.status().textContent, "");

  const f = await fixture({
    initialUpdate: snapshot("available", "0.6.0-beta.1"),
  });
  assert.equal(f.update().hidden, false);
  f.events.get("services-changed")({
    payload: { ...f.settings, includeBetaUpdates: false },
  });
  assert.equal(f.update().hidden, true);
  f.events.get("update-state")({
    payload: snapshot("idle", null, {
      includeBetaUpdates: false,
      messageCode: "preference-changed",
    }),
  });
  for (const phase of ["available", "downloading", "ready", "installing"]) {
    f.events.get("update-state")({
      payload: snapshot(phase, "0.6.0-beta.1"),
    });
    assert.equal(f.update().hidden, true, phase);
    assert.equal(f.status().textContent, "", phase);
    assert.equal(f.status().querySelector("button").disabled, true, phase);
  }
  f.events.get("update-state")({
    payload: snapshot("available", "0.5.0", { includeBetaUpdates: false }),
  });
  assert.equal(f.update().textContent, "Update to 0.5.0");
  assert.equal(f.update().hidden, false);
  f.events.get("services-changed")({ payload: f.settings });
  assert.equal(f.update().hidden, true);
  f.events.get("update-state")({
    payload: snapshot("available", "0.6.0-beta.2"),
  });
  assert.equal(f.update().hidden, false);
  assert.equal(f.update().textContent, "Update to 0.6.0-beta.2");
});

test("confirmed target remains accessible through transient update errors and offline status", async () => {
  const f = await fixture({
    initialUpdate: snapshot("available", "0.5.0-beta.4"),
  });
  const update = f.update();
  for (const [phase, messageCode] of [
    ["available", "check-failed"],
    ["available", "download-failed"],
    ["ready", "install-failed"],
  ]) {
    f.events.get("update-state")({
      payload: snapshot(phase, "0.5.0-beta.4", { messageCode }),
    });
    assert.equal(update.hidden, false, messageCode);
    assert.equal(update.disabled, false, messageCode);
    assert.equal(f.status().textContent, "Update error");
  }
  f.events.get("connection-changed")({ payload: "offline" });
  assert.match(f.status().textContent, /Offline/);
  assert.equal(update.hidden, false);
  assert.equal(update.disabled, false);
  update.click();
  await f.flush();
  assert.equal(f.calls.at(-1).command, "open_settings");
  assert.equal(f.calls.at(-1).args.section, "updates");
  f.events.get("connection-changed")({ payload: "connected" });
  assert.equal(f.status().textContent, "Update error");
});

test("footer respects the saved beta preference while allowing stable resolved targets for either preference", async () => {
  const f = await fixture();
  for (const [includeBetaUpdates, latestVersion, visible] of [
    [false, "0.6.0-beta.1", false],
    [true, "0.6.0-beta.1", true],
    [false, "0.5.0", true],
    [true, "0.5.0", true],
    [false, "0.5.1+build-beta.7", true],
  ]) {
    f.events.get("services-changed")({
      payload: { ...f.settings, includeBetaUpdates },
    });
    f.events.get("update-state")({
      payload: snapshot("available", latestVersion, { includeBetaUpdates }),
    });
    assert.equal(
      f.update().hidden,
      !visible,
      `${includeBetaUpdates}: ${latestVersion}`,
    );
    if (visible)
      assert.equal(f.update().textContent, `Update to ${latestVersion}`);
    else {
      assert.equal(f.update().textContent, "");
      assert.equal(f.status().textContent, "");
    }
  }
});

test("unread and service refreshes preserve the footer node, update indicator and keyboard focus", async () => {
  const f = await fixture();
  const footer = f.document.querySelector(".app-footer");
  f.events.get("update-state")({ payload: snapshot("available", "0.5.0") });
  const update = f.update();
  update.focus();
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
  assert.equal(f.document.activeElement, update);
  assert.equal(f.update(), update);
  assert.equal(f.status().textContent, status);
  assert.equal(update.disabled, false);
  update.click();
  await f.flush();
  assert.equal(f.calls.at(-1).args.section, "updates");
});

test("footer keeps newer live status when initial native snapshots arrive late", async () => {
  const f = await fixture({ deferred: true });
  f.events.get("update-state")({ payload: snapshot("available", "0.5.0") });
  const update = f.update();
  update.focus();
  f.events.get("connection-changed")({ payload: "offline" });
  f.finishUpdate(snapshot("current"));
  f.finishConnection("connected");
  await f.rendering;
  assert.match(f.status().textContent, /Offline/i);
  assert.equal(f.status().querySelector("button").disabled, true);
  assert.equal(f.update(), update);
  assert.equal(update.hidden, false);
  assert.equal(update.textContent, "Update to 0.5.0");
  assert.equal(f.document.activeElement, update);
  f.events.get("connection-changed")({ payload: "connected" });
  assert.equal(f.status().textContent, "");
  assert.equal(update.hidden, false);
});

test("footer labels change with saved Spanish language without replacing actions", async () => {
  const f = await fixture();
  const about = f.action("about");
  f.events.get("update-state")({
    payload: snapshot("available", "0.5.0-beta.4"),
  });
  const update = f.update();
  f.events.get("services-changed")({
    payload: { ...f.settings, language: "es" },
  });
  assert.equal(f.action("about"), about);
  assert.equal(f.update(), update);
  assert.equal(update.textContent, "Actualizar a 0.5.0-beta.4");
  assert.equal(update.title, "La versión 0.5.0-beta.4 está disponible.");
  assert.equal(about.textContent, "Acerca de");
  assert.equal(f.action("console").title, "Próximamente");
  f.events.get("notification-issue")({});
  assert.ok(f.status().textContent.length > 0);
});

test("service and language changes during shell mounting take precedence over its older settings snapshot", async () => {
  const f = await fixture({ deferredSettings: true });
  const changed = structuredClone(f.settings);
  changed.language = "es";
  changed.includeBetaUpdates = false;
  changed.services[0].name = "New name";
  f.events.get("services-changed")({ payload: changed });
  f.events.get("update-state")({
    payload: snapshot("available", "0.5.0", { includeBetaUpdates: false }),
  });
  f.finishSettings(f.settings);
  await f.rendering;
  assert.match(
    f.document.querySelector(".rail-services button").title,
    /^New name/,
  );
  assert.equal(f.action("about").textContent, "Acerca de");
  assert.equal(f.update().hidden, false);
  f.events.get("update-state")({
    payload: snapshot("available", "0.6.0-beta.1"),
  });
  assert.equal(f.update().hidden, true);
});
