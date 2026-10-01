import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";
import { readFile } from "node:fs/promises";

const result = await build({
  entryPoints: ["src/settings/services.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "servicesUi",
});

function fixture(provider = "synology-chatplus") {
  const { window, document } = parseHTML(
    '<html><body><div id="editor"></div></body></html>',
  );
  // LinkeDOM lacks the browser's select.value setter.
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
  const services = [
    {
      id: "first",
      name: "Test service",
      provider,
      url: "https://example.com/",
      enabled: true,
      notifications: true,
    },
  ];
  let confirmation = false;
  const context = { window, document, crypto: { randomUUID: () => "unique" } };
  runInNewContext(result.outputFiles[0].text, context);
  const add = context.servicesUi.serviceEditor(
    document.getElementById("editor"),
    services,
    () => {},
    async () => confirmation,
  );
  return {
    window,
    document,
    services,
    add,
    confirm: (value) => {
      confirmation = value;
    },
  };
}

test("service fields share full-width controls and associated labels", async () => {
  const { document } = fixture();
  const controls = [
    ...document.querySelectorAll(".service-field input, .service-field select"),
  ];
  assert.equal(controls.length, 3);
  for (const control of controls) {
    assert.ok(control.classList.contains("service-control"));
    assert.ok(document.querySelector(`label[for="${control.id}"]`));
  }
  const css = await readFile("src/ui/shell.css", "utf8");
  assert.match(css, /\.service-control\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.service-control\s*\{[^}]*height:\s*32px/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:/);
});

test("provider status and desktop-notification fields follow provider classification", () => {
  for (const provider of [
    "synology-chatplus",
    "synology-chat",
    "slack",
    "discord",
  ]) {
    const { document } = fixture(provider);
    const experimental = provider !== "synology-chatplus";
    assert.equal(
      Boolean(document.querySelector(".experimental-badge")),
      experimental,
    );
    assert.equal(
      Boolean(document.querySelector(".service-provider-info")),
      experimental,
    );
    assert.equal(
      document.querySelectorAll(".service-options input[type=checkbox]").length,
      experimental ? 1 : 2,
    );
    assert.equal(
      document.querySelectorAll(".service-field input[type=url]").length,
      provider === "discord" ? 0 : 1,
    );
    assert.ok(
      [...document.querySelectorAll("option")].every(
        (x) => !x.textContent.includes("Experimental"),
      ),
    );
    if (experimental) {
      assert.equal(
        document.querySelector(".experimental-badge").textContent,
        "Experimental",
      );
      assert.match(
        document.querySelector(".service-secondary-help").textContent,
        /SSO/,
      );
      assert.equal(
        document.querySelector(".service-provider-info").getAttribute("role"),
        null,
      );
    }
  }
});

test("Discord uses name-only configuration and changing provider keeps service identity", () => {
  const { window, document, services } = fixture("discord");
  assert.equal(document.querySelectorAll(".service-control").length, 2);
  const name = document.querySelector("input:not([type])");
  name.value = "Personal Discord";
  name.dispatchEvent(new window.Event("input"));
  assert.equal(services[0].id, "first");
  const provider = document.querySelector("select");
  provider.value = "slack";
  provider.dispatchEvent(new window.Event("change"));
  assert.equal(services[0].id, "first");
  assert.equal(services[0].name, "Personal Discord");
  assert.equal(services[0].url, "https://app.slack.com/");
  const next = document.querySelector("select");
  next.value = "discord";
  next.dispatchEvent(new window.Event("change"));
  assert.equal(services[0].url, "https://discord.com/app/");
  assert.equal(services[0].notifications, false);
  assert.equal(document.querySelectorAll("input[type=url]").length, 0);
});

test("enabled edits stay in the service draft and removal requires confirmation", async () => {
  const { window, document, services, add, confirm } = fixture();
  const enabled = document.querySelector(".service-options input");
  enabled.checked = false;
  enabled.dispatchEvent(new window.Event("change"));
  assert.equal(services[0].enabled, false);
  add();
  const remove = document.querySelector(".service-removal .danger");
  assert.equal(remove.type, "button");
  assert.match(remove.getAttribute("aria-label"), /Test service/);
  assert.ok(remove.getAttribute("aria-describedby"));
  remove.dispatchEvent(new window.Event("click"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(services.length, 2, "cancel keeps both configurations");
  confirm(true);
  remove.dispatchEvent(new window.Event("click"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(services.length, 1);
  assert.equal(
    services[0].id,
    "service-unique",
    "only the requested draft is removed",
  );
});
