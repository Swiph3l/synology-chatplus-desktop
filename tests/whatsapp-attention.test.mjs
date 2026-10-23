import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";

const built = await build({
  entryPoints: ["src/theme/providers/whatsapp-attention.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { parseWhatsAppAttentionTitle: parse, readWhatsAppAttention: read } =
  await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
  );

const messageId = "ABCDEF1234567890";

function fixture(title = "WhatsApp", locale = "en-US") {
  const { document, window } =
    parseHTML(`<html lang="${locale}"><head><title></title></head><body>
    <div id="pane-side"><div role="grid"><div role="row"><div role="gridcell"><div aria-selected="true"></div></div></div></div></div>
    <div id="main"><div data-id="${messageId}" data-testid="conv-msg-${messageId}"><span id="private-message">Private message</span></div></div>
  </body></html>`);
  document.title = title;
  window.getComputedStyle = (node) => ({
    display: node.style.display || "block",
    visibility: node.style.visibility || "visible",
  });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 300,
    height: 100,
  });
  return { document, window, read: () => read(document) };
}

test("WhatsApp canonical publisher zero has notification-attention scope, not a message total", () => {
  for (const publisher of ["WhatsApp", "WhatsApp Business"]) {
    assert.equal(parse(publisher, "en-US"), 0);
    assert.equal(parse(`(7) ${publisher}`, "en-US"), 7);
    const f = fixture(publisher);
    assert.deepEqual(f.read(), {
      hasUnread: false,
      count: null,
      unreadScope: "notification-attention",
    });
  }
});

test("WhatsApp attention accepts exact Intl grouping in all seven supported UI languages", () => {
  for (const [locale, number] of [
    ["en-US", "1,234,567"],
    ["de-DE", "1.234.567"],
    ["es-ES", "1.234.567"],
    ["fr-FR", "1\u202f234\u202f567"],
    ["ja-JP", "1,234,567"],
    ["pl-PL", "1\u00a0234\u00a0567"],
    ["zh-CN", "1,234,567"],
  ]) {
    assert.equal(parse(`(${number}) WhatsApp`, locale), 1_234_567, locale);
    assert.equal(
      fixture(`(${number}) WhatsApp`, locale).read().count,
      1_234_567,
      locale,
    );
  }
});

test("WhatsApp attention handles publisher-localized digits and Indian grouping", () => {
  for (const [locale, number] of [
    ["ar-EG", "١٬٢٣٤٬٥٦٧"],
    ["fa-IR", "۱٬۲۳۴٬۵۶۷"],
    ["hi-IN", "12,34,567"],
    ["bn-BD", "১২,৩৪,৫৬৭"],
  ])
    assert.equal(parse(`(${number}) WhatsApp`, locale), 1_234_567, locale);
});

test("WhatsApp attention rejects noncanonical counts and unsupported publisher or route text", () => {
  for (const title of [
    "",
    " ",
    "WhatsApp ",
    " WhatsApp",
    "WhatsApp\n",
    "(0) WhatsApp",
    "(01) WhatsApp",
    "(-1) WhatsApp",
    "(+1) WhatsApp",
    "(1.5) WhatsApp",
    "(1e3) WhatsApp",
    "(1+) WhatsApp",
    "(1,23) WhatsApp",
    "(1 234) WhatsApp",
    "(１２) WhatsApp",
    "(٤) WhatsApp",
    "(1) WhatsApp\n",
    "(1) WhatsApp — Private route",
    "WhatsApp – Private route",
    "(1) WhatsApp – Private route",
    "(1) WhatsApp Business Private text",
    "Loading WhatsApp",
    "(1) WhatsApp Web",
    "Private name (1) WhatsApp",
    "(1) WhatsApp (2)",
    "(4,294,967,296) WhatsApp",
    `(${"1".repeat(65)}) WhatsApp`,
  ])
    assert.equal(parse(title, "en-US"), null, title);
  assert.equal(parse("(1,234) WhatsApp", "de-DE"), null);
  assert.equal(parse("(1.234) WhatsApp", "en-US"), null);
  assert.equal(parse("(1) WhatsApp", "invalid_locale"), null);
  assert.equal(parse("(4,294,967,295) WhatsApp", "en-US"), 0xffffffff);
});

test("WhatsApp canonical counter updates in background without focus or a pane gesture", () => {
  const f = fixture("(2) WhatsApp");
  Object.defineProperty(f.document, "visibilityState", { value: "hidden" });
  Object.defineProperty(f.document, "hasFocus", {
    value() {
      throw new Error("attention mirroring must not ask for focus");
    },
  });
  assert.equal(f.read().hasUnread, true);
  f.document.title = "WhatsApp";
  assert.equal(f.read().hasUnread, false);
  f.document.title = "(1) WhatsApp";
  assert.equal(f.read().hasUnread, true);
});

test("WhatsApp initial zero requires real conversation markup beyond a loaded chat list", () => {
  const f = fixture();
  assert.equal(f.read().hasUnread, false);
  f.document.getElementById("main").innerHTML =
    '<div role="progressbar"></div>';
  assert.equal(f.read().hasUnread, null);
  f.document.title = "(4) WhatsApp";
  assert.equal(f.read().hasUnread, true, "positive counter needs no open chat");
  f.document.getElementById("main").remove();
  assert.equal(f.read().hasUnread, true);
  f.document.title = "WhatsApp";
  assert.equal(f.read().hasUnread, null);
});

