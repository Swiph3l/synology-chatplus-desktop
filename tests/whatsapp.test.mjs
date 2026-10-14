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

function fixture() {
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
      randomUUID: () => "new-whatsapp",
      getRandomValues: (values) => values.fill(127),
    },
  };
  const services = ["personal", "work"].map((id) => ({
    id: `whatsapp-${id}`,
    provider: "whatsapp",
    name: id,
    url: "https://web.whatsapp.com/",
    enabled: true,
    notifications: id === "personal",
  }));
  runInNewContext(formBuild.outputFiles[0].text, context);
  const manager = context.servicesUi.serviceEditor(
    document.getElementById("editor"),
    services,
    () => {},
  );
  return { window, document, services, manager };
}

test("WhatsApp registers the official fixed URL, unread/notification support and Experimental display", () => {
  const context = {};
  runInNewContext(registryBuild.outputFiles[0].text, context);
  const provider = context.registry.providers.whatsapp;
  assert.equal(provider.name, "WhatsApp");
  assert.equal(provider.defaultUrl, "https://web.whatsapp.com/");
  assert.equal(provider.urlMode, "fixed");
  assert.equal(provider.experimental, true);
  assert.equal(provider.notifications, true);
  assert.equal(
    context.registry.serviceSupportsNotifications({
      id: "personal",
      provider: "whatsapp",
      url: provider.defaultUrl,
    }),
    true,
  );
  const f = fixture();
  for (const service of f.services) {
    const row = f.document.getElementById(`service-${service.id}-settings`);
    assert.equal(
      row.querySelector(".service-provider-name").textContent,
      "WhatsApp",
    );
    assert.equal(
      row.querySelector(".experimental-badge").textContent,
      "Experimental",
    );
    assert.equal(
      row.querySelector(".provider-icon").src,
      "/providers/whatsapp.svg",
    );
  }
});

test("WhatsApp service manager preserves separate stable identities, configured names and mute settings", () => {
  const f = fixture();
  f.manager.edit("whatsapp-work");
  assert.equal(f.document.getElementById("service-dialog-url").disabled, true);
  assert.equal(
    f.document.getElementById("service-dialog-notifications").disabled,
    false,
  );
  assert.equal(
    f.document.getElementById("service-dialog-notifications").checked,
    false,
  );
  assert.equal(
    f.document.querySelector(".service-dialog-provider-help").textContent,
    "WhatsApp Web integration is experimental.",
  );
  setServiceField(f, "name", "Work messages");
  applyServiceDialog(f);
  assert.equal(f.services[0].id, "whatsapp-personal");
  assert.equal(f.services[0].notifications, true);
  assert.equal(f.services[1].id, "whatsapp-work");
  assert.equal(f.services[1].name, "Work messages");
  assert.equal(f.services[1].notifications, false);
  f.manager.add("whatsapp");
  setServiceField(f, "name", "Another account");
  applyServiceDialog(f);
  assert.equal(f.services[2].id, "service-new-whatsapp");
  assert.equal(f.services[2].provider, "whatsapp");
  assert.equal(f.services[2].url, "https://web.whatsapp.com/");
});

test("all seven locales contain WhatsApp experimental and unsupported-action notes", async () => {
  for (const locale of ["en", "pl", "es", "de", "fr", "ja", "zh-TW"]) {
    const strings = JSON.parse(
      await readFile(`src/i18n/${locale}.json`, "utf8"),
    );
    for (const key of [
      "services.whatsappExperimental",
      "services.whatsappMarkCurrentUnsupported",
      "services.whatsappMarkAllUnsupported",
      "errors.whatsappUrl",
    ]) {
      assert.ok(
        strings[key].includes("WhatsApp") ||
          key.endsWith("whatsappMarkCurrentUnsupported"),
        `${locale}: ${key}`,
      );
      assert.doesNotMatch(strings[key], /\?{2,}/);
    }
  }
});
