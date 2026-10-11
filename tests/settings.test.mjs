import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";
import {
  servicesDom,
  dispatch,
  setServiceField,
  applyServiceDialog,
  chooseProvider,
} from "./helpers/services-dom.mjs";

const result = await build({
  stdin: {
    contents: 'export { renderSettings } from "./src/settings/settings.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "settingsUi",
  loader: { ".md": "text" },
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
  const dom = servicesDom(window, document);
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
    language: "en",
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
  let updateState = {
    configured: true,
    channel: settings.updateChannel,
    phase: "idle",
    currentVersion: "0.5.0-beta.3",
    latestVersion: null,
    notes: "",
    downloaded: 0,
    total: null,
    message: "",
    messageCode: "",
    lastSuccessfulCheck: null,
    ...options.updateState,
  };
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
    URLSearchParams,
    ...(options.search === undefined
      ? {}
      : { location: { search: options.search } }),
    crypto: globalThis.crypto,
    AbortController,
    ...dom,
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
      if (command === "get_validation_fixture_service_ids")
        return structuredClone(options.fixtureServiceIds ?? []);
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
      if (command === "get_update_state") {
        await options.beforeUpdateReady?.({ document, window, listeners });
        return structuredClone(updateState);
      }
      if (command === "save_settings") {
        await deferred.get(command)?.promise;
        if (failSave) throw "Could not save settings.";
        Object.assign(settings, structuredClone(args.settings));
        updateState = {
          ...updateState,
          channel: settings.updateChannel,
        };
        listeners.get("update-state")?.({
          payload: structuredClone(updateState),
        });
        if (
          !settings.services.some(
            (service) =>
              service.enabled && service.id === settings.activeService,
          )
        )
          settings.activeService =
            settings.services.find((service) => service.enabled)?.id ?? null;
        settings.serverUrl =
          settings.services.find(
            (service) => service.id === settings.activeService,
          )?.url ?? "";
        listeners.get("settings-changed")?.({
          payload: structuredClone(settings),
        });
        if (failRemoveAfterSave)
          throw "Settings saved. Restart to apply service changes.";
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

test("first-run Connect persists a complete first service when the profile already uses schema 1", async () => {
  const f = await fixture({
    settings: {
      serverUrl: "",
      services: [],
      activeService: null,
      serviceSchema: 1,
      updateChannel: "pre-release",
    },
  });
  const server = f.document.getElementById("server");
  server.value = "http://127.0.0.1:17830/beta6/a";
  dispatch(f.window, server, "input");
  submitSettings(f);
  await f.flush();
  const saved = f.calls.find((call) => call.command === "save_settings").args
    .settings;
  assert.equal(saved.serviceSchema, 1);
  assert.equal(saved.activeService, "chatplus");
  assert.equal(saved.serverUrl, "http://127.0.0.1:17830/beta6/a/");
  assert.deepEqual(saved.services, [
    {
      id: "chatplus",
      provider: "synology-chatplus",
      name: "ChatPlus",
      url: "http://127.0.0.1:17830/beta6/a/",
      enabled: true,
      notifications: true,
      notificationColor: "auto",
    },
  ]);
  assert.equal(f.settings.services.length, 1);
  assert.equal(f.settings.activeService, "chatplus");
  assert.equal(server.value, saved.serverUrl);
  assert.equal(saved.updateChannel, "pre-release");
  assert.equal(saved.autostart, false);
  assert.equal(saved.automaticUpdates, false);
  assert.equal(saved.desktopNotifications, false);
  assert.ok(f.document.getElementById("save-feedback").textContent);
});

test("failed first-run Connect retains the URL without adding a persisted service", async () => {
  const f = await fixture({
    settings: {
      serverUrl: "",
      services: [],
      activeService: null,
      serviceSchema: 1,
    },
  });
  const server = f.document.getElementById("server");
  server.value = "http://127.0.0.1:17830/beta6/a/";
  dispatch(f.window, server, "input");
  f.fail();
  submitSettings(f);
  await f.flush();
  assert.equal(f.settings.services.length, 0);
  assert.equal(server.value, "http://127.0.0.1:17830/beta6/a/");
  assert.match(
    f.document.getElementById("status").textContent,
    /Could not save/,
  );
  assert.equal(f.document.getElementById("save").disabled, false);
});

test("six Settings sections keep keyboard navigation and route requests outside the scrolling content", async () => {
  const f = await fixture();
  const tabs = [...f.document.querySelectorAll('[role="tab"]')];
  assert.deepEqual(
    tabs.map((tab) => tab.dataset.tab),
    ["general", "notifications", "updates", "services", "changelog", "about"],
  );
  assert.ok(!f.document.querySelector(".settings-content").contains(tabs[0]));
  const arrow = new f.window.Event("keydown", { cancelable: true });
  arrow.key = "ArrowRight";
  tabs[0].dispatchEvent(arrow);
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(f.document.activeElement, tabs[1]);
  assert.equal(f.document.getElementById("panel-general").hidden, true);
  f.document.getElementById("theme").value = "dark";
  f.listeners.get("settings-section-requested")({ payload: "about" });
  assert.equal(
    f.document.getElementById("tab-about").getAttribute("aria-selected"),
    "true",
  );
  assert.equal(f.document.getElementById("theme").value, "dark");
  assert.equal(f.document.querySelector(".server-section").hidden, true);
});

test("external Updates requests focus the named update summary and preserve unsaved settings", async () => {
  const f = await fixture();
  f.document.getElementById("theme").value = "dark";
  f.listeners.get("settings-section-requested")({ payload: "updates" });
  const summary = f.document.getElementById("update-summary");
  assert.equal(f.document.getElementById("panel-updates").hidden, false);
  assert.equal(f.document.activeElement, summary);
  assert.equal(summary.tabIndex, -1);
  assert.equal(summary.getAttribute("role"), "region");
  assert.equal(summary.getAttribute("aria-labelledby"), "update-heading");
  assert.ok(f.document.getElementById("update-heading").textContent);
  assert.equal(f.scrolled(), "update-summary");
  assert.equal(f.document.getElementById("theme").value, "dark");

  const updatesTab = f.document.getElementById("tab-updates");
  updatesTab.focus();
  const arrow = new f.window.Event("keydown", { cancelable: true });
  arrow.key = "ArrowLeft";
  updatesTab.dispatchEvent(arrow);
  assert.equal(
    f.document.activeElement,
    f.document.getElementById("tab-notifications"),
  );
});

test("the initial Updates route waits for the update summary to finish mounting", async () => {
  let mounting = false;
  const f = await fixture({
    search: "?section=updates",
    beforeUpdateReady: ({ document }) => {
      mounting = true;
      assert.equal(document.getElementById("panel-updates").hidden, false);
      assert.equal(document.activeElement, null);
    },
  });
  assert.equal(mounting, true);
  assert.equal(
    f.document.activeElement,
    f.document.getElementById("update-summary"),
  );
  assert.equal(f.scrolled(), "update-summary");
});

test("an Updates event during mounting also waits for the ready summary", async () => {
  const f = await fixture({
    beforeUpdateReady: ({ document, listeners }) => {
      listeners.get("settings-section-requested")({ payload: "updates" });
      assert.equal(document.getElementById("panel-updates").hidden, false);
      assert.equal(document.activeElement, null);
    },
  });
  assert.equal(
    f.document.activeElement,
    f.document.getElementById("update-summary"),
  );
});

test("pending Updates focus yields to navigation, control interaction, and open dialogs", async () => {
  for (const interaction of [
    "navigate",
    "pointerdown",
    "keydown",
    "focusin",
    "blur",
    "dialog",
  ]) {
    const f = await fixture({
      search: "?section=updates",
      beforeUpdateReady: ({ document, window }) => {
        const preference = document.getElementById("update-channel");
        if (interaction === "navigate") {
          document.getElementById("tab-general").click();
          document.getElementById("server").focus();
        } else if (interaction === "dialog") {
          const dialog = document.createElement("dialog");
          document.body.append(dialog);
          dialog.showModal();
          dialog.focus();
        } else if (interaction === "blur") {
          window.dispatchEvent(new window.Event("blur"));
          preference.focus();
        } else {
          preference.dispatchEvent(
            new window.Event(interaction, { bubbles: true }),
          );
          preference.focus();
        }
      },
    });
    assert.notEqual(
      f.document.activeElement,
      f.document.getElementById("update-summary"),
      interaction,
    );
    assert.equal(f.scrolled(), null, interaction);
  }
});

test("an external Updates request preserves an already open modal's focus", async () => {
  const f = await fixture();
  f.document.getElementById("add-service").click();
  const dialog = f.document.querySelector("dialog[open]");
  assert.ok(dialog);
  const previous = f.document.activeElement;
  assert.ok(dialog.contains(previous));
  f.listeners.get("settings-section-requested")({ payload: "updates" });
  assert.equal(f.document.activeElement, previous);
  assert.equal(f.scrolled(), null);
});

test("ordinary Settings Save preserves authorized fixture notification preferences", async () => {
  const mm = {
    id: "fixture-mm",
    provider: "mattermost",
    name: "Synthetic Mattermost",
    url: "http://127.0.0.1:17830/mm/",
    enabled: true,
    notifications: true,
    notificationColor: "#123456",
  };
  const f = await fixture({
    settings: { services: [mm], activeService: mm.id },
    fixtureServiceIds: [mm.id],
  });
  f.document.getElementById("theme").value = "dark";
  submitSettings(f);
  await f.flush();
  assert.equal(f.settings.services[0].notifications, true);
  openEdit(f, mm.id);
  setServiceField(f, "name", "Renamed fixture");
  setServiceField(f, "notifications", false);
  applyServiceDialog(f);
  submitSettings(f);
  await f.flush();
  assert.equal(f.settings.services[0].name, "Renamed fixture");
  assert.equal(f.settings.services[0].notifications, false);
  f.document.getElementById("theme").value = "light";
  submitSettings(f);
  await f.flush();
  assert.equal(f.settings.services[0].notifications, false);
});

test("Settings fixture metadata never enables production Mattermost or an unauthorized local service", async () => {
  for (const [url, fixtureServiceIds] of [
    ["https://mattermost.example.com/", ["mm"]],
    ["http://127.0.0.1:17830/mm/", []],
  ]) {
    const mm = {
      id: "mm",
      provider: "mattermost",
      name: "Mattermost",
      url,
      enabled: true,
      notifications: true,
    };
    const f = await fixture({
      settings: { services: [mm], activeService: mm.id },
      fixtureServiceIds,
    });
    openEdit(f, mm.id);
    assert.equal(
      f.document.getElementById("service-dialog-notifications").disabled,
      true,
    );
    f.document.querySelector(".service-dialog-footer .secondary").click();
    f.document.getElementById("theme").value = "dark";
    submitSettings(f);
    await f.flush();
    assert.equal(f.settings.services[0].notifications, false);
  }
});

test("fresh native fixture metadata updates an open editor without changing its mute preference", async () => {
  const mm = {
    id: "mm",
    provider: "mattermost",
    name: "Synthetic Mattermost",
    url: "http://127.0.0.1:17830/mm/",
    enabled: true,
    notifications: false,
  };
  const fixtureServiceIds = [];
  const f = await fixture({
    settings: { services: [mm], activeService: mm.id },
    fixtureServiceIds,
  });
  openEdit(f, mm.id);
  const toggle = f.document.getElementById("service-dialog-notifications");
  assert.equal(toggle.disabled, true);
  fixtureServiceIds.push(mm.id);
  f.listeners.get("settings-changed")({ payload: structuredClone(f.settings) });
  await f.flush();
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.checked, false);
  setServiceField(f, "notifications", true);
  applyServiceDialog(f);
  submitSettings(f);
  await f.flush();
  assert.equal(f.settings.services[0].notifications, true);
});

test("Spanish localizes Settings sections and service confirmations and persists language", async () => {
  const f = await fixture({ settings: { language: "es" } });
  assert.equal(f.document.querySelector("h1").textContent, "Configuración");
  assert.equal(
    f.document.getElementById("tab-notifications").textContent,
    "Notificaciones",
  );
  assert.equal(
    f.document.getElementById("tab-changelog").textContent,
    "Historial de cambios",
  );
  assert.equal(f.document.getElementById("tab-about").textContent, "Acerca de");
  assert.equal(f.document.getElementById("language").value, "es");
  assert.equal(
    f.document
      .getElementById("service-chatplus-remove")
      .getAttribute("aria-label"),
    "Eliminar ChatPlus",
  );
  f.document.getElementById("service-chatplus-remove").click();
  await f.flush();
  assert.equal(
    f.document.querySelector("dialog h2").textContent,
    "¿Eliminar el servicio?",
  );
  f.document.querySelector("dialog .secondary:not(.danger)").click();
  await f.flush();
  f.document.getElementById("theme").value = "dark";
  f.document
    .querySelector("form")
    .dispatchEvent(new f.window.Event("submit", { cancelable: true }));
  await f.flush();
  assert.equal(
    f.calls.find((call) => call.command === "save_settings").args.settings
      .language,
    "es",
  );
  assert.match(
    f.document.getElementById("save-feedback").textContent,
    /Configuración guardada/,
  );
});

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
  assert.equal("includeBetaUpdates" in saved, false);
  assert.equal(saved.services[0].id, "chatplus");
  assert.equal(saved.services[0].notificationColor, "auto");
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

test("Save restores focus to Close after success and Save after failure", async () => {
  for (const failure of [false, true]) {
    const f = await fixture();
    const save = f.document.getElementById("save");
    let restored = false;
    const focusSave = save.focus.bind(save);
    save.focus = () => {
      focusSave();
      restored = true;
    };
    save.focus();
    restored = false;
    if (failure) f.fail();
    f.document.getElementById("theme").value = "dark";
    f.document
      .querySelector("form")
      .dispatchEvent(new f.window.Event("submit", { cancelable: true }));
    f.document.body.focus();
    await f.flush();
    assert.equal(restored, failure);
    assert.equal(
      f.document.activeElement.id,
      failure ? "save" : "close-settings",
    );
    assert.equal(save.disabled, !failure);
  }
});

function submitSettings(f) {
  dispatch(f.window, f.document.getElementById("settings"), "submit");
}
function openEdit(f, id = "chatplus") {
  f.document.getElementById(`service-${id}-edit`).click();
}
function twoServices(provider = "discord") {
  return ["first", "second"].map((id) => ({
    id,
    provider,
    name: id,
    url:
      provider === "discord"
        ? "https://discord.com/app/"
        : `https://example.com/${id}/`,
    enabled: true,
    notifications: true,
    notificationColor: id === "first" ? "blue" : "amber",
  }));
}

test("service menu destinations reuse Settings and open the selected modal field", async () => {
  for (const field of ["name", "notifications", "settings"]) {
    const f = await fixture({ target: { id: "chatplus", field } });
    assert.equal(
      f.document
        .querySelector('[data-tab="services"]')
        .getAttribute("aria-selected"),
      "true",
    );
    assert.equal(f.scrolled(), "service-chatplus-settings");
    assert.equal(
      f.document.activeElement.id,
      field === "notifications"
        ? "service-dialog-notifications"
        : "service-dialog-name",
    );
    assert.ok(f.document.querySelector("dialog[open]"));
    assert.equal(
      f.calls.filter((call) => call.command === "save_settings").length,
      0,
    );
  }
});

test("Settings retargeting preserves the active dialog and reports missing targets", async () => {
  const f = await fixture();
  openEdit(f);
  setServiceField(f, "name", "Unsaved name");
  f.target({ id: "chatplus", field: "name" });
  f.listeners.get("service-settings-requested")();
  await f.flush();
  assert.equal(
    f.document.getElementById("service-dialog-name").value,
    "Unsaved name",
  );
  f.target({ id: "removed", field: "name" });
  f.listeners.get("service-settings-requested")();
  await f.flush();
  assert.match(
    f.document.getElementById("status").textContent,
    /not available in your current draft/,
  );
});

test("context-menu mute updates clean services while explicit draft notification edits survive", async () => {
  for (const edited of [false, true]) {
    const f = await fixture();
    if (edited) {
      openEdit(f);
      setServiceField(f, "notifications", false);
      applyServiceDialog(f);
    }
    const changed = structuredClone(f.settings);
    changed.services[0].notifications = false;
    f.listeners.get("settings-changed")({ payload: changed });
    const unmuted = structuredClone(changed);
    unmuted.services[0].notifications = true;
    f.listeners.get("settings-changed")({ payload: unmuted });
    openEdit(f);
    assert.equal(
      f.document.getElementById("service-dialog-notifications").checked,
      !edited,
    );
    f.document.querySelector(".service-dialog-footer .secondary").click();
    // A retained explicit edit conflicts with a newer external unmute; Save is blocked.
    if (edited) assert.equal(f.document.getElementById("save").disabled, true);
    else
      assert.equal(
        f.document
          .getElementById("draft-status")
          .classList.contains("has-unsaved"),
        false,
      );
  }
});

test("modal Apply changes only the Settings draft; Save persists stable service identity", async () => {
  const f = await fixture({
    settings: { services: twoServices(), activeService: "first" },
  });
  openEdit(f, "first");
  setServiceField(f, "name", "Personal Discord");
  applyServiceDialog(f);
  assert.equal(f.settings.services[0].name, "first");
  assert.equal(
    f.calls.filter((call) => call.command === "save_settings").length,
    0,
  );
  submitSettings(f);
  await f.flush();
  assert.equal(f.settings.services[0].id, "first");
  assert.equal(f.settings.services[0].provider, "discord");
  assert.equal(f.settings.services[0].name, "Personal Discord");
  assert.equal(f.settings.services[1].id, "second");
  assert.equal(f.settings.services[1].name, "second");
});

test("Services Remove confirms and edits only the draft until Settings Save", async () => {
  const f = await fixture();
  const remove = f.document.getElementById("service-chatplus-remove");
  remove.focus();
  remove.click();
  f.document.querySelector("dialog .secondary:not(.danger)").click();
  await f.flush();
  assert.ok(f.document.getElementById("service-chatplus-settings"));
  assert.equal(f.document.activeElement, remove);
  remove.click();
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  assert.equal(f.document.getElementById("service-chatplus-settings"), null);
  assert.equal(
    f.settings.services.length,
    1,
    "persisted settings still contain the service",
  );
  assert.equal(
    f.calls.filter(
      (call) =>
        call.command === "remove_service" || call.command === "save_settings",
    ).length,
    0,
  );
  submitSettings(f);
  await f.flush();
  assert.equal(f.settings.services.length, 0);
  assert.equal(f.settings.activeService, null);
});

test("menu Remove uses draft confirmation and cancellation leaves persisted settings untouched", async () => {
  const f = await fixture();
  f.target({ id: "chatplus", field: "remove" });
  f.listeners.get("service-settings-requested")();
  await f.flush();
  assert.match(f.document.querySelector("dialog").textContent, /ChatPlus/);
  f.document.querySelector("dialog .secondary:not(.danger)").click();
  await f.flush();
  assert.ok(f.document.getElementById("service-chatplus-settings"));
  assert.equal(f.settings.services.length, 1);
  assert.equal(
    f.calls.filter(
      (call) =>
        call.command === "remove_service" || call.command === "save_settings",
    ).length,
    0,
  );
});

test("Add Apply and Remove remain local until Save and do not use immediate-removal IPC", async () => {
  const f = await fixture();
  f.document.getElementById("add-service").click();
  chooseProvider(f, "discord");
  setServiceField(f, "name", "Temporary Discord");
  applyServiceDialog(f);
  const rows = [...f.document.querySelectorAll(".service-card")];
  assert.equal(rows.length, 2);
  rows[1].querySelector('[data-action="remove"]').click();
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  assert.equal(f.document.querySelectorAll(".service-card").length, 1);
  assert.equal(
    f.calls.filter(
      (call) =>
        call.command === "remove_service" || call.command === "save_settings",
    ).length,
    0,
  );
  assert.equal(
    f.document.getElementById("draft-status").classList.contains("has-unsaved"),
    false,
  );
});

test("Remove preserves another same-provider instance's unsaved edits", async () => {
  const f = await fixture({
    settings: { services: twoServices(), activeService: "first" },
  });
  openEdit(f, "first");
  setServiceField(f, "name", "Unsaved Personal");
  applyServiceDialog(f);
  f.document.getElementById("service-second-remove").click();
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  assert.equal(
    f.document.querySelector(".service-card-name").textContent,
    "Unsaved Personal",
  );
  assert.equal(f.settings.services[0].name, "first");
  assert.equal(f.settings.services.length, 2);
  submitSettings(f);
  await f.flush();
  assert.equal(f.settings.services.length, 1);
  assert.equal(f.settings.services[0].id, "first");
  assert.equal(f.settings.services[0].name, "Unsaved Personal");
});

test("Settings Save cannot overlap an editor or removal confirmation", async () => {
  const f = await fixture({
    settings: { services: twoServices(), activeService: "first" },
  });
  f.document.getElementById("theme").value = "dark";
  openEdit(f, "first");
  submitSettings(f);
  await f.flush();
  assert.equal(
    f.calls.filter((call) => call.command === "save_settings").length,
    0,
  );
  f.document.querySelector(".service-dialog-footer .secondary").click();
  f.document.getElementById("service-second-remove").click();
  submitSettings(f);
  await f.flush();
  assert.equal(
    f.calls.filter((call) => call.command === "save_settings").length,
    0,
  );
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  submitSettings(f);
  await f.flush();
  assert.equal(f.settings.services.length, 1);
  assert.equal(f.settings.theme, "dark");
});

test("pending Save locks preferences and card actions and restores disabled controls", async () => {
  const f = await fixture();
  const finishSave = f.defer("save_settings");
  f.document.getElementById("language").value = "es";
  f.document.getElementById("unread-tray").disabled = true;
  submitSettings(f);
  await f.flush();
  for (const id of [
    "language",
    "theme",
    "service-chatplus-edit",
    "service-chatplus-remove",
    "add-service",
  ])
    assert.equal(f.document.getElementById(id).disabled, true);
  finishSave();
  await f.flush();
  assert.equal(f.document.getElementById("language").disabled, false);
  assert.equal(
    f.document.getElementById("service-chatplus-edit").disabled,
    false,
  );
  assert.equal(f.document.getElementById("unread-tray").disabled, true);
  assert.equal(f.settings.language, "es");
});

test("pending Save blocks repeated submission and menu removal", async () => {
  const f = await fixture();
  const finishSave = f.defer("save_settings");
  f.document.getElementById("theme").value = "dark";
  submitSettings(f);
  await f.flush();
  submitSettings(f);
  f.target({ id: "chatplus", field: "remove" });
  f.listeners.get("service-settings-requested")();
  await f.flush();
  assert.equal(f.document.querySelector("dialog"), null);
  assert.equal(
    f.calls.filter((call) => call.command === "save_settings").length,
    1,
  );
  finishSave();
  await f.flush();
  assert.equal(
    f.document.getElementById("service-chatplus-remove").disabled,
    false,
  );
});

test("saved ordering, colors and duplicate provider IDs reload from one service array", async () => {
  const f = await fixture({
    settings: { services: twoServices(), activeService: "first" },
  });
  f.document
    .getElementById("service-second-settings")
    .querySelector('[data-action="up"]')
    .click();
  submitSettings(f);
  await f.flush();
  const serialized = JSON.parse(JSON.stringify(f.settings));
  assert.deepEqual(
    serialized.services.map((service) => [
      service.id,
      service.notificationColor,
    ]),
    [
      ["second", "amber"],
      ["first", "blue"],
    ],
  );
  const reopened = await fixture({ settings: serialized });
  assert.deepEqual(
    [...reopened.document.querySelectorAll(".service-card")].map(
      (card) => card.dataset.serviceId,
    ),
    ["second", "first"],
  );
  assert.equal(
    reopened.document
      .getElementById("draft-status")
      .classList.contains("has-unsaved"),
    false,
  );
});

test("custom RGB colors persist through Settings Save and reopen independently for duplicate providers", async () => {
  const f = await fixture({
    settings: { services: twoServices(), activeService: "first" },
  });
  openEdit(f, "first");
  setServiceField(f, "color-hex", "#aB12Ef");
  applyServiceDialog(f);
  submitSettings(f);
  await f.flush();
  assert.equal(f.settings.services[0].notificationColor, "#ab12ef");
  assert.equal(f.settings.services[1].notificationColor, "amber");
  const reopened = await fixture({
    settings: JSON.parse(JSON.stringify(f.settings)),
  });
  openEdit(reopened, "first");
  assert.equal(
    reopened.document.getElementById("service-dialog-color-hex").value,
    "#ab12ef",
  );
  assert.equal(
    reopened.document.getElementById("service-dialog-color-r").value,
    "171",
  );
  assert.equal(
    reopened.document.getElementById("service-dialog-color-g").value,
    "18",
  );
  assert.equal(
    reopened.document.getElementById("service-dialog-color-b").value,
    "239",
  );
});

test("external rail ordering merges into dirty name and RGB fields when Settings order is untouched", async () => {
  const f = await fixture({
    settings: { services: twoServices(), activeService: "first" },
  });
  openEdit(f, "first");
  setServiceField(f, "name", "Personal Discord");
  setServiceField(f, "color-hex", "#abcdef");
  applyServiceDialog(f);
  const external = structuredClone(f.settings);
  external.services.reverse();
  f.listeners.get("settings-changed")({ payload: external });
  assert.deepEqual(
    [...f.document.querySelectorAll(".service-card")].map(
      (card) => card.dataset.serviceId,
    ),
    ["second", "first"],
  );
  assert.equal(
    f.document
      .getElementById("service-first-settings")
      .querySelector(".service-card-name").textContent,
    "Personal Discord",
  );
  submitSettings(f);
  await f.flush();
  const saved = f.calls.find((call) => call.command === "save_settings").args
    .settings;
  assert.deepEqual(
    saved.services.map((service) => service.id),
    ["second", "first"],
  );
  assert.equal(saved.services[1].name, "Personal Discord");
  assert.equal(saved.services[1].notificationColor, "#abcdef");
  assert.equal(saved.services[0].notificationColor, "amber");
});

test("external rail ordering preserves an explicit Settings reorder and dirty RGB value", async () => {
  const services = twoServices();
  services.push({
    ...services[0],
    id: "third",
    name: "third",
    notificationColor: "#123456",
  });
  const f = await fixture({ settings: { services, activeService: "first" } });
  openEdit(f, "first");
  setServiceField(f, "color-hex", "#987654");
  applyServiceDialog(f);
  f.document
    .getElementById("service-third-settings")
    .querySelector('[data-action="up"]')
    .click();
  const external = structuredClone(f.settings);
  external.services.reverse();
  f.listeners.get("settings-changed")({ payload: external });
  assert.deepEqual(
    [...f.document.querySelectorAll(".service-card")].map(
      (card) => card.dataset.serviceId,
    ),
    ["first", "third", "second"],
  );
  submitSettings(f);
  await f.flush();
  const saved = f.calls.find((call) => call.command === "save_settings").args
    .settings;
  assert.deepEqual(
    saved.services.map((service) => service.id),
    ["first", "third", "second"],
  );
  assert.equal(saved.services[0].notificationColor, "#987654");
  assert.equal(saved.services[1].notificationColor, "#123456");
});

test("failed save keeps the applied Services draft and valid persisted settings available", async () => {
  const f = await fixture();
  const before = JSON.stringify(f.settings);
  openEdit(f);
  setServiceField(f, "name", "Recoverable draft");
  f.document.querySelector('.service-color-swatch[aria-label="Green"]').click();
  applyServiceDialog(f);
  f.fail();
  submitSettings(f);
  await f.flush();
  assert.equal(JSON.stringify(f.settings), before);
  assert.equal(
    f.document.querySelector(".service-card-name").textContent,
    "Recoverable draft",
  );
  assert.match(
    f.document.getElementById("status").textContent,
    /Could not save/,
  );
  assert.equal(f.document.getElementById("save").disabled, false);
  assert.equal(
    f.document.getElementById("draft-status").classList.contains("has-unsaved"),
    true,
  );
});

test("Close discards applied removal, ordering and colors without writing", async () => {
  const f = await fixture({
    settings: { services: twoServices(), activeService: "first" },
  });
  const before = JSON.stringify(f.settings);
  openEdit(f, "second");
  f.document.querySelector('.service-color-swatch[aria-label="Red"]').click();
  applyServiceDialog(f);
  f.document
    .getElementById("service-second-settings")
    .querySelector('[data-action="up"]')
    .click();
  f.document.getElementById("service-first-remove").click();
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  f.document.getElementById("close-settings").click();
  await f.flush();
  assert.equal(JSON.stringify(f.settings), before);
  assert.equal(
    f.calls.filter((call) => call.command === "save_settings").length,
    0,
  );
  assert.equal(f.calls.at(-1).command, "close_settings");
});

test("a native reconciliation failure after Save retains the committed removal", async () => {
  const f = await fixture();
  f.failRemovalAfterSave();
  f.document.getElementById("service-chatplus-remove").click();
  f.document.querySelector("dialog .danger").click();
  await f.flush();
  submitSettings(f);
  await f.flush();
  assert.equal(f.settings.services.length, 0);
  assert.equal(f.document.getElementById("service-chatplus-settings"), null);
  assert.match(
    f.document.getElementById("status").textContent,
    /Restart to apply service changes/,
  );
});
