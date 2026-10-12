import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";

const bundle = await build({
  stdin: {
    contents:
      'export * from "./src/ui/update.ts"; export * from "./src/app/updates.ts"; export { setLanguage } from "./src/i18n/index.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "updateUi",
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
          contents: "export const bindShellTheme = async () => {}",
          loader: "js",
        }));
      },
    },
  ],
});

function snapshot(changes = {}) {
  return {
    configured: true,
    includeBetaUpdates: false,
    phase: "idle",
    currentVersion: "0.5.0-beta.3",
    latestVersion: null,
    notes: "",
    downloaded: 0,
    total: null,
    message: "",
    messageCode: "",
    lastSuccessfulCheck: null,
    ...changes,
  };
}

function fixture(options = {}) {
  const { window, document } = parseHTML(
    '<html><body><main id="app"><div id="panel"></div></main></body></html>',
  );
  let focused = null;
  Object.defineProperty(document, "activeElement", { get: () => focused });
  document.hasFocus = () => true;
  window.HTMLElement.prototype.focus = function () {
    focused = this;
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
  let state = snapshot(options.state);
  const emit = (next) => {
    state = snapshot(next);
    listeners.get("update-state")?.({ payload: state });
  };
  const context = {
    document,
    window,
    Date,
    console,
    nativeInvoke: async (command, args) => {
      calls.push({ command, args });
      if (options.invoke) {
        const result = options.invoke(command, args, emit);
        if (result !== undefined) return result;
      }
      if (command === "get_settings")
        return { language: options.language || "en" };
      return structuredClone(state);
    },
    nativeListen: async (name, callback) => {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    },
  };
  runInNewContext(bundle.outputFiles[0].text, context);
  context.updateUi.setLanguage(options.language || "en");
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  return {
    document,
    window,
    calls,
    listeners,
    emit,
    flush,
    ui: context.updateUi,
    mount: (options) =>
      context.updateUi.mountUpdatePanel(
        document.getElementById("panel"),
        options,
      ),
  };
}

test("available updates never install until the restart confirmation is accepted", async () => {
  const f = fixture({
    state: { phase: "ready", latestVersion: "0.5.0", messageCode: "ready" },
  });
  await f.mount();
  const button = f.document.getElementById("install-update");
  button.focus();
  button.click();
  await f.flush();
  assert.ok(f.document.querySelector("dialog[open]"));
  assert.equal(
    f.calls.some(({ command }) => command === "install_update"),
    false,
  );
  f.document.querySelector("dialog .secondary").click();
  await f.flush();
  assert.equal(
    f.calls.some(({ command }) => command === "install_update"),
    false,
  );
  assert.equal(f.document.activeElement, button);
  button.click();
  await f.flush();
  f.document.querySelector("dialog button:not(.secondary)").click();
  await f.flush();
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        f.calls.find(({ command }) => command === "install_update").args,
      ),
    ),
    {
      confirmed: true,
      expectedVersion: "0.5.0",
      expectedIncludeBetaUpdates: false,
    },
  );
});

test("saved beta preference is separate from draft edits and installed SemVer release type", async () => {
  const f = fixture({
    state: {
      currentVersion: "0.5.0-beta.3+build.7",
      includeBetaUpdates: false,
    },
  });
  let draftIncludeBetaUpdates = false;
  await f.mount({ getDraftIncludeBetaUpdates: () => draftIncludeBetaUpdates });
  assert.equal(
    f.document.getElementById("update-release-type").textContent,
    "Beta / Pre-release",
  );
  const helper = f.document.getElementById("update-preference-help");
  const draft = f.document.getElementById("update-preference-draft");
  assert.equal(helper.textContent, "Only stable releases will be checked.");
  assert.equal(draft.hidden, true);
  draftIncludeBetaUpdates = true;
  f.window.dispatchEvent(new f.window.Event("settings-draft-changed"));
  assert.equal(helper.textContent, "Only stable releases will be checked.");
  assert.equal(draft.hidden, false);
  f.emit({
    currentVersion: "0.5.0+build-beta.7",
    includeBetaUpdates: true,
    messageCode: "preference-changed",
  });
  assert.equal(
    f.document.getElementById("update-release-type").textContent,
    "Stable",
  );
  assert.equal(helper.textContent, "Stable and beta releases will be checked.");
  assert.equal(draft.hidden, true);
  assert.ok(f.document.getElementById("update-message").textContent.length > 0);
});

