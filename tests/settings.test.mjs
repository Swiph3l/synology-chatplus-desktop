import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";

const result = await build({
  entryPoints: ["src/settings/settings.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "settingsUi",
  plugins: [
    {
      name: "desktop-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\/api\// }, ({ path }) => ({
          path,
          namespace: "desktop-fixture",
        }));
        builder.onLoad(
          { filter: /.*/, namespace: "desktop-fixture" },
          ({ path }) => ({
            contents: path.endsWith("core")
              ? "export const invoke = (...args) => globalThis.nativeInvoke(...args)"
              : "export const listen = (...args) => globalThis.nativeListen(...args)",
            loader: "js",
          }),
        );
        builder.onLoad({ filter: /[\\/]theme[\\/]theme\.ts$/ }, () => ({
          contents:
            "export const applyTheme = () => {}; export const bindShellTheme = async () => {}",
          loader: "js",
        }));
      },
    },
  ],
});

async function fixture() {
  const { window, document } = parseHTML(
    '<html><body><main id="app"></main></body></html>',
  );
  // LinkeDOM implements select reading but not browser value assignment.
  Object.defineProperty(window.HTMLSelectElement.prototype, "value", {
    configurable: true,
    get() {
      return (
        this.querySelector("option[selected]")?.getAttribute("value") ??
        this.firstElementChild?.getAttribute("value") ??
        ""
      );
    },
    set(value) {
      for (const option of this.querySelectorAll("option"))
        option.toggleAttribute(
          "selected",
          option.getAttribute("value") === value,
        );
    },
  });
  const settings = {
    serverUrl: "https://example.com/chat/",
    serviceSchema: 1,
    activeService: "chatplus",
    services: [
      {
        id: "chatplus",
        provider: "synology-chatplus",
        name: "ChatPlus",
        url: "https://example.com/chat/",
        enabled: true,
        notifications: true,
      },
    ],
    theme: "system",
    autostart: false,
    minimizeToTray: true,
    closeToTray: true,
    externalLinks: true,
    automaticUpdates: false,
    updateChannel: "stable",
    desktopNotifications: false,
    notificationPreview: "sender",
    notificationCooldown: 60,
    notificationSound: true,
    unreadTitle: true,
    unreadTray: true,
  };
  const calls = [],
    listeners = new Map();
  let failSave = false;
  const context = {
    window,
    document,
    navigator: { userAgent: "Windows" },
    structuredClone,
    URL,
    crypto: globalThis.crypto,
    setTimeout: () => 1,
    clearTimeout() {},
    nativeListen: async (event, callback) => {
      listeners.set(event, callback);
      return () => {};
    },
    nativeInvoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "get_settings") return structuredClone(settings);
      if (command === "get_status") return null;
      if (command === "get_notification_permission")
        return {
          state: "enabled",
          granted: true,
          webviewState: "granted",
          message: "Fixture",
        };
      if (command === "get_update_state") return { configured: true };
      if (command === "save_settings") {
        if (failSave) throw "Could not save settings.";
        listeners.get("settings-changed")?.({ payload: args.settings });
      }
    },
  };
  runInNewContext(result.outputFiles[0].text, context);
  await context.settingsUi.renderSettings();
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    window,
    document,
    calls,
    flush,
    fail: () => {
      failSave = true;
    },
  };
}

test("Save persists edited preferences, confirms inline, and Close is separate", async () => {
  const f = await fixture();
  f.document.getElementById("theme").value = "dark";
  f.document.getElementById("update-channel").value = "pre-release";
  f.document
    .querySelector("form")
    .dispatchEvent(new f.window.Event("submit", { cancelable: true }));
  await f.flush();
  const saved = f.calls.find((call) => call.command === "save_settings").args
    .settings;
  assert.equal(saved.theme, "dark");
  assert.equal(saved.updateChannel, "pre-release");
  assert.equal(saved.services[0].id, "chatplus");
  assert.match(
    f.document.getElementById("save-feedback").textContent,
    /Settings saved/,
  );
  assert.ok(f.document.querySelector("form"));
  assert.equal(
    f.calls.filter((call) =>
      /close|notification.*send|send_test/.test(call.command),
    ).length,
    0,
  );
  f.document
    .getElementById("close-settings")
    .dispatchEvent(new f.window.Event("click"));
  await f.flush();
  assert.equal(f.calls.at(-1).command, "close_settings");
});

test("failed Save keeps edits visible and does not announce success", async () => {
  const f = await fixture();
  f.fail();
  f.document.getElementById("theme").value = "dark";
  f.document
    .querySelector("form")
    .dispatchEvent(new f.window.Event("submit", { cancelable: true }));
  await f.flush();
  assert.match(
    f.document.getElementById("status").textContent,
    /Could not save/,
  );
  assert.equal(f.document.getElementById("save-feedback").textContent, "");
  assert.equal(f.document.getElementById("theme").value, "dark");
  assert.equal(f.document.getElementById("save").disabled, false);
});

test("Save restores its keyboard focus after success and failure", async () => {
  for (const failure of [false, true]) {
    const f = await fixture();
    const save = f.document.getElementById("save");
    let focused = save;
    Object.defineProperty(f.document, "activeElement", { get: () => focused });
    let restored = false;
    save.focus = () => {
      focused = save;
      restored = true;
    };
    if (failure) f.fail();
    f.document
      .querySelector("form")
      .dispatchEvent(new f.window.Event("submit", { cancelable: true }));
    focused = f.document.body;
    await f.flush();
    assert.equal(restored, true);
    assert.equal(f.document.activeElement, save);
    assert.equal(save.disabled, false);
  }
});
