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
    channel: "stable",
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
    '<html><body><div id="panel"></div></body></html>',
  );
  let focused = null;
  Object.defineProperty(document, "activeElement", { get: () => focused });
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
    mount: () =>
      context.updateUi.mountUpdatePanel(document.getElementById("panel")),
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
    { confirmed: true },
  );
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
  assert.match(
    f.document.getElementById("update-heading").textContent,
    /ready/,
  );
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
    f.document.getElementById("update-last-check").textContent,
    /Last successful check/,
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
