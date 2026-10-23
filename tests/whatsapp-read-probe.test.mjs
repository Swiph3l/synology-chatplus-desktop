import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";

const built = await build({
  entryPoints: ["src/theme/providers/whatsapp-read-probe.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { probeWhatsAppReadStructure: probe, whatsappReadProbeReasons } =
  await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
  );

const chat = "opaquechat@lid";
const message = `false_${chat}_MSG001`;

function fixture() {
  const { document, window } = parseHTML(`<html><body>
    <div id="pane-side"><div role="grid"><div role="row" aria-selected="true">
      <span data-testid="cell-frame-title" title="Synthetic contact">Synthetic contact</span>
      <span data-testid="unread-count" aria-label="Synthetic badge">2</span>
    </div></div></div>
    <div id="main"><div id="scroll" style="overflow-y:auto">
      <div id="message" data-id="${message}"><span id="body">Synthetic message</span></div>
    </div></div>
    <div id="cover"></div>
  </body></html>`);
  window.getComputedStyle = (node) => ({
    display: node.style.display || "block",
    visibility: node.style.visibility || "visible",
    overflowY: node.style.overflowY || "visible",
  });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const row = this.id === "message" || this.id === "body";
    return {
      width: row ? 300 : 400,
      height: row ? 60 : 300,
      top: row ? 220 : 0,
      bottom: row ? 280 : 300,
      left: row ? 40 : 0,
      right: row ? 340 : 400,
    };
  };
  const scroll = document.getElementById("scroll");
  Object.defineProperties(scroll, {
    scrollHeight: { value: 900, configurable: true },
    clientHeight: { value: 300, configurable: true },
    scrollTop: { value: 600, writable: true },
  });
  document.elementFromPoint = () => document.getElementById("body");
  return {
    document,
    window,
    scroll,
    run: (tag = chat) => probe(document, tag),
  };
}

function contains(flags, code) {
  assert.ok(flags.includes(`whatsapp-${code}`), code);
}

test("WhatsApp structural probe reports fixed categories and opaque chat-to-message matches", () => {
  const f = fixture();
  const flags = f.run();
  for (const code of [
    "chat-tag-recognized",
    "main-recognized",
    "chat-list-recognized",
    "selected-row-recognized",
    "unread-badge-present",
    "selected-unread-badge-present",
    "main-message-key-recognized",
    "tag-matches-main-message",
    "scroll-node-recognized",
    "latest-candidate-visible",
  ])
    contains(flags, code);
  assert.ok(flags.every((flag) => whatsappReadProbeReasons.includes(flag)));
  assert.equal(new Set(flags).size, flags.length);
  assert.ok(!JSON.stringify(flags).includes(chat));
  assert.ok(!JSON.stringify(flags).includes("MSG001"));
});

test("WhatsApp message-key tags require exact equality and chat tags require the complete delimiter boundary", () => {
  const f = fixture();
  contains(f.run(message), "message-key-tag-recognized");
  contains(f.run(message), "tag-matches-main-message");
  contains(
    f.run(message.replace("MSG001", "MSG002")),
    "tag-unmatched-main-message",
  );
  contains(f.run("opaque@lid"), "tag-unmatched-main-message");
  f.document
    .getElementById("message")
    .setAttribute("data-id", `true_${chat}_MSG001`);
  contains(f.run(), "tag-matches-main-message");
  contains(f.run(message), "tag-unmatched-main-message");
});

test("WhatsApp group and self-direction suffixes stay opaque and are never returned", () => {
  const f = fixture();
  for (const value of [
    "false_opaquegroup@g.us_MSG002_opaquesender@lid",
    "true_opaquechat@lid_MSG003_out",
  ]) {
    f.document.getElementById("message").setAttribute("data-id", value);
    const flags = f.run(value);
    contains(flags, "message-key-tag-recognized");
    contains(flags, "tag-matches-main-message");
    assert.ok(!JSON.stringify(flags).includes("opaque"));
  }
});

test("WhatsApp badge disappearance is a structural flag, never a read or zero claim", () => {
  const f = fixture();
  contains(f.run(), "selected-unread-badge-present");
  f.document.querySelector('[data-testid="unread-count"]').remove();
  const flags = f.run();
  contains(flags, "selected-unread-badge-missing");
  contains(flags, "unread-badge-missing");
  assert.ok(flags.every((flag) => typeof flag === "string"));
  assert.ok(
    flags.every((flag) => !/known-read|provider-zero|acknowledg/.test(flag)),
  );
});

test("WhatsApp probe never reads contact/message text, names, preview labels or private URLs", () => {
  const f = fixture();
  for (const element of f.document.querySelectorAll("*")) {
    const original = element.getAttribute.bind(element);
    element.getAttribute = (name) => {
      assert.ok(
        !["title", "aria-label", "href", "src", "data-pre-plain-text"].includes(
          name,
        ),
        `private attribute ${name} must not be inspected`,
      );
      return original(name);
    };
    Object.defineProperty(element, "textContent", {
      get() {
        throw new Error("message/contact/badge text must not be inspected");
      },
    });
  }
  contains(f.run(), "tag-matches-main-message");
  contains(f.run(), "selected-unread-badge-present");
});

test("WhatsApp unknown, oversized and injection-shaped tags remain unmatched", () => {
  const f = fixture();
  for (const tag of [
    "",
    "Synthetic contact",
    "x".repeat(513),
    `${chat}\n`,
    '[data-id="x"]',
    "false_opaquechat@lid_",
  ]) {
    const flags = f.run(tag);
    contains(flags, "tag-unrecognized");
    contains(flags, "tag-unmatched-main-message");
  }
});

test("WhatsApp selected state may belong to a gridcell, while multiple selected rows remain ambiguous", () => {
  const f = fixture();
  const row = f.document.querySelector('[role="row"]');
  row.removeAttribute("aria-selected");
  row.insertAdjacentHTML(
    "beforeend",
    '<div role="gridcell" aria-selected="true"></div>',
  );
  contains(f.run(), "selected-row-recognized");
  row.parentElement.insertAdjacentHTML(
    "beforeend",
    '<div role="row" aria-selected="true"></div>',
  );
  contains(f.run(), "selected-row-ambiguous");
});

test("WhatsApp hidden or unrelated panes cannot manufacture visible matches", () => {
  for (const attribute of [
    "hidden",
    'aria-hidden="true"',
    'style="display:none"',
  ]) {
    const f = fixture();
    f.document.getElementById("main").outerHTML =
      `<div id="main" ${attribute}></div>`;
    contains(f.run(), "main-missing");
    contains(f.run(), "tag-unmatched-main-message");
    contains(f.run(), "latest-candidate-unavailable");
  }
  const f = fixture();
  f.document.getElementById("message").setAttribute("aria-hidden", "true");
  contains(f.run(), "main-message-key-missing");
  contains(f.run(), "tag-unmatched-main-message");
});

test("WhatsApp duplicated main panes and lists are reported as ambiguous instead of choosing one", () => {
  const f = fixture();
  f.document.body.insertAdjacentHTML("beforeend", '<div id="main"></div>');
  f.document
    .getElementById("pane-side")
    .insertAdjacentHTML("beforeend", '<div role="list"></div>');
  const flags = f.run();
  contains(flags, "main-ambiguous");
  contains(flags, "chat-list-ambiguous");
  contains(flags, "tag-unmatched-main-message");
});

test("WhatsApp scroll position and occlusion are candidate diagnostics, not inferred latest state", () => {
  const f = fixture();
  f.scroll.scrollTop = 500;
  contains(f.run(), "latest-candidate-unavailable");
  f.scroll.scrollTop = -20;
  contains(f.run(), "latest-candidate-unavailable");
  f.scroll.scrollTop = 600;
  f.document.elementFromPoint = () => f.document.getElementById("cover");
  contains(f.run(), "latest-candidate-unavailable");
});

test("WhatsApp nested scroll candidates remain ambiguous", () => {
  const f = fixture();
  const main = f.document.getElementById("main");
  main.style.overflowY = "scroll";
  Object.defineProperties(main, {
    scrollHeight: { value: 900 },
    clientHeight: { value: 300 },
  });
  contains(f.run(), "scroll-node-ambiguous");
  contains(f.run(), "latest-candidate-unavailable");
});

test("WhatsApp reused message elements are compared afresh and do not retain an old chat identity", () => {
  const f = fixture();
  contains(f.run(), "tag-matches-main-message");
  f.document
    .getElementById("message")
    .setAttribute("data-id", "false_otherchat@lid_MSG001");
  contains(f.run(), "tag-unmatched-main-message");
  contains(f.run("otherchat@lid"), "tag-matches-main-message");
});

test("WhatsApp large or absent message structures remain unavailable within the scan bound", () => {
  const f = fixture();
  f.scroll.innerHTML = Array.from(
    { length: 513 },
    (_, index) => `<div data-id="false_${chat}_MSG${index}"></div>`,
  ).join("");
  contains(f.run(), "main-message-key-missing");
  contains(f.run(), "tag-unmatched-main-message");
  contains(f.run(), "latest-candidate-unavailable");
  f.document.getElementById("main").remove();
  contains(f.run(), "main-missing");
});
