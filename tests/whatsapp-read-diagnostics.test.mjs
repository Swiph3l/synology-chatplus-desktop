import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";

const built = await build({
  stdin: {
    contents: `export { createWhatsAppAdapter } from "./src/theme/providers/whatsapp";
    export { installUnreadAdapter } from "./src/theme/provider-unread";
    export { whatsappReadProbeReasons } from "./src/theme/providers/whatsapp-read-probe";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "whatsappProbe",
});
const tag = "opaque-chat@c.us";

function fixture(enabled = true, install = false) {
  const { document, window: dom } = parseHTML(`<html><body>
    <div id="pane-side"><div role="grid"><div role="row" aria-selected="true"><span id="private-contact">Private name</span></div></div></div>
    <div id="main"><div id="scroll"><div data-id="false_${tag}_ABC123"><span id="private-message">Private message</span></div></div></div>
  </body></html>`);
  const timers = new Map();
  const messages = [];
  let timer = 0,
    clock = 1000,
    focused = true;
  const host = Object.assign(new EventTarget(), {
    __chatplusNotificationDiagnostics: enabled,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: (node) => ({
      display: "block",
      visibility: "visible",
      overflowY: node.id === "scroll" ? "auto" : "visible",
    }),
    setTimeout(callback) {
      const id = ++timer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    chrome: {
      webview: {
        postMessage(value) {
          messages.push(JSON.parse(value));
        },
      },
    },
  });
  Object.defineProperties(document, {
    defaultView: { value: host },
    visibilityState: { value: "visible" },
    hasFocus: { value: () => focused },
  });
  dom.HTMLElement.prototype.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
  });
  const scroll = document.getElementById("scroll");
  Object.assign(scroll, {
    scrollTop: 300,
    scrollHeight: 600,
    clientHeight: 300,
  });
  document.elementFromPoint = () => document.querySelector("[data-id]");
  for (const id of ["private-contact", "private-message"]) {
    const node = document.getElementById(id);
    Object.defineProperty(node, "textContent", {
      get() {
        throw new Error("private text must not be inspected");
      },
    });
    const getAttribute = node.getAttribute.bind(node);
    node.getAttribute = (name) => {
      assert.ok(
        !["title", "aria-label", "alt"].includes(name),
        "private labels must not be read",
      );
      return getAttribute(name);
    };
  }
  const context = {
    crypto: { randomUUID },
    Event,
    KeyboardEvent: class {},
    queueMicrotask,
    Date: class extends Date {
      static now() {
        return clock;
      }
    },
  };
  runInNewContext(built.outputFiles[0].text, context);
  const adapter = context.whatsappProbe.createWhatsAppAdapter(document);
  const stop = install
    ? context.whatsappProbe.installUnreadAdapter(adapter, document, host)
    : adapter.observe(() => {});
  return {
    document,
    host,
    adapter,
    allowedReasons: new Set(context.whatsappProbe.whatsappReadProbeReasons),
    stop,
    messages,
    timers,
    observe(notification) {
      adapter.onNotificationObserved(notification);
      return adapter.isViewingNotification(notification);
    },
    focus(value) {
      focused = value;
    },
    advance(value) {
      clock += value;
    },
    flush() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

test("ordinary WhatsApp builds do not retain or sample notification structure", (t) => {
  const f = fixture(false);
  t.after(f.stop);
  f.adapter.onHostForegroundChanged(true, 7, 1);
  assert.equal(f.observe({ tag }), false);
  f.adapter.snapshot();
  f.flush();
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.messages, []);
});

test("QA WhatsApp probe emits only fixed structural metadata and cannot acknowledge unread", (t) => {
  const f = fixture();
  t.after(f.stop);
  f.adapter.onHostForegroundChanged(true, 7, 1);
  assert.equal(f.observe({ tag, title: "Private title" }), false);
  f.adapter.snapshot();
  f.adapter.snapshot();
  assert.equal(f.timers.size, 1, "coalesce repeated observer samples");
  f.flush();
  assert.ok(
    f.messages.some(
      (row) => row.reason === "whatsapp-tag-matches-main-message",
    ),
  );
  assert.ok(
    f.messages.some(
      (row) => row.reason === "whatsapp-selected-unread-badge-missing",
    ),
  );
  assert.ok(
    f.messages.every(
      (row) =>
        row.chatplusUnreadDiagnostic === 1 &&
        row.source === "whatsapp-dom" &&
        row.event === "read-structure-checked" &&
        row.generation === 7 &&
        f.allowedReasons.has(row.reason),
    ),
  );
  assert.ok(
    f.messages.every(
      (row) =>
        Object.keys(row).sort().join(",") ===
        "chatplusUnreadDiagnostic,event,generation,reason,source",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(f.messages),
    /opaque-chat|ABC123|Private|acknowledgement|readArrivals/,
  );
  assert.equal(f.adapter.readContext(), null);
  assert.equal(f.adapter.contentContext(), null);
  assert.equal(f.adapter.providerUnreadZero(), false);
  assert.equal(f.adapter.snapshot().hasUnread, null);
  const before = f.messages.length;
  f.flush();
  assert.equal(
    f.messages.length,
    before,
    "unchanged structural flags do not flood capture",
  );
});

test("WhatsApp sampling waits for foreground, cancels on hide, and expires old tags", (t) => {
  const f = fixture();
  t.after(f.stop);
  f.observe({ tag });
  assert.equal(f.timers.size, 0);
  f.adapter.onHostForegroundChanged(true, 7, 1);
  assert.equal(f.timers.size, 1);
  f.adapter.onHostForegroundChanged(false, 8, 1);
  f.flush();
  assert.deepEqual(f.messages, []);
  f.adapter.onHostForegroundChanged(true, 9, 1);
  f.advance(120001);
  f.flush();
  assert.deepEqual(f.messages, []);
  f.adapter.snapshot();
  assert.equal(f.timers.size, 0);
});

test("WhatsApp diagnostics reject oversize tags and release pending samples on teardown", () => {
  const f = fixture();
  f.adapter.onHostForegroundChanged(true, 7, 1);
  f.observe({ tag: "x".repeat(513) });
  assert.equal(f.timers.size, 0);
  f.observe({ tag });
  assert.equal(f.timers.size, 1);
  f.stop();
  f.flush();
  assert.deepEqual(f.messages, []);
  assert.equal(f.timers.size, 0);
});

test("actual host retains background WhatsApp notification metadata without treating it as viewing or read", async (t) => {
  const f = fixture(true, true);
  t.after(f.stop);
  f.host.__chatplusSetForeground(false, 7, 1);
  assert.equal(
    f.host.__chatplusIsViewingNotification({ tag, arrival: 1 }),
    false,
  );
  assert.equal(f.timers.size, 0);
  f.host.__chatplusSetForeground(true, 8, 1);
  await new Promise(setImmediate);
  f.flush();
  assert.ok(
    f.messages.some(
      (row) =>
        row.event === "read-structure-checked" &&
        row.reason === "whatsapp-tag-matches-main-message",
    ),
  );
  assert.ok(
    f.messages
      .filter((row) => row.chatplusUnread === 1)
      .every(
        (row) =>
          row.unreadScope === "notification-attention" &&
          row.certainty === "unknown" &&
          !("acknowledgement" in row) &&
          !("readArrivals" in row),
      ),
  );
  assert.doesNotMatch(
    JSON.stringify(
      f.messages.filter((row) => row.chatplusUnreadDiagnostic === 1),
    ),
    /opaque-chat|ABC123|Private/,
  );
  f.document
    .querySelector('[role="row"]')
    .setAttribute("aria-selected", "false");
  await new Promise(setImmediate);
  f.flush();
  assert.ok(
    f.messages.some(
      (row) =>
        row.event === "read-structure-checked" &&
        row.reason === "whatsapp-selected-row-missing",
    ),
    "attribute-only provider changes schedule a fresh structural sample",
  );
});
