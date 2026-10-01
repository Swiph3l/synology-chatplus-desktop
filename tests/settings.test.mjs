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

async function fixture(options = {}) {
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
    ...options.settings,
  };
  let settingsTarget = options.target ?? null;
  let focused = null,
    scrolled = null,
    selected = null;
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    get: () => focused,
  });
  document.hasFocus = () => true;
  window.HTMLElement.prototype.focus = function () {
    focused = this;
  };
  window.HTMLElement.prototype.scrollIntoView = function () {
    scrolled = this.id;
  };
  window.HTMLInputElement.prototype.select = function () {
    selected = this.id;
  };
  const create = document.createElement.bind(document);
  document.createElement = (tag) => {
    const element = create(tag);
    if (tag === "dialog") {
      element.showModal = () => element.setAttribute("open", "");
      element.close = () => element.removeAttribute("open");
    }
    return element;
  };
  const calls = [],
    listeners = new Map();
  const deferred = new Map();
  let failSave = false;
  let failRemove = false;
  let failRemoveAfterSave = false;
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
      // Native IPC captures a request before asynchronous work starts.
      args = structuredClone(args);
      calls.push({ command, args });
      if (command === "get_settings") return structuredClone(settings);
      if (command === "get_status") return null;
      if (command === "take_service_settings_target") {
        const target = settingsTarget;
        settingsTarget = null;
        return target;
      }
      if (command === "get_notification_permission")
        return {
          state: "enabled",
          granted: true,
          webviewState: "granted",
          message: "Fixture",
        };
      if (command === "get_update_state") return { configured: true };
      if (command === "save_settings") {
        await deferred.get(command)?.promise;
        if (failSave) throw "Could not save settings.";
        listeners.get("settings-changed")?.({ payload: args.settings });
      }
      if (command === "remove_service") {
        await deferred.get(command)?.promise;
        if (failRemove) throw "Could not remove service.";
        settings.services = settings.services.filter(
          (service) => service.id !== args.id,
        );
        settings.activeService = settings.services[0]?.id ?? null;
        settings.serverUrl = settings.services[0]?.url ?? "";
        listeners.get("settings-changed")?.({
          payload: structuredClone(settings),
        });
        if (failRemoveAfterSave)
          throw "Settings saved. Restart to apply service changes.";
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
    settings,
    listeners,
    defer: (command) => {
      let resolve;
      const promise = new Promise((done) => {
        resolve = done;
      });
      deferred.set(command, { promise });
      return () => {
        deferred.delete(command);
        resolve();
      };
    },
    scrolled: () => scrolled,
    selected: () => selected,
    target: (value) => {
      settingsTarget = value;
    },
    fail: () => {
      failSave = true;
    },
    failRemoval: () => {
      failRemove = true;
    },
    failRemovalAfterSave: () => {
      failRemoveAfterSave = true;
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

test("service menu destinations reuse existing Settings, scroll and focus the correct field", async () => {
  const second = {
    id: "second",
    provider: "synology-chatplus",
    name: "Second service",
    url: "https://example.com/chat/",
    enabled: true,
    notifications: true,
  };
  for (const field of ["name", "notifications", "settings"]) {
    const f = await fixture({
      settings: { services: [second] },
      target: { id: "second", field },
    });
    assert.equal(
      f.document
        .querySelector('[data-tab="services"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(f.scrolled(), "service-second-settings");
    assert.equal(f.document.activeElement.id, `service-second-${field}`);
    if (field === "name") assert.equal(f.selected(), "service-second-name");
    assert.equal(
      f.calls.filter((call) => call.command === "save_settings").length,
      0,
    );
  }
});

test("existing Settings retargets without losing edits and reports unavailable draft targets", async () => {
  const f = await fixture();
  f.document.getElementById("service-chatplus-name").value =
    "Unsaved display name";
  f.target({ id: "chatplus", field: "name" });
  f.listeners.get("service-settings-requested")();
  await f.flush();
  assert.equal(f.document.activeElement.id, "service-chatplus-name");
  assert.equal(
    f.document.getElementById("service-chatplus-name").value,
    "Unsaved display name",
  );
  f.target({ id: "removed", field: "name" });
  f.listeners.get("service-settings-requested")();
  await f.flush();
  assert.match(
    f.document.getElementById("status").textContent,
    /not available in your current draft/,
  );
});

test("context-menu mute syncs clean drafts while preserving explicit unsaved notification edits", async () => {
  for (const edited of [false, true]) {
    const f = await fixture();
    const checkbox = f.document.getElementById(
      "service-chatplus-notifications",
    );
    if (edited) {
      checkbox.checked = false;
      checkbox.dispatchEvent(new f.window.Event("change", { bubbles: true }));
    }
    const changed = structuredClone(f.settings);
    changed.services[0].notifications = false;
    f.listeners.get("settings-changed")({ payload: changed });
    assert.equal(checkbox.checked, false);
    const unmuted = structuredClone(changed);
    unmuted.services[0].notifications = true;
    f.listeners.get("settings-changed")({ payload: unmuted });
    assert.equal(
      checkbox.checked,
      !edited,
      "a later unmute must not overwrite an explicit draft edit",
    );
    f.document
      .querySelector("form")
      .dispatchEvent(new f.window.Event("submit", { cancelable: true }));
    await f.flush();
    const saved = f.calls.findLast((call) => call.command === "save_settings")
      .args.settings;
    assert.equal(saved.services[0].notifications, !edited);
  }
});

test("renaming through existing form saves stable ID and new name for immediate rail broadcast", async () => {
  const f = await fixture({ target: { id: "chatplus", field: "name" } });
  const name = f.document.getElementById("service-chatplus-name");
  name.value = "Renamed desktop service";
  name.dispatchEvent(new f.window.Event("input"));
  f.document
    .querySelector("form")
    .dispatchEvent(new f.window.Event("submit", { cancelable: true }));
  await f.flush();
  const saved = f.calls.findLast((call) => call.command === "save_settings")
    .args.settings;
  assert.equal(saved.services[0].id, "chatplus");
  assert.equal(saved.services[0].name, "Renamed desktop service");
});

test("Services removal confirms and persists immediately without a separate Save", async () => {
  const f = await fixture();
  const remove = f.document.getElementById("service-chatplus-remove");
  remove.focus();
  remove.click();
  await f.flush();
  assert.ok(f.document.querySelector("dialog[open]"));
  f.document.querySelector("dialog .secondary:not(.danger)").click();
  await f.flush();
  assert.equal(
    f.calls.filter((call) => call.command === "remove_service").length,
    0,
  );
  assert.ok(f.document.getElementById("service-chatplus-settings"));
  assert.equal(f.document.activeElement, remove);
  remove.click();
  await f.flush();
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  const call = f.calls.find((call) => call.command === "remove_service");
  assert.equal(call.args.id, "chatplus");
  assert.equal(call.args.confirmed, true);
  assert.equal(f.document.getElementById("service-chatplus-settings"), null);
  assert.equal(
    f.calls.filter((call) => call.command === "save_settings").length,
    0,
  );
  assert.equal(f.document.activeElement.id, "add-service");
});

test("context-menu Remove uses the same confirmation and failed removal keeps the service", async () => {
  const f = await fixture({ target: { id: "chatplus", field: "remove" } });
  f.failRemoval();
  assert.ok(f.document.querySelector("dialog[open]"));
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  assert.ok(f.document.getElementById("service-chatplus-settings"));
  assert.equal(
    f.document.getElementById("service-chatplus-remove").disabled,
    false,
  );
  assert.match(
    f.document.getElementById("status").textContent,
    /Could not remove/,
  );
});

test("removing an unsaved added service does not call the persisted-service API", async () => {
  const f = await fixture();
  f.document.getElementById("add-service").click();
  const rows = [...f.document.querySelectorAll(".service-config")];
  rows[1].querySelector(".service-removal button").click();
  await f.flush();
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  assert.equal(f.document.querySelectorAll(".service-config").length, 1);
  assert.equal(
    f.calls.filter((call) => call.command === "remove_service").length,
    0,
  );
});

test("immediate removal leaves other unsaved service edits in the form without saving them", async () => {
  const services = ["first", "second"].map((id) => ({
    id,
    provider: "synology-chatplus",
    name: id,
    url: "https://example.com/chat/",
    enabled: true,
    notifications: true,
  }));
  const f = await fixture({ settings: { services, activeService: "first" } });
  const name = f.document.getElementById("service-first-name");
  name.value = "Unsaved name";
  name.dispatchEvent(new f.window.Event("input"));
  f.document.getElementById("service-second-remove").click();
  await f.flush();
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  assert.equal(
    f.document.getElementById("service-first-name").value,
    "Unsaved name",
  );
  assert.equal(f.settings.services[0].name, "first");
  assert.equal(
    f.calls.filter((call) => call.command === "save_settings").length,
    0,
  );
});

test("Save cannot overlap a confirmation or pending removal and later saves the remaining draft", async () => {
  const services = ["first", "second"].map((id) => ({
    id,
    provider: "synology-chatplus",
    name: id,
    url: "https://example.com/chat/",
    enabled: true,
    notifications: true,
  }));
  const f = await fixture({ settings: { services, activeService: "first" } });
  const finishRemoval = f.defer("remove_service");
  const name = f.document.getElementById("service-first-name");
  name.value = "Unsaved name";
  name.dispatchEvent(new f.window.Event("input"));
  const submit = () =>
    f.document
      .querySelector("form")
      .dispatchEvent(new f.window.Event("submit", { cancelable: true }));
  f.document.getElementById("service-second-remove").click();
  await f.flush();
  assert.ok(f.document.querySelector("dialog[open]"));
  assert.equal(f.document.getElementById("save").disabled, true);
  submit();
  await f.flush();
  assert.equal(
    f.calls.filter((call) => call.command === "save_settings").length,
    0,
  );
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  assert.equal(f.document.getElementById("save").disabled, true);
  assert.equal(f.document.getElementById("add-service").disabled, true);
  assert.equal(
    f.document.getElementById("service-first-remove").disabled,
    true,
  );
  submit();
  await f.flush();
  assert.equal(
    f.calls.filter((call) => call.command === "save_settings").length,
    0,
  );
  finishRemoval();
  await f.flush();
  assert.equal(f.document.getElementById("service-second-settings"), null);
  assert.equal(f.document.getElementById("save").disabled, false);
  assert.equal(f.document.getElementById("add-service").disabled, false);
  submit();
  await f.flush();
  const saved = f.calls.find((call) => call.command === "save_settings").args
    .settings;
  assert.equal(saved.services.length, 1);
  assert.equal(saved.services[0].id, "first");
  assert.equal(saved.services[0].name, "Unsaved name");
});

test("pending Save blocks repeated submission and both form and menu removal", async () => {
  const f = await fixture();
  const finishSave = f.defer("save_settings");
  const submit = () =>
    f.document
      .querySelector("form")
      .dispatchEvent(new f.window.Event("submit", { cancelable: true }));
  submit();
  await f.flush();
  assert.equal(
    f.document.getElementById("service-chatplus-remove").disabled,
    true,
  );
  submit();
  f.document.getElementById("service-chatplus-remove").click();
  f.target({ id: "chatplus", field: "remove" });
  f.listeners.get("service-settings-requested")();
  await f.flush();
  assert.equal(f.document.querySelector("dialog"), null);
  assert.equal(
    f.calls.filter((call) => call.command === "save_settings").length,
    1,
  );
  assert.equal(
    f.calls.filter((call) => call.command === "remove_service").length,
    0,
  );
  finishSave();
  await f.flush();
  assert.equal(
    f.document.getElementById("service-chatplus-remove").disabled,
    false,
  );
  f.document.getElementById("service-chatplus-remove").click();
  await f.flush();
  assert.ok(f.document.querySelector("dialog[open]"));
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  assert.equal(f.document.getElementById("service-chatplus-settings"), null);
});

test("removal preserves unsaved General preferences and the fallback service URL", async () => {
  const services = ["first", "second"].map((id) => ({
    id,
    provider: "synology-chatplus",
    name: id,
    url: `https://example.com/${id}/`,
    enabled: true,
    notifications: true,
  }));
  for (const field of ["remove", "settings"]) {
    const f = await fixture({ settings: { services, activeService: "first" } });
    f.document.getElementById("theme").value = "dark";
    f.document.getElementById("autostart").checked = true;
    f.document.getElementById("minimize").checked = false;
    f.document.getElementById("update-channel").value = "pre-release";
    const url = f.document.getElementById("service-second-url");
    url.value = "https://example.com/unsaved/";
    url.dispatchEvent(new f.window.Event("input"));
    if (field === "remove") {
      f.target({ id: "first", field });
      f.listeners.get("service-settings-requested")();
      await f.flush();
    } else f.document.getElementById("service-first-remove").click();
    await f.flush();
    f.document.querySelector("dialog .danger").click();
    await f.flush();
    assert.equal(f.document.getElementById("theme").value, "dark");
    assert.equal(f.document.getElementById("autostart").checked, true);
    assert.equal(f.document.getElementById("minimize").checked, false);
    assert.equal(
      f.document.getElementById("update-channel").value,
      "pre-release",
    );
    assert.equal(
      f.document.getElementById("service-second-url").value,
      "https://example.com/unsaved/",
    );
    assert.equal(
      f.document.getElementById("server").value,
      "https://example.com/unsaved/",
    );
    assert.equal(f.settings.theme, "system");
    assert.equal(f.settings.autostart, false);
    assert.equal(f.settings.services[0].url, "https://example.com/second/");
    assert.equal(
      f.calls.filter((call) => call.command === "save_settings").length,
      0,
    );
  }
});

test("a native view-close failure after persistence cannot resurrect the removed service", async () => {
  const f = await fixture();
  f.failRemovalAfterSave();
  f.document.getElementById("service-chatplus-remove").click();
  await f.flush();
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  assert.equal(f.document.getElementById("service-chatplus-settings"), null);
  assert.match(
    f.document.getElementById("status").textContent,
    /Restart to apply service changes/,
  );
});
