import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";
import { readFile } from "node:fs/promises";
import {
  servicesDom,
  dispatch,
  setServiceField,
  applyServiceDialog,
  chooseProvider,
} from "./helpers/services-dom.mjs";

const result = await build({
  entryPoints: ["src/settings/services.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "servicesUi",
});
const providerResult = await build({
  entryPoints: ["src/app/providers.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "providerUi",
});

function service(id = "first", provider = "synology-chatplus") {
  return {
    id,
    name: `${id} service`,
    provider,
    url:
      provider === "discord"
        ? "https://discord.com/app/"
        : "https://example.com/",
    enabled: true,
    notifications: provider !== "slack" && provider !== "mattermost",
  };
}

function fixture(initial = [service()], fixtureServiceIds = []) {
  const { window, document } = parseHTML(
    '<html><body><div class="settings-content"><div id="editor"></div></div><button id="add-service">Add service</button></body></html>',
  );
  const dom = servicesDom(window, document);
  const services = structuredClone(initial);
  const changes = [],
    ids = [];
  let colorSample = 0;
  const context = {
    window,
    document,
    URL,
    structuredClone,
    AbortController,
    ...dom,
    crypto: {
      getRandomValues(bytes) {
        bytes.set([++colorSample, 57, 192]);
        return bytes;
      },
      randomUUID() {
        const id = randomUUID();
        ids.push(id);
        return id;
      },
    },
  };
  runInNewContext(result.outputFiles[0].text, context);
  runInNewContext(providerResult.outputFiles[0].text, context);
  const fixtureIds = new Set(fixtureServiceIds);
  const manager = context.servicesUi.serviceEditor(
    document.getElementById("editor"),
    services,
    (change) => changes.push(change),
    (candidate) =>
      context.providerUi.serviceSupportsNotifications(candidate, fixtureIds),
  );
  return {
    window,
    document,
    services,
    changes,
    ids,
    colorSamples: () => colorSample,
    manager,
    dom,
    card: (id) => document.querySelector(`[data-service-id="${id}"]`),
    cancel: () =>
      document.querySelector(".service-dialog-footer .secondary").click(),
  };
}

test("cards summarize services in draft order with provider icons, status and safe tooltips", () => {
  const first = service("first"),
    second = service("second", "discord");
  first.name = '<img src=x onerror="bad()">';
  second.enabled = false;
  const f = fixture([first, second]);
  assert.deepEqual(
    [...f.document.querySelectorAll(".service-card")].map(
      (card) => card.dataset.serviceId,
    ),
    ["first", "second"],
  );
  assert.equal(
    f.card("first").querySelector(".service-card-name").title,
    first.name,
  );
  assert.equal(f.document.querySelector('img[src="x"]'), null);
  assert.equal(
    f.card("first").querySelector("img").src,
    "/providers/synology-chatplus.png",
  );
  assert.equal(
    f.card("second").querySelector("img").src,
    "/providers/discord.svg",
  );
  assert.equal(
    f.card("second").querySelector(".experimental-badge").textContent,
    "Experimental",
  );
  assert.ok(f.card("second").classList.contains("service-card-disabled"));
  assert.equal(
    f.card("first").querySelector(".service-server-address").title,
    first.url,
  );
  assert.ok(f.card("first").querySelector(".service-notification-dot"));
});

test("authorized Mattermost fixture edits keep notifications and allow explicit mute", () => {
  const mm = {
    ...service("mm", "mattermost"),
    url: "http://127.0.0.1:17830/mm/",
    notifications: true,
  };
  const f = fixture([mm], ["mm"]);
  f.manager.edit("mm");
  const toggle = f.document.getElementById("service-dialog-notifications");
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.checked, true);
  f.manager.setDisabled(true);
  assert.equal(toggle.disabled, true);
  f.manager.setDisabled(false);
  assert.equal(toggle.disabled, false);
  setServiceField(f, "name", "Synthetic MM renamed");
  setServiceField(f, "color-hex", "#123456");
  applyServiceDialog(f);
  assert.equal(f.services[0].notifications, true);
  assert.equal(f.services[0].provider, "mattermost");
  assert.equal(f.services[0].notificationColor, "#123456");
  f.manager.edit("mm");
  setServiceField(f, "notifications", false);
  applyServiceDialog(f);
  assert.equal(f.services[0].notifications, false);
});

test("fixture notification capability cannot follow a draft onto another origin or service ID", () => {
  const mm = {
    ...service("mm", "mattermost"),
    url: "http://127.0.0.1:17830/mm/",
    notifications: true,
  };
  const f = fixture([mm], ["mm"]);
  f.manager.edit("mm");
  const toggle = f.document.getElementById("service-dialog-notifications");
  setServiceField(f, "url", "https://mattermost.example.com/");
  assert.equal(toggle.disabled, true);
  assert.equal(toggle.checked, false);
  setServiceField(f, "url", mm.url);
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.checked, true);
  f.cancel();
  const ordinary = fixture([mm]);
  ordinary.manager.edit("mm");
  assert.equal(
    ordinary.document.getElementById("service-dialog-notifications").disabled,
    true,
  );
  setServiceField(ordinary, "name", "Still unsupported");
  applyServiceDialog(ordinary);
  assert.equal(ordinary.services[0].notifications, false);
});

