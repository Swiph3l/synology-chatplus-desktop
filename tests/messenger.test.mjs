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
const adapterBuild = await build({
  entryPoints: ["src/theme/providers/messenger.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { createMessengerAdapter } = await import(
  `data:text/javascript;base64,${Buffer.from(adapterBuild.outputFiles[0].text).toString("base64")}`
);

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
      randomUUID: () => "new-messenger",
      getRandomValues: (values) => values.fill(127),
    },
  };
  const services = ["personal", "work"].map((id) => ({
    id: `messenger-${id}`,
    provider: "messenger",
    name: id,
    url: "https://www.facebook.com/messages/",
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

test("Messenger registers the official current messages URL and Experimental notification capability", () => {
  const context = {};
  runInNewContext(registryBuild.outputFiles[0].text, context);
  const provider = context.registry.providers.messenger;
  assert.equal(provider.name, "Messenger");
  assert.equal(provider.defaultUrl, "https://www.facebook.com/messages/");
  assert.equal(provider.urlMode, "fixed");
  assert.equal(provider.experimental, true);
  assert.equal(provider.notifications, true);
  assert.equal(
    context.registry.serviceSupportsNotifications({
      id: "personal",
      provider: "messenger",
      url: provider.defaultUrl,
    }),
    true,
  );
  const f = fixture();
  for (const service of f.services) {
    const row = f.document.getElementById(`service-${service.id}-settings`);
    assert.equal(
      row.querySelector(".service-provider-name").textContent,
      "Messenger",
    );
    assert.equal(
      row.querySelector(".experimental-badge").textContent,
      "Experimental",
    );
    assert.equal(
      row.querySelector(".provider-icon").src,
      "/providers/messenger.svg",
    );
  }
});

test("Messenger settings keep stable instances and mute separate with truthful Facebook login note", () => {
  const f = fixture();
  f.manager.edit("messenger-work");
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
    "Messenger Web integration is experimental. Facebook login is required.",
  );
  setServiceField(f, "name", "Work Messenger");
  applyServiceDialog(f);
  assert.equal(f.services[0].id, "messenger-personal");
  assert.equal(f.services[0].notifications, true);
  assert.equal(f.services[1].id, "messenger-work");
  assert.equal(f.services[1].name, "Work Messenger");
  assert.equal(f.services[1].notifications, false);
  f.manager.add("messenger");
  setServiceField(f, "name", "Another account");
  applyServiceDialog(f);
  assert.equal(f.services[2].id, "service-new-messenger");
  assert.equal(f.services[2].provider, "messenger");
  assert.equal(f.services[2].url, "https://www.facebook.com/messages/");
});

test("Messenger DOM remains unknown for login, partial lists and generic Facebook navigation counts", () => {
  for (const content of [
    "",
    '<div role="navigation"><div role="grid" aria-rowcount="20"><div role="row"><span aria-label="Unread"></span></div></div></div>',
    '<div role="navigation"><span aria-label="10 notifications"></span></div>',
    '<div role="grid" aria-rowcount="1"><div role="row" aria-selected="true">Read chat</div></div>',
  ]) {
    const { document } = parseHTML(
      `<html><title>(20) Facebook</title><body>${content}</body></html>`,
    );
    const adapter = createMessengerAdapter(document);
    assert.equal(adapter.source, "messenger-dom");
    assert.equal(adapter.snapshot().hasUnread, null);
    assert.equal(adapter.snapshot().count, null);
    assert.deepEqual(adapter.snapshot().conversations, []);
    assert.equal(adapter.snapshot().currentConversation, null);
    assert.equal(adapter.providerUnreadZero(), false);
    assert.equal(adapter.readContext(), null);
    assert.equal(adapter.contentContext(), null);
    assert.equal(adapter.interactionContext(new Event("click")), null);
    assert.equal(
      adapter.isViewingNotification({ tag: "chat", title: "Facebook" }),
      false,
    );
  }
});

test("Messenger adapter never inspects private DOM/contact data or acknowledges another instance", () => {
  const forbiddenDocument = new Proxy(
    {},
    {
      get() {
        throw new Error("unverified Messenger markup must not be read");
      },
    },
  );
  const personal = createMessengerAdapter(forbiddenDocument);
  const work = createMessengerAdapter(forbiddenDocument);
  personal.observe(() => {
    throw new Error("no unaudited DOM observation");
  })();
  assert.equal(personal.snapshot().hasUnread, null);
  assert.equal(work.snapshot().hasUnread, null);
});
