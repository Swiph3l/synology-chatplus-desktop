import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";

const [formatterBuild, railBuild] = await Promise.all([
  build({
    stdin: {
      contents: `export { attachmentDownloadStatus } from "./src/app/downloads";
        export { setLanguage, t } from "./src/i18n";`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "esm",
  }),
  build({
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
  }),
]);
const { attachmentDownloadStatus, setLanguage, t } = await import(
  `data:text/javascript;base64,${Buffer.from(formatterBuild.outputFiles[0].text).toString("base64")}`
);

test("attachment lifecycle statuses preserve the chosen path in every locale without unresolved placeholders", () => {
  const path = "C:\\Downloads\\Raport 2026 🐈.pdf";
  for (const language of ["en", "pl", "es", "de", "fr", "ja", "zh-TW"]) {
    setLanguage(language);
    for (const [state, key] of [
      ["completed", "downloads.completed"],
      ["failed", "downloads.failed"],
      ["unavailable", "downloads.failed"],
    ])
      assert.equal(
        attachmentDownloadStatus({ serviceId: "first", state, path }),
        t(key, { path }),
      );
    for (const [state, key] of [
      ["requested", "downloads.inProgress"],
      ["in-progress", "downloads.inProgress"],
      ["paused", "downloads.paused"],
      ["cancelled", "downloads.cancelled"],
    ])
      assert.equal(
        attachmentDownloadStatus({ serviceId: "first", state, path }),
        `${t(key)}\n${t("downloads.destination", { path })}`,
      );
    assert.equal(
      attachmentDownloadStatus({ serviceId: "first", state: "completed" }),
      t("downloads.completedNoPath"),
    );
    assert.equal(
      attachmentDownloadStatus({
        serviceId: "first",
        state: "failed",
        path: 42,
      }),
      t("downloads.failedNoPath"),
    );
    assert.equal(
      attachmentDownloadStatus({
        serviceId: "first",
        state: "future-state",
        path,
      }),
      null,
    );
  }
  setLanguage("en");
});

test("the rail shows full localized download paths as text and title, ignoring removed/disabled services and unknown lifecycle states", async () => {
  const { window, document } = parseHTML(
    '<html><body><main id="app"></main></body></html>',
  );
  const settings = {
    language: "pl",
    activeService: "first",
    includeBetaUpdates: false,
    services: [
      {
        id: "first",
        provider: "synology-chatplus",
        name: "First",
        enabled: true,
      },
      {
        id: "second",
        provider: "synology-chatplus",
        name: "Second",
        enabled: true,
      },
      { id: "disabled", provider: "discord", name: "Disabled", enabled: false },
    ],
  };
  const events = new Map();
  const calls = [];
  const context = {
    window,
    document,
    nativeInvoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "get_settings") return settings;
    },
    nativeListen: async (event, listener) => {
      events.set(event, listener);
      return () => {};
    },
  };
  runInNewContext(railBuild.outputFiles[0].text, context);
  await context.railUi.renderServices();
  const status = document.querySelector(".footer-status");
  const footer = document.querySelector(".app-footer");
  const footerChildren = [...footer.children];
  const nativeCallsBeforeEvents = calls.length;
  const path = "C:\\Downloads\\<img onerror=alert(1)>.pdf";
  const event = events.get("attachment-download");
  event({ payload: { serviceId: "second", state: "requested", path } });
  assert.equal(
    status.textContent,
    `Pobieranie załącznika…\nMiejsce pobierania: ${path}`,
  );
  assert.equal(
    status.title,
    status.textContent,
    "hover/accessibility preserves the full destination",
  );
  assert.equal(
    status.querySelector("img"),
    null,
    "a filename cannot create markup",
  );
  event({ payload: { serviceId: "second", state: "completed", path } });
  assert.equal(status.textContent, `Pobrano do:\n${path}`);
  for (const payload of [
    { serviceId: "removed", state: "failed", path },
    { serviceId: "disabled", state: "failed", path },
    { serviceId: "first", state: "not-a-state", path },
    null,
  ])
    event({ payload });
  assert.equal(status.textContent, `Pobrano do:\n${path}`);
  assert.deepEqual(
    [...footer.children],
    footerChildren,
    "download feedback keeps the compact footer structure",
  );
  assert.equal(
    calls.length,
    nativeCallsBeforeEvents,
    "status display never opens, stores or sends a path",
  );
});