test("WhatsApp an established positive counter permits a later authenticated home-screen zero", () => {
  const f = fixture();
  f.document.getElementById("main").remove();
  assert.equal(read(f.document).hasUnread, null);
  assert.equal(
    read(f.document, { allowReadyZeroAfterPositive: true }).hasUnread,
    false,
  );
  f.document.getElementById("pane-side").remove();
  assert.equal(
    read(f.document, { allowReadyZeroAfterPositive: true }).hasUnread,
    null,
    "positive history cannot make a login or missing app root authoritative",
  );
});

test("WhatsApp count cannot turn login, initial loading or missing list markup into zero", () => {
  for (const title of ["WhatsApp", "(2) WhatsApp"]) {
    const f = fixture(title);
    f.document.getElementById("pane-side").remove();
    assert.equal(f.read().hasUnread, null);
    const empty = fixture(title);
    empty.document.querySelector('[role="grid"]').innerHTML = "";
    assert.equal(empty.read().hasUnread, null);
    const loading = fixture(title);
    Object.defineProperty(loading.document, "readyState", { value: "loading" });
    assert.equal(loading.read().hasUnread, null);
  }
});

test("WhatsApp hidden, busy or duplicated app roots remain unknown", () => {
  for (const id of ["pane-side", "main"]) {
    for (const hidden of ["hidden", "aria-hidden", "aria-busy", "display"]) {
      const f = fixture();
      const root = f.document.getElementById(id);
      if (hidden === "display") root.style.display = "none";
      else root.setAttribute(hidden, "true");
      assert.equal(f.read().hasUnread, null, `${id}:${hidden}`);
    }
    const duplicated = fixture();
    duplicated.document.body.append(
      duplicated.document.getElementById(id).cloneNode(true),
    );
    assert.equal(duplicated.read().hasUnread, null, `${id}:duplicate`);
  }
  const f = fixture();
  f.document
    .querySelector('[role="grid"]')
    .insertAdjacentHTML(
      "beforeend",
      '<div role="list"><div role="listitem"></div></div>',
    );
  assert.equal(f.read().hasUnread, null);
});

test("WhatsApp zero checks the actual bare message ID and matching public wrapper test ID", () => {
  const f = fixture();
  const wrapper = f.document.querySelector("[data-id]");
  for (const value of ["", "x".repeat(129), "opaque@c.us", "Private name"]) {
    wrapper.setAttribute("data-id", value);
    wrapper.setAttribute("data-testid", `conv-msg-${value}`);
    assert.equal(f.read().hasUnread, null);
  }
  wrapper.setAttribute("data-id", messageId);
  wrapper.setAttribute("data-testid", "conv-msg-other");
  assert.equal(f.read().hasUnread, null);
  wrapper.setAttribute("data-testid", `conv-msg-${messageId}`);
  assert.equal(f.read().hasUnread, false);
  wrapper.setAttribute("aria-hidden", "true");
  assert.equal(f.read().hasUnread, null);
});

test("WhatsApp bounded readiness cannot become zero by silently dropping excessive rows or wrappers", () => {
  const f = fixture();
  const grid = f.document.querySelector('[role="grid"]');
  grid.innerHTML = '<div role="row"></div>'.repeat(513);
  assert.equal(f.read().hasUnread, null);
  grid.innerHTML = '<div role="row"></div>';
  f.document.getElementById("main").innerHTML =
    `<div data-id="${messageId}" data-testid="conv-msg-${messageId}"></div>`.repeat(
      513,
    );
  assert.equal(f.read().hasUnread, null);
});

test("WhatsApp attention ignores row badges, contact text and private attributes entirely", () => {
  const f = fixture();
  f.document
    .querySelector('[role="row"]')
    .insertAdjacentHTML(
      "beforeend",
      '<span data-testid="icon-unread-count" aria-label="99 unread messages">99</span>',
    );
  for (const node of f.document.querySelectorAll("body *")) {
    const getAttribute = node.getAttribute.bind(node);
    node.getAttribute = (name) => {
      assert.ok(
        !["aria-label", "title", "href", "src", "data-pre-plain-text"].includes(
          name,
        ),
      );
      return getAttribute(name);
    };
    Object.defineProperty(node, "textContent", {
      get() {
        throw new Error("private message, contact or badge text was inspected");
      },
    });
  }
  assert.equal(f.read().hasUnread, false);
  f.document.title = "(3) WhatsApp";
  assert.equal(f.read().count, 3);
  assert.doesNotMatch(JSON.stringify(f.read()), /Private|ABCDEF|unread-count/);
});

test("WhatsApp attention state stays isolated across documents and lost or replaced DOM", () => {
  const a = fixture("(2) WhatsApp");
  const b = fixture();
  assert.equal(a.read().count, 2);
  assert.equal(b.read().hasUnread, false);
  a.document.getElementById("pane-side").remove();
  assert.equal(a.read().hasUnread, null);
  assert.equal(b.read().hasUnread, false);
  b.document.title = "";
  assert.equal(b.read().hasUnread, null);
});
