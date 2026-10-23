import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";

const built = await build({
  entryPoints: ["src/theme/providers/whatsapp.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { createWhatsAppAdapter } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);

function fixture(content = "", listAttributes = "", title = "") {
  const { window, document } = parseHTML(
    `<html lang="en"><head><title></title></head><body><div id="pane-side"><div role="grid" ${listAttributes}>${content}</div></div><div id="main" role="main"><div data-id="ABCDEF1234567890" data-testid="conv-msg-ABCDEF1234567890"></div><div contenteditable="true"></div></div></body></html>`,
  );
  document.title = title;
  window.getComputedStyle = (node) => ({
    display: node.style.display || "block",
    visibility: node.style.visibility || "visible",
  });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 300,
    height: 100,
  });
  return { window, document, adapter: createWhatsAppAdapter(document) };
}

// Swiph3l: This is an explicit product-scope change. Dedicated badges remain real
// per-row evidence, but must no longer latch the notification-attention counter.
// The canonical publisher count now owns the dot and its scoped count value.
test("WhatsApp notification-attention counter owns the dot independently of formerly observed row badges", () => {
  for (const badge of [
    '<span data-testid="icon-unread-count">4</span>',
    '<span data-testid="unread-count">99+</span>',
    '<span data-icon="unread-count" aria-label="Unread messages"></span>',
    '<span data-testid="unread-count" aria-label="2 unread messages"></span>',
    '<span data-testid="unread-count" aria-label="1 unread message"></span>',
    '<span data-testid="unread-count" aria-label="2 nieprzeczytane wiadomości"></span>',
    '<span data-testid="unread-count" aria-label="2 mensajes no leídos"></span>',
    '<span data-testid="unread-count" aria-label="2 ungelesene Nachrichten"></span>',
    '<span data-testid="unread-count" aria-label="2 messages non lus"></span>',
    '<span data-testid="unread-count" aria-label="未読メッセージ 2 件"></span>',
    '<span data-testid="unread-count" aria-label="2 則未讀訊息"></span>',
  ]) {
    const f = fixture(`<div role="row">${badge}</div>`, "", "(4) WhatsApp");
    assert.equal(f.adapter.source, "whatsapp-dom");
    assert.equal(f.adapter.tracksNotificationArrivals, false);
    assert.equal(f.adapter.snapshot().hasUnread, true, badge);
    assert.equal(
      f.adapter.snapshot().count,
      4,
      "the value is the canonical attention count, never the row badge sum",
    );
    assert.equal(f.adapter.snapshot().unreadScope, "notification-attention");
    assert.equal(f.adapter.providerUnreadZero(), false);
    f.document.title = "WhatsApp";
    assert.equal(
      f.adapter.snapshot().hasUnread,
      false,
      "muted/archived or otherwise excluded row badges do not own attention",
    );
  }
});

test("WhatsApp partial row DOM without a canonical attention counter remains unknown instead of global read", () => {
  for (const [rows, attributes] of [
    ["", ""],
    ['<div role="row" aria-posinset="1">Chat</div>', 'aria-rowcount="100"'],
    ['<div role="row" aria-posinset="1">Chat</div>', 'aria-rowcount="1"'],
    ['<div role="row" aria-expanded="false">Archived</div>', ""],
    ['<div role="row"><span aria-label="0 unread messages">0</span></div>', ""],
    [
      '<div role="row"><span data-testid="unread-count" aria-label="0 unread messages">0</span></div>',
      "",
    ],
    [
      '<div role="row"><span aria-label="Project 2 unread messages">Preview</span><span>25</span></div>',
      "",
    ],
  ]) {
    const f = fixture(rows, attributes);
    assert.equal(f.adapter.snapshot().hasUnread, null);
    assert.equal(f.adapter.snapshot().count, null);
    assert.equal(f.adapter.providerUnreadZero(), false);
  }
  const f = fixture(
    '<div role="row"><span data-testid="unread-count">4</span></div>',
  );
  f.document.getElementById("pane-side").remove();
  f.document.title = "(99) WhatsApp";
  assert.equal(f.adapter.snapshot().hasUnread, null);
});

test("WhatsApp ignores hidden/duplicate badges and unrelated page metadata", () => {
  for (const hidden of [
    "hidden",
    'aria-hidden="true"',
    'style="display:none"',
  ]) {
    const f = fixture(
      `<div role="row" ${hidden}><span data-testid="unread-count">4</span></div>`,
    );
    assert.equal(f.adapter.snapshot().hasUnread, null);
  }
  const f = fixture('<div role="row">Read chat</div>');
  f.document.getElementById("main").innerHTML =
    '<span aria-label="5 unread messages"></span>';
  assert.equal(f.adapter.snapshot().hasUnread, null);
});

test("WhatsApp contact names and previews that resemble unread labels remain unknown and are not inspected", () => {
  for (const content of [
    '<span data-testid="cell-frame-title" title="2 unread messages" aria-label="2 unread messages">2 unread messages</span>',
    '<span data-testid="cell-frame-secondary" aria-label="Unread messages">Unread messages</span>',
    '<span aria-label="2 unread messages">2 unread messages</span>',
    '<span role="button" aria-label="2 unread messages">Contact action</span>',
    '<img aria-label="2 unread messages" alt="Contact photo">',
  ]) {
    const f = fixture(`<div role="row">${content}</div>`);
    assert.deepEqual(f.adapter.snapshot(), {
      hasUnread: null,
      count: null,
      unreadScope: "notification-attention",
      conversations: [],
      currentConversation: null,
    });
    for (const node of f.document.querySelectorAll(
      '[role="row"] [aria-label]',
    )) {
      const getAttribute = node.getAttribute.bind(node);
      node.getAttribute = (name) => {
        assert.notEqual(
          name,
          "aria-label",
          "contact/preview labels must not be read",
        );
        return getAttribute(name);
      };
      Object.defineProperty(node, "textContent", {
        get() {
          throw new Error("contact/preview text must not be read");
        },
      });
    }
    assert.equal(f.adapter.snapshot().hasUnread, null);
  }
});

test("WhatsApp current chat cannot be acknowledged from selection, focus, interaction or ambiguous notification tags", () => {
  const f = fixture(
    '<div role="row" aria-selected="true"><span data-testid="unread-count">4</span></div>',
    "",
    "(4) WhatsApp",
  );
  assert.equal(f.adapter.readContext(), null);
  assert.equal(f.adapter.contentContext(), null);
  assert.equal(f.adapter.interactionContext(new f.window.Event("click")), null);
  assert.equal(
    f.adapter.isViewingNotification({ tag: "same-name", title: "Chat" }),
    false,
  );
  assert.deepEqual(f.adapter.snapshot().conversations, []);
  assert.equal(f.adapter.snapshot().currentConversation, null);
  assert.equal(f.adapter.snapshot().hasUnread, true);
});

test("WhatsApp observations follow replaced chat lists and stop cleanly", async () => {
  const f = fixture();
  let changes = 0;
  const stop = f.adapter.observe(() => changes++);
  f.document.getElementById("pane-side").innerHTML =
    '<div role="list"><div role="listitem"><span data-testid="unread-count">3</span></div></div>';
  f.document.title = "(3) WhatsApp";
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(changes > 0);
  assert.equal(f.adapter.snapshot().hasUnread, true);
  stop();
  changes = 0;
  f.document.getElementById("pane-side").remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(changes, 0);
});

test("WhatsApp title-only attention changes are observed in background without reading pane input", async () => {
  const f = fixture('<div role="row"></div>', "", "(2) WhatsApp");
  Object.defineProperties(f.document, {
    visibilityState: { value: "hidden" },
    hasFocus: {
      value() {
        throw new Error("scoped provider attention does not require focus");
      },
    },
  });
  let changes = 0;
  const stop = f.adapter.observe(() => changes++);
  assert.equal(f.adapter.snapshot().hasUnread, true);
  f.document.title = "WhatsApp";
  await new Promise(setImmediate);
  assert.ok(
    changes > 0,
    "counter changes cannot depend on chat-list mutations",
  );
  assert.deepEqual(f.adapter.snapshot(), {
    hasUnread: false,
    count: null,
    unreadScope: "notification-attention",
    conversations: [],
    currentConversation: null,
  });
  f.document.title = "";
  assert.equal(f.adapter.snapshot().hasUnread, null);
  stop();
});

test("WhatsApp ready positive-to-zero mirrors phone reads while its web view stays on home", async () => {
  const f = fixture('<div role="row"></div>', "", "(2) WhatsApp");
  f.document.getElementById("main").remove();
  Object.defineProperty(f.document, "visibilityState", { value: "hidden" });
  let changes = 0;
  const stop = f.adapter.observe(() => changes++);
  assert.equal(f.adapter.snapshot().hasUnread, true);
  f.document.title = "WhatsApp";
  await new Promise(setImmediate);
  assert.ok(changes > 0);
  assert.equal(f.adapter.snapshot().hasUnread, false);
  const initial = fixture('<div role="row"></div>', "", "WhatsApp");
  initial.document.getElementById("main").remove();
  assert.equal(
    initial.adapter.snapshot().hasUnread,
    null,
    "another document cannot borrow the established counter history",
  );
  f.document.getElementById("pane-side").remove();
  assert.equal(f.adapter.snapshot().hasUnread, null);
  stop();
});

test("two WhatsApp renderer adapters keep observations isolated", () => {
  const a = fixture(
    '<div role="row"><span data-testid="unread-count">4</span></div>',
    "",
    "(4) WhatsApp",
  );
  const b = fixture('<div role="row">Read chat</div>');
  assert.equal(a.adapter.snapshot().hasUnread, true);
  assert.equal(b.adapter.snapshot().hasUnread, null);
  a.document.getElementById("pane-side").remove();
  assert.equal(a.adapter.snapshot().hasUnread, null);
  assert.equal(b.adapter.snapshot().hasUnread, null);
});