test("install consent is tied to the saved beta preference and rechecked after confirmation", async () => {
  const f = fixture({
    state: {
      phase: "ready",
      latestVersion: "0.6.0-beta.1",
      includeBetaUpdates: true,
    },
  });
  await f.mount();
  f.document.getElementById("install-update").click();
  await f.flush();
  f.emit({
    phase: "ready",
    latestVersion: "0.6.0-beta.1",
    includeBetaUpdates: false,
  });
  f.document.querySelector("dialog button:not(.secondary)").click();
  await f.flush();
  assert.equal(
    f.calls.some(({ command }) => command === "install_update"),
    false,
  );
  f.emit({
    phase: "ready",
    latestVersion: "0.6.0-beta.1",
    includeBetaUpdates: true,
  });
  f.document.getElementById("install-update").click();
  await f.flush();
  f.document.querySelector("dialog button:not(.secondary)").click();
  await f.flush();
  const consent = f.calls.find(({ command }) => command === "install_update");
  assert.equal(consent.args.confirmed, true);
  assert.equal(consent.args.expectedVersion, "0.6.0-beta.1");
  assert.equal(consent.args.expectedIncludeBetaUpdates, true);
  assert.equal("expectedChannel" in consent.args, false);
});

test("unsaved or saving preferences block installation, including edits made during consent", async () => {
  const f = fixture({
    state: { phase: "ready", latestVersion: "0.5.0" },
  });
  let unsaved = true;
  let saving = false;
  await f.mount({
    hasUnsavedChanges: () => unsaved,
    isSettingsSaving: () => saving,
  });
  const install = f.document.getElementById("install-update");
  assert.equal(install.disabled, true);
  assert.equal(
    f.document.getElementById("update-settings-warning").hidden,
    false,
  );
  unsaved = false;
  saving = true;
  f.window.dispatchEvent(new f.window.Event("settings-draft-changed"));
  assert.equal(install.disabled, true);
  saving = false;
  f.window.dispatchEvent(new f.window.Event("settings-draft-changed"));
  assert.equal(install.disabled, false);
  install.click();
  await f.flush();
  unsaved = true;
  f.window.dispatchEvent(new f.window.Event("settings-draft-changed"));
  f.document.querySelector("dialog button:not(.secondary)").click();
  await f.flush();
  assert.equal(
    f.calls.some(({ command }) => command === "install_update"),
    false,
  );
  assert.equal(install.disabled, true);
});

test("cancel download remains usable while the download promise is still pending", async () => {
  let finishDownload;
  const f = fixture({
    state: { phase: "available", latestVersion: "0.5.0" },
    invoke(command, _args, emit) {
      if (command === "download_update") {
        emit({
          phase: "downloading",
          latestVersion: "0.5.0",
          downloaded: 1024,
          total: 2048,
        });
        return new Promise((resolve) => {
          finishDownload = resolve;
        });
      }
      if (command === "cancel_update") {
        emit({
          phase: "available",
          latestVersion: "0.5.0",
          messageCode: "cancelled",
        });
        finishDownload();
        return Promise.resolve();
      }
    },
  });
  await f.mount();
  f.document.getElementById("download-update").click();
  await f.flush();
  assert.equal(f.document.getElementById("cancel-update").hidden, false);
  assert.equal(f.document.getElementById("check-updates").disabled, true);
  f.document.getElementById("cancel-update").click();
  await f.flush();
  assert.equal(
    f.calls.filter(({ command }) => command === "cancel_update").length,
    1,
  );
  assert.match(
    f.document.getElementById("update-message").textContent,
    /cancelled/,
  );
  assert.equal(
    f.calls.some(({ command }) => command === "install_update"),
    false,
  );
});

test("live updater events cannot be overwritten by a slower initial snapshot", async () => {
  let finishSnapshot;
  const f = fixture({
    invoke(command) {
      if (command === "get_update_state")
        return new Promise((resolve) => {
          finishSnapshot = resolve;
        });
    },
  });
  const mounting = f.mount();
  await f.flush();
  f.emit({ phase: "ready", latestVersion: "0.5.0", messageCode: "ready" });
  finishSnapshot(snapshot());
  await mounting;
  assert.equal(f.document.getElementById("install-update").hidden, false);
  assert.match(f.document.getElementById("update-phase").textContent, /ready/i);
});