test("modal fields use full-width controls with labels and explicit Cancel/Apply", async () => {
  const f = fixture();
  f.manager.edit("first");
  const controls = [...f.document.querySelectorAll(".service-field input")];
  assert.equal(controls.length, 2);
  for (const control of controls) {
    assert.ok(control.classList.contains("service-control"));
    assert.ok(
      [...f.document.querySelectorAll("label")].some(
        (label) => label.htmlFor === control.id,
      ),
    );
  }
  assert.equal(f.document.activeElement.id, "service-dialog-name");
  assert.equal(
    f.document.querySelector(".service-dialog-footer button").type,
    "button",
  );
  assert.equal(
    f.document.querySelector(".service-dialog-footer [type=submit]")
      .textContent,
    "Apply changes",
  );
  const css = await readFile("src/ui/shell.css", "utf8");
  assert.match(css, /\.service-control\s*\{[^}]*width:\s*100%/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:/);
});

test("provider choices control URL visibility and supported notifications without mutating the draft list", () => {
  for (const provider of [
    "synology-chatplus",
    "synology-chat",
    "slack",
    "discord",
    "mattermost",
  ]) {
    const f = fixture([service("first", provider)]);
    const before = JSON.stringify(f.services);
    f.manager.edit("first");
    const url = f.document.getElementById("service-dialog-url");
    assert.equal(url.closest(".service-field").hidden, provider === "discord");
    assert.equal(url.required, provider !== "discord");
    assert.equal(
      f.document.getElementById("service-dialog-notifications").disabled,
      provider === "slack" || provider === "mattermost",
    );
    chooseProvider(f, provider === "discord" ? "slack" : "discord");
    assert.equal(
      f.document.getElementById("service-dialog-provider-discord").checked,
      provider !== "discord",
    );
    assert.equal(JSON.stringify(f.services), before);
    f.cancel();
  }
});

