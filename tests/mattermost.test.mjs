import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";
import { readFile } from "node:fs/promises";
import {
  servicesDom,
  setServiceField,
  applyServiceDialog,
  chooseProvider,
} from "./helpers/services-dom.mjs";

const formBuild = await build({
  entryPoints: ["src/settings/services.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "servicesUi",
});
const registryBuild = await build({
  entryPoints: ["src/app/providers.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "registry",
});
const railBuild = await build({
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
const accounts = () =>
  ["company", "private"].map((id) => ({
    id: `mattermost-${id}`,
    provider: "mattermost",
    name: `Mattermost — ${id}`,
    url: "https://chat.example.com/",
    enabled: true,
    notifications: false,
  }));

function formFixture() {
  const { window, document } = parseHTML(
    '<html><body><div id="editor"></div><button id="add-service">Add service</button></body></html>',
  );
  const context = {
    window,
    document,
    structuredClone,
    URL,
    AbortController,
    ...servicesDom(window, document),
    crypto: {
      randomUUID: () => "new-account",
      getRandomValues: (values) => values.fill(127),
    },
  };
  const services = accounts();
  runInNewContext(formBuild.outputFiles[0].text, context);
  const manager = context.servicesUi.serviceEditor(
    document.getElementById("editor"),
    services,
    () => {},
  );
  return { window, document, services, manager };
}

test("Mattermost registers as Experimental with a required custom server URL", () => {
  const context = {};
  runInNewContext(registryBuild.outputFiles[0].text, context);
  const provider = context.registry.providers.mattermost;
  assert.equal(provider.name, "Mattermost");
  assert.equal(provider.experimental, true);
  assert.equal(provider.urlMode, "server");
  assert.equal(provider.defaultUrl, "");
  const f = formFixture();
  for (const service of f.services) {
    const row = f.document.getElementById(`service-${service.id}-settings`);
    assert.equal(
      row.querySelector(".service-provider-name").textContent,
      "Mattermost",
    );
    assert.equal(
      row.querySelector(".experimental-badge").textContent,
      "Experimental",
    );
    f.manager.edit(service.id);
    assert.equal(
      f.document.getElementById("service-dialog-provider-mattermost").checked,
      true,
    );
    const url = f.document.getElementById("service-dialog-url");
    assert.equal(url.required, true);
    assert.equal(url.value, service.url);
    assert.equal(url.closest(".service-field").hidden, false);
    assert.equal(
      f.document.getElementById("service-dialog-notifications").disabled,
      true,
    );
    f.document.querySelector(".service-dialog-footer .secondary").click();
  }
});

test("Mattermost manager adds, edits and removes the correct independent instance", async () => {
  const f = formFixture();
  f.manager.edit("mattermost-private");
  setServiceField(f, "name", "Mattermost Client A");
  setServiceField(f, "url", "https://mattermost.example.com/");
  applyServiceDialog(f);
  f.manager.add();
  chooseProvider(f, "mattermost");
  setServiceField(f, "name", "New Mattermost");
  setServiceField(f, "url", "https://new.example.com/");
  applyServiceDialog(f);
  assert.equal(f.services[2].id, "service-new-account");
  assert.equal(f.services[2].provider, "mattermost");
  assert.equal(f.services[2].notifications, false);
  const removal = f.manager.remove("mattermost-company");
  assert.match(f.document.querySelector("dialog").textContent, /company/);
  f.document.querySelector("dialog .danger").click();
  assert.equal(await removal, true);
  assert.equal(f.services.length, 2);
  assert.equal(f.services[0].id, "mattermost-private");
  assert.equal(f.services[0].name, "Mattermost Client A");
  assert.equal(f.services[0].url, "https://mattermost.example.com/");
});

test("Mattermost rail switches and opens context menus by instance ID, preserving selected state", async () => {
  const { window, document } = parseHTML(
    '<html><body><main id="app"></main></body></html>',
  );
  window.HTMLElement.prototype.focus = () => {};
  document.hasFocus = () => false;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    right: 48,
    top: 60,
  });
  const settings = {
    activeService: "mattermost-company",
    services: accounts(),
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
  runInNewContext(railBuild.outputFiles[0].text, context);
  await context.railUi.renderServices();
  for (const service of settings.services) {
    const button = document.querySelector(`[data-rail-key="${service.id}"]`);
    assert.match(button.title, /Mattermost.*Experimental/);
    assert.match(button.title, new RegExp(service.name));
    assert.equal(button.querySelector("img").src, "/providers/mattermost.svg");
    const event = new window.Event("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    Object.assign(event, { clientX: 25, clientY: 120 });
    button.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    button.click();
  }
  await new Promise((resolve) => setImmediate(resolve));
  for (const command of ["activate_service", "show_service_context_menu"])
    assert.deepEqual(
      calls
        .filter((call) => call.command === command)
        .map((call) => call.args.id),
      ["mattermost-company", "mattermost-private"],
    );
  events.get("services-changed")({
    payload: { ...settings, activeService: "mattermost-private" },
  });
  assert.equal(
    document
      .querySelector('[data-rail-key="mattermost-private"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    document
      .querySelector('[data-rail-key="mattermost-company"]')
      .getAttribute("aria-pressed"),
    "false",
  );
  const icon = await readFile("public/providers/mattermost.svg", "utf8");
  assert.match(icon, /<svg/);
  assert.doesNotMatch(icon, /<script|\bon\w+=|href=/i);
});
