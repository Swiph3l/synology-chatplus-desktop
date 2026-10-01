import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";
import { readFile } from "node:fs/promises";

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
  Object.defineProperty(window.HTMLSelectElement.prototype, "value", {
    configurable: true,
    get() {
      return (
        this.querySelector("option[selected]")?.getAttribute("value") ?? ""
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
  window.HTMLElement.prototype.focus = () => {};
  const services = accounts();
  const removed = [];
  const context = {
    window,
    document,
    crypto: { randomUUID: () => "new-account" },
  };
  runInNewContext(formBuild.outputFiles[0].text, context);
  const add = context.servicesUi.serviceEditor(
    document.getElementById("editor"),
    services,
    () => {},
    async (service) => {
      removed.push(service.id);
      return true;
    },
  );
  return { window, document, services, removed, add };
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
    assert.equal(row.querySelector("select").value, "mattermost");
    assert.equal(
      row.querySelector("option[value=mattermost]").textContent,
      "Mattermost",
    );
    assert.equal(
      row.querySelector(".experimental-badge").textContent,
      "Experimental",
    );
    assert.match(
      row.querySelector(".service-provider-info").textContent,
      /Desktop unread and notifications are not yet supported/,
    );
    const url = row.querySelector("input[type=url]");
    assert.equal(url.required, true);
    assert.equal(url.value, service.url);
    assert.equal(
      row.querySelector(`label[for="${url.id}"]`).textContent,
      "Server URL",
    );
    assert.equal(row.querySelectorAll(".service-control").length, 3);
    assert.equal(row.querySelectorAll("input[type=checkbox]").length, 1);
    assert.equal(row.querySelector("input[type=checkbox]").checked, true);
  }
});

test("Mattermost shared form adds, edits and removes the correct independent instance", async () => {
  const f = formFixture();
  const name = f.document.getElementById("service-mattermost-private-name");
  name.value = "Mattermost — Client A";
  name.dispatchEvent(new f.window.Event("input"));
  const url = f.document.getElementById("service-mattermost-private-url");
  url.value = "https://mattermost.example.com/";
  url.dispatchEvent(new f.window.Event("input"));
  f.add();
  const provider = f.document.getElementById(
    "service-service-new-account-provider",
  );
  provider.value = "mattermost";
  provider.dispatchEvent(new f.window.Event("change"));
  assert.equal(f.services[2].provider, "mattermost");
  assert.ok(f.document.getElementById("service-service-new-account-url"));
  assert.equal(f.services[1].id, "mattermost-private");
  f.document.getElementById("service-mattermost-company-remove").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.removed, ["mattermost-company"]);
  assert.equal(f.services.length, 2);
  assert.equal(f.services[0].id, "mattermost-private");
  assert.equal(
    f.document.getElementById("service-mattermost-private-name").value,
    "Mattermost — Client A",
  );
  assert.equal(
    f.document.getElementById("service-mattermost-private-url").value,
    "https://mattermost.example.com/",
  );
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