test("Add allocates a fresh UUID on every opening, Cancel discards values, Apply appends", () => {
  const f = fixture();
  const before = JSON.stringify(f.services);
  f.manager.add();
  assert.equal(
    f.document.getElementById("service-dialog-name").value,
    "Synology ChatPlus",
  );
  assert.equal(f.document.getElementById("service-dialog-url").value, "");
  setServiceField(f, "name", "Cancelled name");
  setServiceField(f, "url", "https://cancelled.example.com/");
  f.document.querySelector('.service-color-swatch[aria-label="Red"]').click();
  f.cancel();
  assert.equal(JSON.stringify(f.services), before);
  assert.equal(f.changes.length, 0);
  f.manager.add();
  assert.equal(
    f.document.getElementById("service-dialog-name").value,
    "Synology ChatPlus",
  );
  assert.equal(f.document.getElementById("service-dialog-url").value, "");
  assert.equal(
    f.document
      .querySelector('.service-color-swatch[aria-label="Auto"]')
      .getAttribute("aria-pressed"),
    "false",
  );
  chooseProvider(f, "discord");
  setServiceField(f, "name", "New Discord");
  applyServiceDialog(f);
  assert.equal(f.services.length, 2);
  assert.equal(f.services[0].id, "first");
  assert.match(
    f.services[1].id,
    /^service-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.notEqual(f.ids[0], f.ids[1]);
  assert.equal(f.services[1].id, `service-${f.ids[1]}`);
  assert.match(f.services[1].notificationColor, /^#[\da-f]{6}$/);
  assert.equal(f.services[1].notificationColor, "#0239c0");
});

test("editing duplicate-provider service A preserves IDs and cannot overwrite service B", () => {
  const f = fixture([service("a", "discord"), service("b", "discord")]);
  const b = JSON.stringify(f.services[1]);
  f.manager.edit("a");
  setServiceField(f, "name", "Personal Discord");
  setServiceField(f, "notifications", false);
  f.document
    .querySelector('.service-color-swatch[aria-label="Purple"]')
    .click();
  applyServiceDialog(f);
  assert.equal(f.services[0].id, "a");
  assert.equal(f.services[0].provider, "discord");
  assert.equal(f.services[0].name, "Personal Discord");
  assert.equal(f.services[0].notifications, false);
  assert.equal(f.services[0].notificationColor, "purple");
  assert.equal(JSON.stringify(f.services[1]), b);
  f.manager.edit("b");
  setServiceField(f, "name", "Work Discord");
  applyServiceDialog(f);
  assert.equal(f.services[0].name, "Personal Discord");
  assert.equal(f.services[1].id, "b");
  assert.equal(f.services[1].name, "Work Discord");
});

test("edit Cancel and Escape leave original values and color untouched", () => {
  for (const cancel of ["button", "escape"]) {
    const f = fixture();
    const before = JSON.stringify(f.services);
    f.manager.edit("first");
    setServiceField(f, "name", "Discard me");
    setServiceField(f, "url", "https://changed.example.com/");
    setServiceField(f, "enabled", false);
    f.document
      .querySelector('.service-color-swatch[aria-label="Cyan"]')
      .click();
    if (cancel === "button") f.cancel();
    else
      assert.equal(
        dispatch(f.window, f.document.querySelector("dialog"), "cancel")
          .defaultPrevented,
        true,
      );
    assert.equal(JSON.stringify(f.services), before);
    assert.equal(f.changes.length, 0);
    assert.equal(f.manager.isDialogOpen(), false);
  }
});

test("Remove identifies its target, Cancel does nothing, confirmation removes only that ID", async () => {
  const f = fixture([service("a", "discord"), service("b", "discord")]);
  const cancelled = f.manager.remove("b");
  assert.match(f.document.querySelector("dialog").textContent, /b service/);
  assert.match(f.document.querySelector("dialog").textContent, /Save/);
  assert.equal(f.document.activeElement.textContent, "Cancel");
  assert.equal(
    await f.manager.remove("a"),
    false,
    "another target cannot reuse an open confirmation",
  );
  f.document.querySelector("dialog .secondary:not(.danger)").click();
  assert.equal(await cancelled, false);
  assert.equal(f.services.length, 2);
  const accepted = f.manager.remove("b");
  f.document.querySelector("dialog .danger").click();
  assert.equal(await accepted, true);
  assert.deepEqual(
    f.services.map((item) => item.id),
    ["a"],
  );
  assert.equal(f.changes.length, 1);
});

test("move buttons and Alt+Arrow on the handle share the ordered draft array", () => {
  const f = fixture([service("a"), service("b"), service("c")]);
  assert.equal(f.card("a").querySelector('[data-action="up"]').disabled, true);
  f.card("b").querySelector('[data-action="up"]').click();
  assert.deepEqual(
    f.services.map((item) => item.id),
    ["b", "a", "c"],
  );
  f.card("b").querySelector('[data-action="down"]').click();
  const handle = f.card("c").querySelector('[data-action="drag"]');
  assert.equal(
    dispatch(f.window, handle, "keydown", { key: "ArrowUp", altKey: true })
      .defaultPrevented,
    true,
  );
  assert.deepEqual(
    f.services.map((item) => item.id),
    ["a", "c", "b"],
  );
  assert.equal(
    dispatch(
      f.window,
      f.card("a").querySelector('[data-action="edit"]'),
      "keydown",
      { key: "ArrowDown", altKey: true },
    ).defaultPrevented,
    false,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(f.services)).map((item) => item.id),
    ["a", "c", "b"],
  );
  f.manager.refresh();
  assert.deepEqual(
    [...f.document.querySelectorAll(".service-card")].map(
      (card) => card.dataset.serviceId,
    ),
    ["a", "c", "b"],
  );
});

test("drag requires the handle, shows insertion state, autoscrolls and Escape cancels", () => {
  const f = fixture([service("a"), service("b"), service("c")]);
  const pointer = { button: 0, pointerId: 7, clientX: 30, clientY: 20 };
  dispatch(
    f.window,
    f.card("a").querySelector(".service-card-name"),
    "pointerdown",
    pointer,
  );
  dispatch(f.window, f.document, "pointermove", { ...pointer, clientY: 390 });
  assert.equal(f.document.querySelector(".is-dragging"), null);
  const handle = f.card("a").querySelector('[data-action="drag"]');
  const scroller = f.document.querySelector(".settings-content");
  scroller.scrollTop = 0;
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(scroller, "clientHeight", { value: 400 });
  dispatch(f.window, handle, "pointerdown", pointer);
  dispatch(f.window, f.document, "pointermove", { ...pointer, clientY: 390 });
  assert.ok(f.card("a").classList.contains("is-dragging"));
  assert.equal(f.document.querySelector(".services-drop-marker").hidden, false);
  f.dom.frame();
  assert.ok(scroller.scrollTop > 0);
  // Emulate the browser overflow caused by the translated dragged card.
  Object.defineProperty(scroller, "scrollHeight", { value: 10000 });
  for (let frame = 0; frame < 100; frame++) f.dom.frame();
  assert.equal(
    scroller.scrollTop,
    600,
    "a held bottom-edge drag stays within the original content bounds",
  );
  dispatch(f.window, f.document, "keydown", { key: "Escape" });
  assert.deepEqual(
    f.services.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.equal(f.document.querySelector(".is-dragging"), null);
  dispatch(f.window, handle, "pointerdown", pointer);
  dispatch(f.window, f.document, "pointermove", { ...pointer, clientY: 230 });
  dispatch(f.window, f.document, "pointerup", pointer);
  assert.deepEqual(
    f.services.map((item) => item.id),
    ["b", "c", "a"],
  );
});

test("every notification color updates the 99+ preview and survives draft serialization", () => {
  const f = fixture();
  f.manager.edit("first");
  const buttons = [...f.document.querySelectorAll(".service-color-swatch")];
  assert.equal(buttons.length, 9);
  for (const button of buttons) {
    button.click();
    assert.equal(button.getAttribute("aria-pressed"), "true");
    const preview = f.document.querySelector(".service-color-preview");
    assert.equal(
      preview.querySelector(".service-unread-preview").textContent,
      "99+",
    );
    assert.equal(
      preview.style.getPropertyValue("--notification-color"),
      button.style.getPropertyValue("--notification-color"),
    );
    assert.equal(
      preview.style.getPropertyValue("--notification-foreground"),
      button.style.getPropertyValue("--notification-foreground"),
    );
  }
  applyServiceDialog(f);
  assert.equal(
    JSON.parse(JSON.stringify(f.services))[0].notificationColor,
    "magenta",
  );
});

test("missing and invalid historical notification colors select Auto", () => {
  for (const color of [
    undefined,
    null,
    "invalid",
    "#fff",
    "#gg0000",
    "rgb(255,0,0)",
  ]) {
    const item = service();
    if (color !== undefined) item.notificationColor = color;
    const f = fixture([item]);
    f.manager.edit("first");
    assert.equal(
      f.document
        .querySelector('.service-color-swatch[aria-label="Auto"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      f.document
        .querySelector(".service-color-preview")
        .style.getPropertyValue("--notification-color"),
      "var(--accent)",
    );
    f.cancel();
  }
});

test("RGB picker, channels and HEX stay synchronized and custom colors survive reopening", () => {
  const f = fixture([service("a", "discord"), service("b", "discord")]);
  const other = JSON.stringify(f.services[1]);
  f.manager.edit("a");
  setServiceField(f, "custom-color", "#12abef");
  assert.equal(f.document.getElementById("service-dialog-color-r").value, "18");
  assert.equal(
    f.document.getElementById("service-dialog-color-g").value,
    "171",
  );
  assert.equal(
    f.document.getElementById("service-dialog-color-b").value,
    "239",
  );
  assert.equal(
    f.document.getElementById("service-dialog-color-hex").value,
    "#12abef",
  );
  for (const [channel, value] of [
    ["r", "255"],
    ["g", "0"],
    ["b", "128"],
  ])
    setServiceField(f, `color-${channel}`, value);
  assert.equal(
    f.document.getElementById("service-dialog-custom-color").value,
    "#ff0080",
  );
  setServiceField(f, "color-hex", "#ABCDEF");
  assert.equal(
    f.document.getElementById("service-dialog-custom-color").value,
    "#abcdef",
  );
  const preview = f.document.querySelector(".service-color-preview");
  assert.equal(
    preview.style.getPropertyValue("--notification-color"),
    "#abcdef",
  );
  assert.equal(
    preview.style.getPropertyValue("--notification-foreground"),
    "#000000",
  );
  applyServiceDialog(f);
  assert.equal(f.services[0].notificationColor, "#abcdef");
  assert.equal(JSON.stringify(f.services[1]), other);
  f.manager.edit("a");
  assert.equal(
    f.document.getElementById("service-dialog-color-hex").value,
    "#abcdef",
  );
  assert.equal(
    f.document.getElementById("service-dialog-color-r").value,
    "171",
  );
  f.cancel();
});

test("invalid RGB/HEX blocks Apply; a valid selection or Random repairs it without touching other services", () => {
  const f = fixture();
  f.manager.edit("first");
  for (const invalid of ["", "256", "-1", "1.5", "text"]) {
    setServiceField(f, "color-r", invalid);
    applyServiceDialog(f);
    assert.equal(f.manager.isDialogOpen(), true);
    assert.equal(f.changes.length, 0);
    f.document
      .querySelector('.service-color-swatch[aria-label="Auto"]')
      .click();
  }
  for (const invalid of ["", "red", "#fff", "#00000z", "#fffffff"]) {
    setServiceField(f, "color-hex", invalid);
    applyServiceDialog(f);
    assert.equal(f.manager.isDialogOpen(), true);
    assert.equal(f.changes.length, 0);
    f.document.getElementById("service-dialog-random-color").click();
  }
  applyServiceDialog(f);
  assert.match(f.services[0].notificationColor, /^#[\da-f]{6}$/);
  assert.equal(f.changes.length, 1);
});

test("Add receives one stable random default; Random and Cancel remain isolated per service", () => {
  const f = fixture([service("a", "discord"), service("b", "discord")]);
  const before = JSON.stringify(f.services);
  f.manager.add();
  const initial = f.document.getElementById("service-dialog-color-hex").value;
  assert.equal(initial, "#0139c0");
  chooseProvider(f, "discord");
  assert.equal(
    f.document.getElementById("service-dialog-color-hex").value,
    initial,
  );
  f.manager.refresh();
  assert.equal(
    f.document.getElementById("service-dialog-color-hex").value,
    initial,
  );
  assert.equal(f.colorSamples(), 1);
  f.document.getElementById("service-dialog-random-color").click();
  assert.equal(
    f.document.getElementById("service-dialog-color-hex").value,
    "#0239c0",
  );
  assert.equal(JSON.stringify(f.services), before);
  f.cancel();
  assert.equal(JSON.stringify(f.services), before);
  f.manager.add();
  chooseProvider(f, "discord");
  applyServiceDialog(f);
  assert.equal(f.services[2].notificationColor, "#0339c0");
  const saved = JSON.parse(JSON.stringify(f.services));
  const reopened = fixture(saved);
  reopened.manager.edit(saved[2].id);
  assert.equal(
    reopened.document.getElementById("service-dialog-color-hex").value,
    "#0339c0",
  );
  assert.equal(reopened.colorSamples(), 0);
  reopened.cancel();
});

test("an open edit preserves an external mute and cannot recreate an externally removed service", () => {
  const f = fixture([service("a"), service("b")]);
  f.manager.edit("a");
  setServiceField(f, "name", "Changed name");
  f.services[0].notifications = false;
  f.manager.refresh();
  applyServiceDialog(f);
  assert.equal(f.services[0].notifications, false);
  f.manager.edit("b");
  f.services.splice(1, 1);
  f.manager.refresh();
  applyServiceDialog(f);
  assert.equal(f.services.length, 1);
  assert.match(
    f.document.querySelector(".service-dialog-error").textContent,
    /not available/,
  );
  f.cancel();
});