test("manual checks show progress and result inside the mounted panel", async () => {
  let finishCheck;
  const f = fixture({
    invoke(command, _args, emit) {
      if (command === "check_for_updates") {
        emit({ phase: "checking", messageCode: "checking" });
        return new Promise((resolve) => {
          finishCheck = () => {
            const state = snapshot({
              phase: "current",
              messageCode: "current",
              lastSuccessfulCheck: 1791099000,
            });
            emit(state);
            resolve(state);
          };
        });
      }
    },
  });
  await f.mount();
  f.document.getElementById("check-updates").click();
  await f.flush();
  assert.match(
    f.document.getElementById("update-message").textContent,
    /Checking/,
  );
  assert.equal(f.document.getElementById("check-updates").disabled, true);
  finishCheck();
  await f.flush();
  assert.match(
    f.document.getElementById("update-message").textContent,
    /up to date/,
  );
  assert.match(
    f.document.getElementById("update-last-check-label").textContent,
    /Last successful check/,
  );
  assert.equal(
    f.document.getElementById("update-last-check").textContent,
    new Date(1791099000 * 1000).toLocaleString("en"),
  );
  assert.equal(f.document.getElementById("check-updates").disabled, false);
  assert.equal(
    f.calls.some(({ command }) => command === "dismiss_update"),
    false,
  );
});

test("Spanish updater status uses resources even when the backend message is English", async () => {
  const f = fixture({
    language: "es",
    state: {
      phase: "error",
      messageCode: "check-failed",
      message: "Unable to reach GitHub. Try again later.",
    },
  });
  await f.mount();
  assert.equal(
    f.document.getElementById("check-updates").textContent,
    "Buscar actualizaciones",
  );
  assert.match(
    f.document.getElementById("update-message").textContent,
    /Comprueba tu conexión/,
  );
  assert.equal(
    f.ui.updateStatusText(
      snapshot({ phase: "available", latestVersion: "0.5.0" }),
    ),
    "Actualización disponible: 0.5.0",
  );
});

test("remote release notes are rendered as text and never interpreted as HTML", async () => {
  const notes = '<img src="x" onerror="alert(1)"><script>unexpected()</script>';
  const f = fixture({
    state: { phase: "available", latestVersion: "0.5.0", notes },
  });
  const unlisten = await f.mount();
  assert.equal(f.document.getElementById("notes").textContent, notes);
  assert.equal(f.document.querySelector("#notes img, #notes script"), null);
  unlisten();
  assert.equal(f.listeners.has("update-state"), false);
});

for (const standalone of [false, true]) {
  test(`${standalone ? "standalone" : "embedded"} update notes keep keyboard order and actions outside the reading region through progress`, async () => {
    const notesText = "A long release note.\n".repeat(80);
    const f = fixture({
      state: { phase: "available", latestVersion: "0.5.0", notes: notesText },
    });
    if (standalone) await f.ui.renderUpdate();
    else await f.mount();
    const notes = f.document.getElementById("notes");
    const panel = notes.closest("#update-details, #panel");
    const actions = panel.querySelector(".update-actions");
    assert.equal(
      notes.getAttribute("tabindex"),
      "0",
      "keyboard users can reach the reading region",
    );
    assert.ok(
      f.document.getElementById(notes.getAttribute("aria-labelledby"))
        .textContent,
      "the reading region has a localized visible label",
    );
    const keyboardOrder = [...panel.querySelectorAll("button, [tabindex]")];
    assert.equal(
      keyboardOrder.indexOf(notes) <
        keyboardOrder.indexOf(f.document.getElementById("check-updates")),
      standalone,
      "keyboard order follows each context's visible notes/action order",
    );
    for (const [phase, action] of [
      ["downloading", "cancel-update"],
      ["ready", "install-update"],
    ]) {
      f.emit({
        phase,
        latestVersion: "0.5.0",
        notes: notesText,
        downloaded: 1024,
        total: 2048,
      });
      assert.equal(f.document.getElementById("notes"), notes);
      assert.equal(notes.textContent, notesText);
      const button = f.document.getElementById(action);
      assert.equal(button.hidden, false);
      assert.ok(actions.contains(button));
      assert.equal(
        notes.contains(button),
        false,
        "progress/restart controls cannot become part of scrolling remote notes",
      );
    }
  });
}

test("an already mounted updater panel refreshes when the saved language changes", async () => {
  const f = fixture({ state: { phase: "available", latestVersion: "0.5.0" } });
  const cleanup = await f.mount();
  f.ui.setLanguage("es");
  f.window.dispatchEvent(new f.window.Event("language-changed"));
  assert.equal(
    f.document.getElementById("download-update").textContent,
    "Descargar actualización",
  );
  cleanup();
  f.ui.setLanguage("pl");
  f.window.dispatchEvent(new f.window.Event("language-changed"));
  assert.equal(
    f.document.getElementById("download-update").textContent,
    "Descargar actualización",
  );
});
